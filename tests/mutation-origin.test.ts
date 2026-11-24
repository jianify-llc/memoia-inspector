import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";

const factory = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn() }));
vi.mock("@/utils/memoia/client", () => ({ memoiaClient: factory.client, getMemoiaUser: factory.user, clearMemoiaUser: vi.fn() }));
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

  it("checks JSON media type only when the route declares a JSON body", async () => {
    const input = request({ origin: "https://inspector.example", "content-type": "text/plain" }, "{}");
    expect(rejectCrossOriginMutation(input)).toBeNull();
    expect((await readJsonObject(input)).error?.status).toBe(415);
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

  it("Playground imports source messages once without a flush API", async () => {
    const importBlob = vi.fn().mockResolvedValue({ status: "completed" });
    factory.client.mockResolvedValue({ importBlob });
    factory.user.mockResolvedValue("playground-user");
    const insert = await import("@/app/api/memobase/insert/route");
    const response = await insert.POST(request({ origin: "https://inspector.example", "content-type": "application/json" },
      JSON.stringify({ idempotency_key: "turn-1", messages: [{ role: "user", content: "I enjoy chess", created_at: "2026-10-06T00:00:00Z" }] })));
    expect(response.status).toBe(200);
    expect(importBlob).toHaveBeenCalledExactlyOnceWith("playground-user", {
      source_id: "playground", idempotency_key: "turn-1", messages: [{ role: "user", content: "I enjoy chess", message_id: "turn-1:0", occurred_at: "2026-10-06T00:00:00Z" }],
    });
  });
  it("does not report pending processing as completed memory", async () => {
    factory.client.mockResolvedValue({ importBlob: vi.fn().mockResolvedValue({ status: "processing" }) });
    factory.user.mockResolvedValue("playground-user");
    const insert = await import("@/app/api/memobase/insert/route");
    const response = await insert.POST(request({ origin: "https://inspector.example", "content-type": "application/json" },
      JSON.stringify({ idempotency_key: "turn-1", messages: [{ role: "user", content: "Chess", created_at: "2026-10-06T00:00:00Z" }] })));
    expect(response.status).toBe(503);
  });
  it.each(["{", "null", '{"idempotency_key":"turn","messages":[null]}'])("rejects malformed import input without contacting Memoia: %s", async (body) => {
    const insert = await import("@/app/api/memobase/insert/route");
    const response = await insert.POST(request({ origin: "https://inspector.example", "content-type": "application/json" }, body));
    expect(response.status).toBe(400);
    expect(factory.client).not.toHaveBeenCalled();
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
        expect(factory.client).not.toHaveBeenCalled();
        expect(factory.user).not.toHaveBeenCalled();
      });
    }
  }
});
