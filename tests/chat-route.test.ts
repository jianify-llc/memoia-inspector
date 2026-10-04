import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ memoBaseClient: vi.fn() }));

vi.mock("@/utils/memobase/client", () => ({
  memoBaseClient: sdk.memoBaseClient,
  getMemobaseUser: vi.fn(),
}));

import { GET, POST } from "@/app/api/chat/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("optional Playground model", () => {
  it.each([
    ["", "https://api.openai.com/v1", "test-model"],
    ["test-key", "https://api.openai.com/v1", ""],
    ["test-key", "", "test-model"],
  ])("does not create a user or write memory when model config is incomplete", async (key, url, model) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    vi.stubEnv("OPENAI_BASE_URL", url);
    vi.stubEnv("OPENAI_MODEL", model);

    const statusResponse = await GET();
    const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { origin: "http://localhost" } }));

    expect(statusResponse.status).toBe(200);
    expect(await statusResponse.json()).toEqual({ enabled: false });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("not configured");
    expect(sdk.memoBaseClient).not.toHaveBeenCalled();
  });

  it("reports enabled only when the optional model config is complete", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
    vi.stubEnv("OPENAI_MODEL", "test-model");

    const response = await GET();

    expect(await response.json()).toEqual({ enabled: true });
    expect(sdk.memoBaseClient).not.toHaveBeenCalled();
  });
});
