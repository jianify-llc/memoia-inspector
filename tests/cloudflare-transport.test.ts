import { afterEach, describe, expect, it, vi } from "vitest";

const { context } = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: context }));
import { memoiaConnection, memoiaEndpoint, memoiaTransport } from "../lib/memoia-transport";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("Memoia transport", () => {
  it("leaves ordinary HTTP available to self-hosted Inspector", () => {
    expect(memoiaTransport("https://one.example")).toBeUndefined();
  });
  it("rejects any endpoint other than the configured origin before network I/O", () => {
    context.mockReturnValue({ env: { MEMOIA: { fetch: vi.fn() } } });
    for (const endpoint of ["https://other.example", "http://one.example", "https://one.example/api", "https://one.example/?test=1", "https://key@one.example"]) {
      expect(memoiaEndpoint(endpoint)).toBeNull();
    }
  });
  it("does not offer a Worker or fall back to an arbitrary URL when the binding is missing", () => {
    context.mockReturnValue({ env: {} });
    expect(memoiaConnection()).toMatchObject({ managed: true, binding: undefined });
    expect(memoiaEndpoint("worker")).toBeNull();
    expect(memoiaEndpoint("https://other.example")).toBeNull();
  });
});

const accessOrigin = "https://memoia.example";
function configureAccess() {
  vi.stubEnv("MEMOIA_HTTP_ORIGIN", accessOrigin);
  vi.stubEnv("MEMOIA_ACCESS_CLIENT_ID", "fixture-client-id");
  vi.stubEnv("MEMOIA_ACCESS_CLIENT_SECRET", "fixture-client-secret");
}

describe("Memoia Access transport", () => {
  it("adds service credentials to the protected origin and keeps project authorization", async () => {
    configureAccess();
    const response = new Response(null, { status: 302, headers: { Location: "https://other.example" } });
    const network = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal("fetch", network);
    const endpoint = memoiaEndpoint(`${accessOrigin}/`);
    expect(endpoint).toBe(accessOrigin);
    const transport = memoiaTransport(endpoint!)!;
    const request = new Request(`${accessOrigin}/api/project/identity`, {
      headers: { Authorization: "Bearer fixture-project-key" },
    });

    expect(await transport(request, { redirect: "follow" })).toBe(response);
    expect(network).toHaveBeenCalledTimes(1);
    const [input, init] = network.mock.calls[0];
    expect(input).toBe(request);
    expect(init?.redirect).toBe("manual");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer fixture-project-key");
    expect(headers.get("CF-Access-Client-Id")).toBe("fixture-client-id");
    expect(headers.get("CF-Access-Client-Secret")).toBe("fixture-client-secret");
  });

  it("keeps other Docker endpoints usable without the configured token", async () => {
    configureAccess();
    expect(memoiaTransport("http://another-memoia:8080")).toBeUndefined();
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const transport = memoiaTransport(accessOrigin)!;
    for (const endpoint of ["https://memoia.example.other.example/api", "http://memoia.example/api", "https://memoia.example:8443/api"]) {
      await expect(transport(endpoint)).rejects.toThrow("configured Access origin");
    }
    expect(network).not.toHaveBeenCalled();
  });

  it.each(["MEMOIA_HTTP_ORIGIN", "MEMOIA_ACCESS_CLIENT_ID", "MEMOIA_ACCESS_CLIENT_SECRET"])(
    "rejects an incomplete Access configuration without %s",
    variable => {
      configureAccess();
      vi.stubEnv(variable, "");
      expect(() => memoiaTransport(accessOrigin)).toThrow("requires an origin, client ID and client secret");
    },
  );

  it("keeps both approved Cloudflare connections separate", async () => {
    configureAccess();
    const bound = vi.fn().mockResolvedValue(new Response());
    const network = vi.fn().mockResolvedValue(new Response());
    context.mockReturnValue({ env: { MEMOIA: { fetch: bound } } });
    vi.stubGlobal("fetch", network);
    expect(memoiaConnection().binding?.fetch).toBe(bound);
    expect(memoiaEndpoint("worker")).toBe("worker");
    await memoiaTransport(accessOrigin)!(`${accessOrigin}/api`);
    expect(network).toHaveBeenCalledTimes(1);
    expect(bound).not.toHaveBeenCalled();
    expect(memoiaEndpoint("https://online.example")).toBeNull();
  });

  it("allows an approved HTTPS origin without an Access token", () => {
    context.mockReturnValue({ env: {} });
    vi.stubEnv("MEMOIA_HTTP_ORIGIN", accessOrigin);
    expect(memoiaTransport(accessOrigin)).toBeUndefined();
    expect(memoiaEndpoint("https://online.example")).toBeNull();
  });

  it("rejects configured HTTP origins with a path", () => {
    configureAccess();
    vi.stubEnv("MEMOIA_HTTP_ORIGIN", `${accessOrigin}/api`);
    expect(() => memoiaTransport(accessOrigin)).toThrow("MEMOIA_HTTP_ORIGIN must be an HTTPS origin");
  });
});
