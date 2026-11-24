import { beforeEach, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => vi.fn());
const uid = "11111111-1111-4111-8111-111111111111";
vi.mock("@/utils/memoia/client", async () => {
  const { MemoiaClient } = await import("@jianify/memoia");
  return {
    memoiaClient: async () => new MemoiaClient({ baseUrl: "https://contract.invalid", apiKey: "fixture-only", fetch: transport, maxAttempts: 2 }),
    getMemoiaUser: async () => "11111111-1111-4111-8111-111111111111",
    getLocale: async () => ["https://contract.invalid", "fixture-only"],
  };
});
import { GET as source } from "@/app/api/memoia/user/[uid]/sources/[source_id]/route";
import { GET as profiles, POST as addProfile } from "@/app/api/memobase/profile/route";
import { GET as maintenance } from "@/app/api/memobase/maintenance/route";
import { POST as recoverMaintenance } from "@/app/api/memoia/user/[uid]/operations/route";
import { POST as insert } from "@/app/api/memobase/insert/route";
import { GET as usage } from "@/app/api/memobase/usage/route";
import { GET as provenance } from "@/app/api/memoia/user/[uid]/provenance/route";
import { signChain } from "@/lib/playground-chain";

beforeEach(() => { transport.mockReset(); });

it("preserves usage completeness through server SDK validation and the same-origin API", async () => {
  const data = { usages: [{ date: "2026-10-09", total_input_token: 10, total_output_token: 5,
    total_insert: 0, total_success_insert: 0, usage_complete: false }] };
  transport.mockResolvedValue(Response.json(data));
  const result = await usage(new Request("http://localhost?last_days=1"));
  expect(result.status).toBe(200);
  expect((await result.json()).data).toEqual(data);
});

it("returns an error for missing usage values instead of successful zero statistics", async () => {
  transport.mockResolvedValue(Response.json({ usages: [{ date: "2026-10-09", total_insert: 0,
    total_success_insert: 0, total_output_token: 5, usage_complete: false }] }));
  const result = await usage(new Request("http://localhost?last_days=1"));
  expect(result.status).toBe(502);
  expect((await result.json()).message).toBe("INVALID_RESPONSE");
  expect(transport).toHaveBeenCalledOnce();
});

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

it("stages the session turn and seals its exact append without waiting for Fact completion", async () => {
  const session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const project = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const sourceId = `playground:${session}`;
  const append = { operation_id: "33333333-3333-4333-8333-333333333333", blob_id: sourceId, source_id: sourceId,
    kind: "append", status: "staged", result: null, error: null };
  const receipt = { ...append, operation_id: "44444444-4444-4444-8444-444444444444", kind: "fact_flush", status: "processing" };
  transport.mockResolvedValueOnce(Response.json({ project_id: project }))
    .mockResolvedValueOnce(Response.json(append, { status: 202 }))
    .mockResolvedValueOnce(Response.json({ project_id: project }))
    .mockResolvedValueOnce(Response.json(receipt, { status: 202 }));
  const signed = signChain({ projectId: project, userId: uid, sessionId: session }, "response", "a".repeat(64),
    [{ role: "user", content: "fixture" }], [], "fixture-only");
  const response = await insert(new Request("http://localhost", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ action: "append", session_id: session, chain_receipt: signed, idempotency_key: "fixed", messages: [{ role: "user", content: "fixture", created_at: "2026-04-03T00:00:00Z" }] }),
  }));
  expect(response.status).toBe(202);
  expect((await response.json()).data).toEqual(append);
  const sealed = await insert(new Request("http://localhost", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ action: "seal", session_id: session, chain_receipt: signed, idempotency_key: "fixed", append_operation_id: append.operation_id }),
  }));
  expect(sealed.status).toBe(202);
  expect((await sealed.json()).data).toEqual(receipt);
  expect(transport).toHaveBeenCalledTimes(4);
  const request = JSON.parse(String(transport.mock.calls[3][1].body));
  expect(request).toEqual({ idempotency_key: `playground:fact:${append.operation_id}`, append_operation_ids: [append.operation_id] });
  expect(String(transport.mock.calls[3][0])).toContain(`/blobs/${encodeURIComponent(sourceId)}/flush`);
});

it("rejects a receipt from the previous user before any message write", async () => {
  const session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const project = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const signed = signChain({ projectId: project, userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", sessionId: session },
    "response", "a".repeat(64), [{ role: "user", content: "fixture" }], [], "fixture-only");
  transport.mockResolvedValueOnce(Response.json({ project_id: project }));
  const response = await insert(new Request("http://localhost", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ action: "append", session_id: session, chain_receipt: signed, idempotency_key: "fixed",
      messages: [{ role: "user", content: "fixture", created_at: "2026-04-03T00:00:00Z" }] }),
  }));
  expect(response.status).toBe(409);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(String(transport.mock.calls[0][0]).endsWith("/api/project/identity")).toBe(true);
});

it("loads provenance containing the current append and Fact task through the real SDK", async () => {
  const sourceId = "playground:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const append = { operation_id: "33333333-3333-4333-8333-333333333333", blob_id: sourceId, source_id: sourceId,
    kind: "append", status: "staged", result: null, error: null };
  const flush = { ...append, operation_id: "44444444-4444-4444-8444-444444444444", kind: "fact_flush", status: "processing" };
  transport.mockImplementation(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/sources")) return Response.json({ sources: [] });
    if (path.endsWith("/profiles")) return Response.json({ profiles: [] });
    if (path.endsWith("/history")) return Response.json({ entries: [] });
    if (path.endsWith("/operations")) return Response.json({ operations: [append, flush] });
    if (path.endsWith("/maintenance")) return Response.json({ pending_blob_count: 0, flushes: [] });
    throw new Error(`Unexpected request ${path}`);
  });
  const response = await provenance(new Request("http://localhost"), { params: Promise.resolve({ uid }) });
  expect(response.status).toBe(200);
  expect((await response.json()).data.operations).toEqual([append, flush]);
});

it("does not seal another caller's staged append", async () => {
  const append = { operation_id: "33333333-3333-4333-8333-333333333333", blob_id: "luvel-session", source_id: "luvel-session",
    kind: "append", status: "staged", result: null, error: null };
  transport.mockResolvedValueOnce(Response.json(append));
  const response = await recoverMaintenance(new Request("http://localhost", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ seal_append: append.operation_id }),
  }), { params: Promise.resolve({ uid }) });
  expect(response.status).toBe(409);
  expect(transport).toHaveBeenCalledTimes(1);
});

it("unblocks a recovery when the staged append was permanently removed", async () => {
  transport.mockResolvedValueOnce(Response.json({ detail: { code: "operation_not_found", retryable: false } }, { status: 404 }));
  const response = await recoverMaintenance(new Request("http://localhost", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ seal_append: "33333333-3333-4333-8333-333333333333" }),
  }), { params: Promise.resolve({ uid }) });
  expect(response.status).toBe(410);
  expect((await response.json()).message).toBe("append_not_found");
});

it.each(["append", "flush"])("confirms a lost %s acknowledgement using the original key", async (lost) => {
  const session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const project = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const sourceId = `playground:${session}`;
  const append = { operation_id: "33333333-3333-4333-8333-333333333333", blob_id: sourceId, source_id: sourceId,
    kind: "append", status: "staged", result: null, error: null };
  const flush = { ...append, operation_id: "44444444-4444-4444-8444-444444444444", kind: "fact_flush", status: "processing" };
  transport.mockImplementation(async (url, options) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/project/identity") return Response.json({ project_id: project });
    if (path.endsWith("/blobs")) {
      if (lost === "append") throw new Error("lost acknowledgement");
      return Response.json(append, { status: 202 });
    }
    if (path.endsWith("/flush")) {
      if (lost === "flush") throw new Error("lost acknowledgement");
      return Response.json(flush, { status: 202 });
    }
    if (options?.method === "GET" && path.includes("/operations/by-key/")) return Response.json(lost === "append" ? append : flush);
    throw new Error(`Unexpected request ${path}`);
  });
  const signed = signChain({ projectId: project, userId: uid, sessionId: session }, "response", "a".repeat(64),
    [{ role: "user", content: "fixture" }], [], "fixture-only");
  const response = await insert(new Request("http://localhost", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ action: "append", session_id: session, chain_receipt: signed, idempotency_key: "fixed",
      messages: [{ role: "user", content: "fixture", created_at: "2026-04-03T00:00:00Z" }] }),
  }));
  expect(response.status).toBe(202);
  expect((await response.json()).data).toEqual(append);
  const sealed = await insert(new Request("http://localhost", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ action: "seal", session_id: session, chain_receipt: signed, idempotency_key: "fixed", append_operation_id: append.operation_id }),
  }));
  expect(sealed.status).toBe(202);
  expect((await sealed.json()).data).toEqual(flush);
  const writes = transport.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(writes).toHaveLength(2);
  const key = lost === "append" ? "playground:append:fixed" : `playground:fact:${append.operation_id}`;
  expect(transport.mock.calls.some(([url]) => String(url).includes(encodeURIComponent(key)))).toBe(true);
});

it("rejects malformed maintenance progress and never fabricates an up-to-date state", async () => {
  transport.mockResolvedValue(Response.json({ ...maintenanceState, flushes: [{ ...flush, attempts: "three" }] }));
  const response = await maintenance();
  expect(response.status).toBe(502);
  expect((await response.json()).data).toBeNull();
});
