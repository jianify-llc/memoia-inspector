import { beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => vi.fn());
const uid = "11111111-1111-4111-8111-111111111111";
vi.mock("@/utils/memoia/client", async () => {
  const { MemoiaClient } = await import("@jianify/memoia");
  return {
    memoiaClient: async () => new MemoiaClient({ baseUrl: "https://contract.invalid", apiKey: "fixture-only", fetch: transport, maxAttempts: 2 }),
    getMemoiaUser: async () => "11111111-1111-4111-8111-111111111111",
  };
});
import { GET as source } from "@/app/api/memoia/user/[uid]/sources/[source_id]/route";
import { GET as profiles, POST as addProfile } from "@/app/api/memobase/profile/route";

beforeEach(() => transport.mockReset());

it("valid bounded source pages traverse real SDK request and response validation", async () => {
  const data = { source_id: "dialog", legacy: false, created_at: "2026-04-03T00:00:00Z",
    message_ids: [], deleted_message_ids: [], blobs: [], evidence: [],
    next_message_offset: null, next_blob_offset: null, next_evidence_offset: null };
  transport.mockResolvedValue(Response.json(data));
  const result = await source(new Request("http://localhost?limit=20&message_offset=50&blob_offset=80&evidence_offset=100"),
    { params: Promise.resolve({ uid, source_id: "dialog" }) });
  expect(result.status).toBe(200);
  expect((await result.json()).data).toEqual(data);
  const url = new URL(transport.mock.calls[0][0]);
  expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "20", message_offset: "50", blob_offset: "80", evidence_offset: "100" });
});

it("unrecognized page windows are rejected before network I/O", async () => {
  const result = await source(new Request("http://localhost?message_limit=20"), { params: Promise.resolve({ uid, source_id: "dialog" }) });
  expect(result.status).toBe(400);
  expect(transport).not.toHaveBeenCalled();
});

it("profile authentication failures retain their HTTP classification", async () => {
  transport.mockResolvedValue(Response.json({ detail: { code: "UNAUTHORIZED", retryable: false } }, { status: 401 }));
  expect((await profiles()).status).toBe(401);
});

it("unknown profile creation is sent once and never reported as a rejection or success", async () => {
  transport.mockResolvedValue(Response.json({ detail: { code: "internal_error", retryable: true } }, { status: 500 }));
  const result = await addProfile(new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ content: "Kyoto hotel", topic: "travel", sub_topic: "hotel" }) }));
  expect(result.status).toBe(502);
  expect((await result.json()).message).toBe("OUTCOME_UNKNOWN");
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each(["{", "null", '{"content":42,"topic":"travel","sub_topic":"hotel"}'])("malformed profile body is a controlled client error: %s", async body => {
  const result = await addProfile(new Request("http://localhost", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body }));
  expect(result.status).toBe(400);
  expect(transport).not.toHaveBeenCalled();
});
