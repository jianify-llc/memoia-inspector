import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";

const factory = vi.hoisted(() => ({ v1: vi.fn(), v2: vi.fn(), user: vi.fn() }));
vi.mock("@/utils/memobase/client", () => ({ memoBaseClient: factory.v1, getMemobaseUser: factory.user, clearMemobaseUser: vi.fn() }));
vi.mock("@/utils/memoia/client", () => ({ memoiaClient: factory.v2 }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

const request = (headers: Record<string, string> = {}, body?: string) => new Request("https://inspector.example/api", {
  method: "POST", headers, body,
});

describe("Cookie-backed mutation boundary", () => {
  it.each<Record<string, string>>([{}, { origin: "null" }, { origin: "https://sibling.example" },
    { origin: "http://inspector.example" }, { origin: "https://inspector.example:8443" },
    { origin: "https://inspector.example", "sec-fetch-site": "same-site" },
    { origin: "https://inspector.example", "sec-fetch-site": "cross-site" },
  ])("rejects missing, opaque or cross-origin intent: %j", (headers) => {
    expect(rejectCrossOriginMutation(request(headers))?.status).toBe(403);
  });

  it("accepts exact same-origin JSON and a same-origin Referer fallback", () => {
    expect(rejectCrossOriginMutation(request({ origin: "https://inspector.example", "content-type": "application/json; charset=utf-8" }, "{}"))).toBeNull();
    expect(rejectCrossOriginMutation(request({ referer: "https://inspector.example/users" }))).toBeNull();
    expect(rejectCrossOriginMutation(request({ origin: "null", referer: "https://inspector.example/users" }))?.status).toBe(403);
  });

  it("rejects simple content types even with a valid origin", () => {
    expect(rejectCrossOriginMutation(request({ origin: "https://inspector.example", "content-type": "text/plain" }, "{}"))?.status).toBe(415);
  });

  it("requires browser same-origin metadata for an unconfigured reverse proxy", () => {
    const proxied = (headers: Record<string, string>) => new Request("http://localhost:3000/api", { method: "POST", headers });
    const headers = { origin: "https://inspector.example", host: "inspector.example", "x-forwarded-proto": "https", "x-forwarded-host": "inspector.example" };
    expect(rejectCrossOriginMutation(proxied(headers))?.status).toBe(403);
    expect(rejectCrossOriginMutation(proxied({ ...headers, "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(rejectCrossOriginMutation(proxied({ ...headers, origin: "https://other.example", "sec-fetch-site": "same-origin" }))?.status).toBe(403);
  });

  it("uses a configured public origin as strict authority, not forwarded headers", () => {
    vi.stubEnv("INSPECTOR_PUBLIC_ORIGIN", "https://inspector.example");
    expect(rejectCrossOriginMutation(new Request("http://localhost:3000/api", { method: "POST", headers: { origin: "https://inspector.example" } }))).toBeNull();
    expect(rejectCrossOriginMutation(request({ origin: "http://inspector.example", host: "inspector.example", "sec-fetch-site": "same-origin" }))?.status).toBe(403);
    vi.stubEnv("INSPECTOR_PUBLIC_ORIGIN", "not-a-url");
    expect(rejectCrossOriginMutation(request({ origin: "https://inspector.example" }))?.status).toBe(403);
  });

  it("retained Playground insert and flush still call the SDK for genuine same-origin requests", async () => {
    const user = { insert: vi.fn().mockResolvedValue("blob-id"), flush: vi.fn().mockResolvedValue(null) };
    const getOrCreateUser = vi.fn().mockResolvedValue(user);
    factory.v1.mockResolvedValue({ getOrCreateUser });
    factory.user.mockResolvedValue("playground-user");
    const insert = await import("@/app/api/memobase/insert/route");
    const response = await insert.POST(request({ origin: "https://inspector.example", "content-type": "application/json" },
      JSON.stringify({ messages: [{ role: "user", content: "I enjoy chess" }] })));
    expect(response.status).toBe(200);
    expect(user.insert).toHaveBeenCalledOnce();
    const flush = await import("@/app/api/memobase/flash/route");
    expect((await flush.POST(request({ origin: "https://inspector.example" }))).status).toBe(200);
    expect(user.flush).toHaveBeenCalledOnce();
  });

  const routes = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routes(path) : entry.name === "route.ts" ? [path] : [];
  });
  for (const path of routes(join(process.cwd(), "app/api"))) {
    const methods = [...readFileSync(path, "utf8").matchAll(/export async function (POST|PUT|PATCH|DELETE)\(/g)].map((match) => match[1]);
    for (const method of methods) {
      it(`${relative(process.cwd(), path)} ${method} rejects before parsing or calling a client`, async () => {
        const route = await import(path);
        const response = await route[method](new Request("https://inspector.example/api", {
          method, headers: { origin: "https://sibling.example", "content-type": "text/plain" }, body: "malformed",
        }), { params: Promise.resolve({}) });
        expect(response.status).toBe(403);
        expect(factory.v1).not.toHaveBeenCalled();
        expect(factory.v2).not.toHaveBeenCalled();
        expect(factory.user).not.toHaveBeenCalled();
      });
    }
  }
});
