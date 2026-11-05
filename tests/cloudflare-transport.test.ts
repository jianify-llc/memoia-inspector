import { afterEach, describe, expect, it, vi } from "vitest";

const { context } = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: context }));
import { memoiaTransport } from "../lib/memoia-transport";

afterEach(() => { delete process.env.MEMOIA_BINDING_ORIGIN; vi.resetAllMocks(); });

describe("Memoia transport", () => {
  it("leaves ordinary HTTP available to self-hosted Inspector", () => {
    expect(memoiaTransport("https://one.example")).toBeUndefined();
    expect(context).not.toHaveBeenCalled();
  });
  it("rejects any endpoint other than the configured origin before network I/O", () => {
    process.env.MEMOIA_BINDING_ORIGIN = "https://one.example";
    for (const endpoint of ["https://other.example", "http://one.example", "https://one.example/api", "https://one.example/?test=1", "https://key@one.example"]) {
      expect(() => memoiaTransport(endpoint)).toThrow("does not match");
    }
    expect(context).not.toHaveBeenCalled();
  });
  it("uses the binding for the configured origin and propagates failure", async () => {
    process.env.MEMOIA_BINDING_ORIGIN = "https://one.example";
    const failure = new Error("binding failed");
    const bindingFetch = vi.fn().mockRejectedValue(failure);
    context.mockReturnValue({ env: { MEMOIA: { fetch: bindingFetch } } });
    const transport = memoiaTransport("https://one.example/")!;
    await expect(transport("https://one.example/path")).rejects.toBe(failure);
    expect(bindingFetch).toHaveBeenCalledOnce();
  });
  it("does not hide context or missing binding errors", () => {
    process.env.MEMOIA_BINDING_ORIGIN = "https://one.example";
    context.mockImplementationOnce(() => { throw new Error("no context"); });
    expect(() => memoiaTransport("https://one.example")).toThrow("no context");
    context.mockReturnValue({ env: {} });
    expect(() => memoiaTransport("https://one.example")).toThrow("binding is missing");
  });
  it("rejects invalid binding origin configuration", () => {
    process.env.MEMOIA_BINDING_ORIGIN = "https://one.example/path";
    expect(() => memoiaTransport("https://one.example")).toThrow("HTTPS origin");
  });
});
