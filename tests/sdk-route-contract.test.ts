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
import { GET as maintenance } from "@/app/api/memobase/maintenance/route";
import { POST as recoverMaintenance } from "@/app/api/memoia/user/[uid]/operations/route";
import { POST as insert } from "@/app/api/memobase/insert/route";

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

const flush = { operation_id: "22222222-2222-4222-8222-222222222222", status: "failed", blob_ids: [],
  attempts: 4, available_at: "2026-04-03T00:00:00Z",
  error: { code: "maintenance_timeout", retryable: true }, retryable: true };
const maintenanceState = { pending_blob_count: 1, flushes: [flush] };

it("validates flush status independently and recovers the original operation through the real SDK", async () => {
  transport.mockImplementation(async () => Response.json(maintenanceState));
  const status = await maintenance();
  expect(status.status).toBe(200);
  expect((await status.json()).data).toEqual(maintenanceState);
  expect(String(transport.mock.calls[0][0])).toBe(`https://contract.invalid/api/users/${uid}/maintenance`);
  const receipt = { operation_id: flush.operation_id, kind: "flush", source_id: null, blob_id: null,
    status: "processing", result: null, error: null,
    flush: { ...flush, status: "pending", attempts: 0, error: null } };
  transport.mockResolvedValue(Response.json(receipt));
  const response = await recoverMaintenance(new Request("http://localhost", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ operation_id: flush.operation_id }),
  }), { params: Promise.resolve({ uid }) });
  expect(response.status).toBe(202);
  expect((await response.json()).data).toEqual(receipt);
  expect(String(transport.mock.calls[1][0])).toBe(`https://contract.invalid/api/users/${uid}/operations/${flush.operation_id}/retry`);
  expect(transport).toHaveBeenCalledTimes(2);
});

it("keeps automatic backoff pending when the original flush has a retryable last error", async () => {
  const error = { code: "maintenance_lease_expired", retryable: true };
  const receipt = { operation_id: flush.operation_id, kind: "flush", source_id: null, blob_id: null,
    status: "processing", result: null, error,
    flush: { ...flush, status: "pending", attempts: 1, error, retryable: true } };
  transport.mockResolvedValue(Response.json(receipt));
  const response = await recoverMaintenance(new Request("http://localhost", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ operation_id: flush.operation_id }),
  }), { params: Promise.resolve({ uid }) });
  expect(response.status).toBe(202);
  expect((await response.json()).data).toEqual(receipt);
  expect(transport).toHaveBeenCalledTimes(1);
});

it("returns a fixed Fact receipt with no Event/Profile IDs instead of waiting for maintenance", async () => {
  const receipt = { operation_id: "33333333-3333-4333-8333-333333333333", blob_id: "44444444-4444-4444-8444-444444444444", source_id: "playground",
    status: "completed", result: { memory_version: 3, fact_ids: [], event_ids: [], profile_ids: [] }, error: null };
  transport.mockResolvedValue(Response.json(receipt));
  const response = await insert(new Request("http://localhost", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ idempotency_key: "fixed", messages: [{ role: "user", content: "fixture", created_at: "2026-04-03T00:00:00Z" }] }),
  }));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual(receipt);
  expect(transport).toHaveBeenCalledTimes(1);
});

it("rejects malformed maintenance progress and never fabricates an up-to-date state", async () => {
  transport.mockResolvedValue(Response.json({ ...maintenanceState, flushes: [{ ...flush, attempts: "three" }] }));
  const response = await maintenance();
  expect(response.status).toBe(502);
  expect((await response.json()).data).toBeNull();
});
