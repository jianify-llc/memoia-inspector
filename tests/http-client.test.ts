import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiError } from "@/lib/api-response";

afterEach(() => vi.unstubAllGlobals());

describe("Inspector API response contract", () => {
  it("keeps the legacy error code while returning an HTTP failure", async () => {
    const response = createApiError();
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe(1);
  });

  it("keeps the business error body when HTTP reports a failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ code: 502, data: null, message: "Memoia rejected the update" }, { status: 502 })
    ));
    const { default: service } = await import("@/api/http");

    const response = await service.put<{ code: number; message: string }>(
      "/api/memobase/config",
      { config: "a: 1" }
    );

    expect(response).toEqual({ code: 502, data: null, message: "Memoia rejected the update" });
  });
});
