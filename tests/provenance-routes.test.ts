import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoiaError } from "@jianify/memoia";

const sdk = vi.hoisted(() => ({ listSources: vi.fn(), listOperations: vi.fn(), getProfiles: vi.fn(), getHistory: vi.fn(), getSource: vi.fn(), deleteMessages: vi.fn(), getOperationByKey: vi.fn(), retryOperation: vi.fn() }));
const factory = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/utils/memoia/client", () => ({ memoiaClient: factory.client }));
import { GET as provenance } from "@/app/api/memoia/user/[uid]/provenance/route";
import { GET as sourceDetail } from "@/app/api/memoia/user/[uid]/sources/[source_id]/route";
import { POST as retract } from "@/app/api/memoia/user/[uid]/sources/[source_id]/messages/delete/route";
import { GET as operation, POST as resume } from "@/app/api/memoia/user/[uid]/operations/route";

beforeEach(() => {
  vi.resetAllMocks();
  factory.client.mockResolvedValue(sdk);
  sdk.listSources.mockResolvedValue({ sources: [] });
  sdk.listOperations.mockResolvedValue({ operations: [] });
  sdk.getProfiles.mockResolvedValue({ profiles: [] });
  sdk.getHistory.mockResolvedValue({ entries: [] });
});
const params = { params: Promise.resolve({ uid: "user", source_id: "source" }) };
const mutationHeaders = { origin: "http://localhost", "content-type": "application/json" };

describe("v2 provenance management", () => {
  it("passes independent bounded detail offsets without mixing them with request options", async () => {
    sdk.getSource.mockResolvedValue({ source_id: "source" });
    const request = new Request("http://localhost?limit=20&message_offset=40&evidence_offset=10");
    expect((await sourceDetail(request, params)).status).toBe(200);
    expect(sdk.getSource).toHaveBeenCalledWith("user", "source", { signal: request.signal },
      { limit: 20, message_offset: 40, blob_offset: 0, evidence_offset: 10 });
  });

  it.each(["limit=101", "limit=0", "message_offset=-1", "evidence_offset=NaN", "blob_offset=1.5"])("rejects invalid detail page %s before backend access", async (query) => {
    expect((await sourceDetail(new Request(`http://localhost?${query}`), params)).status).toBe(400);
    expect(sdk.getSource).not.toHaveBeenCalled();
    expect(factory.client).not.toHaveBeenCalled();
  });
  it("paginates durable operation status separately from profile version history", async () => {
    const response = await provenance(new Request("http://localhost?limit=20&offset=40"), params);
    expect(response.status).toBe(200);
    expect(sdk.listSources).toHaveBeenCalledWith("user", { limit: 20, offset: 40 });
    expect(sdk.getHistory).toHaveBeenCalledWith("user", { limit: 20, offset: 40 });
    expect(sdk.listOperations).toHaveBeenCalledWith("user", { limit: 20, offset: 40 });
    expect((await response.json()).data).toEqual({ sources: [], profiles: [], history: [], operations: [] });
  });

  it("rejects an invalid page before invoking the backend", async () => {
    expect((await provenance(new Request("http://localhost?limit=101"), params)).status).toBe(400);
    expect(sdk.listSources).not.toHaveBeenCalled();
  });
  it("rejects all reads and mutations without project credentials", async () => {
    factory.client.mockResolvedValue(null);
    expect((await provenance(new Request("http://localhost"), params)).status).toBe(401);
    expect((await retract(new Request("http://localhost", { method: "POST", headers: mutationHeaders }), params)).status).toBe(401);
    expect(sdk.deleteMessages).not.toHaveBeenCalled();
  });

  it("does not render stale or partial provenance after any read fails", async () => {
    sdk.listSources.mockResolvedValue({ sources: [] });
    sdk.getProfiles.mockRejectedValue(new MemoiaError("UNAUTHORIZED", 401, false));
    sdk.getHistory.mockResolvedValue({ entries: [] });
    const response = await provenance(new Request("http://localhost"), params);
    expect(response.status).toBe(401);
    expect((await response.json()).data).toBeNull();
  });

  it("keeps asynchronous processing distinct from completed retraction", async () => {
    sdk.deleteMessages.mockResolvedValue({ status: "processing", operation_id: "op", result: null });
    const input = { idempotency_key: "fixed-key", message_ids: ["m1"] };
    const response = await retract(new Request("http://localhost", { method: "POST", headers: mutationHeaders, body: JSON.stringify(input) }), params);
    expect(response.status).toBe(202);
    expect((await response.json()).data.status).toBe("processing");
    expect(sdk.deleteMessages).toHaveBeenCalledWith("user", "source", input, expect.objectContaining({ deadline: expect.any(Number) }));
  });

  it("reports lost acknowledgement as unknown, never successful deletion", async () => {
    sdk.deleteMessages.mockRejectedValue(new MemoiaError("TRANSPORT_ERROR", null, false, "unknown"));
    const response = await retract(new Request("http://localhost", { method: "POST", headers: mutationHeaders, body: JSON.stringify({ idempotency_key: "fixed-key", message_ids: ["m1"] }) }), params);
    expect(response.status).toBe(502);
    expect((await response.json()).message).toBe("OUTCOME_UNKNOWN");
  });

  it("queries the existing operation key without replaying the write", async () => {
    sdk.getOperationByKey.mockResolvedValue({ status: "completed", result: { event_ids: [], profile_ids: [] } });
    const response = await operation(new Request("http://localhost?key=fixed-key"), params);
    expect(response.status).toBe(200);
    expect(sdk.getOperationByKey).toHaveBeenCalledWith("user", "fixed-key");
    expect(sdk.deleteMessages).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before calling Memoia", async () => {
    const response = await retract(new Request("http://localhost", { method: "POST", headers: mutationHeaders, body: "{" }), params);
    expect(response.status).toBe(400);
    expect(sdk.deleteMessages).not.toHaveBeenCalled();
  });

  it("recovers only the server's accepted operation, never resending message bodies", async () => {
    sdk.retryOperation.mockResolvedValue({ status: "processing", operation_id: "op", result: null });
    const response = await resume(new Request("http://localhost", { method: "POST", headers: mutationHeaders, body: JSON.stringify({ operation_id: "op" }) }), params);
    expect(response.status).toBe(202);
    expect(sdk.retryOperation).toHaveBeenCalledWith("user", "op", expect.objectContaining({ deadline: expect.any(Number) }));
    expect(sdk.deleteMessages).not.toHaveBeenCalled();
  });
});
