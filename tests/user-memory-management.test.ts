import { beforeEach, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ updateEvent: vi.fn() }));
vi.mock("@/utils/memoia/client", () => ({ memoiaClient: vi.fn(async () => sdk) }));
import { POST } from "@/app/api/memobase/user/[uid]/memories/route";

beforeEach(() => vi.resetAllMocks());

it("updates only fields edited on the selected event", async () => {
  const req = new Request("https://inspector.example/api/memobase/user/u/memories", {
    method: "POST", headers: { origin: "https://inspector.example", "content-type": "application/json", "x-memoia-project": "p", "x-memoia-endpoint": "https://memoia.example" },
    body: JSON.stringify({ action: "updateEvent", id: "event", content: "new body" }),
  });
  expect((await POST(req, { params: Promise.resolve({ uid: "selected-user" }) })).status).toBe(200);
  expect(sdk.updateEvent).toHaveBeenCalledWith("selected-user", "event", { content: "new body" });
});

it("does not send an empty event update", async () => {
  const req = new Request("https://inspector.example/api/memobase/user/u/memories", {
    method: "POST", headers: { origin: "https://inspector.example", "content-type": "application/json", "x-memoia-project": "p", "x-memoia-endpoint": "https://memoia.example" },
    body: JSON.stringify({ action: "updateEvent", id: "event" }),
  });
  expect((await POST(req, { params: Promise.resolve({ uid: "selected-user" }) })).status).toBe(400);
  expect(sdk.updateEvent).not.toHaveBeenCalled();
});
