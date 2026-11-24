import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  updateConfig: vi.fn(),
  forgetUser: vi.fn(),
  clearMemoiaUser: vi.fn(),
}));

vi.mock("@/utils/memoia/client", () => ({
  memoiaClient: async () => sdk,
  getMemoiaUser: async () => "playground-user",
  clearMemoiaUser: sdk.clearMemoiaUser,
}));

import { PUT as updateConfig } from "@/app/api/memobase/config/route";
import { DELETE as deleteProjectUser } from "@/app/api/memobase/user/[uid]/route";
import { DELETE as deletePlaygroundUser } from "@/app/api/memobase/user/route";

beforeEach(() => vi.clearAllMocks());

describe("Typed SDK mutation acknowledgements", () => {
  it("does not report failed config updates as success", async () => {
    sdk.updateConfig.mockRejectedValue(new Error("rejected"));
    const response = await updateConfig(new Request("http://localhost/api/memobase/config", {
      method: "PUT",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ config: "a: 1" }),
    }));
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe(502);
  });

  it("does not report failed project-user deletion as success", async () => {
    sdk.forgetUser.mockRejectedValue(new Error("rejected"));
    const response = await deleteProjectUser(new Request("http://localhost/api/memobase/user/u1", { method: "DELETE", headers: { origin: "http://localhost" } }), {
      params: Promise.resolve({ uid: "u1" }),
    });
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe(502);
  });

  it("keeps the playground user after failed deletion", async () => {
    sdk.forgetUser.mockRejectedValue(new Error("rejected"));
    const response = await deletePlaygroundUser(new Request("http://localhost/api/memobase/user", { method: "DELETE", headers: { origin: "http://localhost" } }));
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe(502);
    expect(sdk.clearMemoiaUser).not.toHaveBeenCalled();
  });

  it("clears the playground user only after confirmed deletion", async () => {
    sdk.forgetUser.mockResolvedValue({ user_id: "playground-user", forgotten: true });
    const response = await deletePlaygroundUser(new Request("http://localhost/api/memobase/user", { method: "DELETE", headers: { origin: "http://localhost" } }));
    expect(response.status).toBe(200);
    expect((await response.json()).code).toBe(0);
    expect(sdk.clearMemoiaUser).toHaveBeenCalledOnce();
  });
});
