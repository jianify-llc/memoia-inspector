import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  updateConfig: vi.fn(),
  deleteUser: vi.fn(),
  clearMemobaseUser: vi.fn(),
}));

vi.mock("@/utils/memobase/client", () => ({
  memoBaseClient: async () => sdk,
  getMemobaseUser: async () => "playground-user",
  clearMemobaseUser: sdk.clearMemobaseUser,
}));

import { PUT as updateConfig } from "@/app/api/memobase/config/route";
import { DELETE as deleteProjectUser } from "@/app/api/memobase/user/[uid]/route";
import { DELETE as deletePlaygroundUser } from "@/app/api/memobase/user/route";

beforeEach(() => vi.clearAllMocks());

describe("SDK boolean failure responses", () => {
  it("does not report failed config updates as success", async () => {
    sdk.updateConfig.mockResolvedValue(false);
    const response = await updateConfig(new Request("http://localhost/api/memobase/config", {
      method: "PUT",
      body: JSON.stringify({ config: "a: 1" }),
    }));
    expect((await response.json()).code).toBe(502);
  });

  it("does not report failed project-user deletion as success", async () => {
    sdk.deleteUser.mockResolvedValue(false);
    const response = await deleteProjectUser(new Request("http://localhost/api/memobase/user/u1"), {
      params: Promise.resolve({ uid: "u1" }),
    });
    expect((await response.json()).code).toBe(502);
  });

  it("keeps the playground user after failed deletion", async () => {
    sdk.deleteUser.mockResolvedValue(false);
    const response = await deletePlaygroundUser();
    expect((await response.json()).code).toBe(502);
    expect(sdk.clearMemobaseUser).not.toHaveBeenCalled();
  });

  it("clears the playground user only after confirmed deletion", async () => {
    sdk.deleteUser.mockResolvedValue(true);
    const response = await deletePlaygroundUser();
    expect((await response.json()).code).toBe(0);
    expect(sdk.clearMemobaseUser).toHaveBeenCalledOnce();
  });
});
