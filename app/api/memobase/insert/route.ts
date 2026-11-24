import { MemoiaError, type Operation } from "@jianify/memoia";
import { createApiResponse, createApiError } from "@/lib/api-response";
import { memoiaClient, getLocale, getMemoiaUser } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { readJsonObject } from "@/lib/json-body";
import { readChain } from "@/lib/playground-chain";

export async function POST(req: Request) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const body = await readJsonObject(req);
  if (body.error) return body.error;
  const { action, session_id, chain_receipt, idempotency_key } = body.data;
  if (typeof session_id !== "string" || !/^[a-f0-9-]{36}$/i.test(session_id) ||
      typeof idempotency_key !== "string" || !idempotency_key || idempotency_key.length > 200 || idempotency_key.includes("/")) {
    return createApiError("Invalid Playground identity", 400);
  }
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    const uid = await getMemoiaUser();
    const [project, locale] = await Promise.all([client.getProjectIdentity(), getLocale()]);
    try {
      if (!readChain(chain_receipt, locale[1], { projectId: project.project_id, userId: uid, sessionId: session_id })) {
        return createApiError("Invalid Playground receipt", 409);
      }
    } catch { return createApiError("Playground user or project changed", 409); }

    const sourceId = `playground:${session_id}`;
    const appendKey = `playground:append:${idempotency_key}`;
    const appendOperationId = body.data.append_operation_id;
    const flushKey = `playground:fact:${appendOperationId}`;
    if (action === "status" || action === "retry") {
      if (typeof appendOperationId !== "string") return createApiError("Append operation ID is required", 400);
      const operation = await client.getOperationByKey(uid, flushKey);
      if (operation.kind !== "fact_flush" || operation.source_id !== sourceId) return createApiError("Invalid operation", 409);
      if (action === "retry" && operation.status === "failed" && operation.error?.retryable) {
        return createApiResponse(await client.retryOperation(uid, operation.operation_id));
      }
      return createApiResponse(operation);
    }
    // Unknown write outcomes are read by the same key; no request body is replayed automatically.
    const accepted = async (key: string, write: () => Promise<Operation>) => {
      try { return await write(); }
      catch (error) {
        if (!(error instanceof MemoiaError) || error.outcome !== "unknown") throw error;
        try { return await client.getOperationByKey(uid, key); }
        catch { throw error; }
      }
    };
    if (action === "append-status") {
      const operation = await client.getOperationByKey(uid, appendKey);
      if (operation.kind !== "append" || operation.source_id !== sourceId) return createApiError("Invalid append receipt", 409);
      return createApiResponse(operation);
    }
    if (action === "append") {
      const { messages } = body.data;
      if (!Array.isArray(messages) || !messages.length || messages.some(message =>
        !message || typeof message.created_at !== "string" || typeof message.content !== "string" ||
        (message.role !== "user" && message.role !== "assistant"))) return createApiError("Bad Request", 400);
      const operation = await accepted(appendKey, () => client.importBlob(uid, { source_id: sourceId, idempotency_key: appendKey,
        messages: messages.map((message, index) => ({ role: message.role, content: message.content,
          message_id: `${idempotency_key}:${index}`, occurred_at: message.created_at })) }));
      if (operation.kind !== "append" || operation.source_id !== sourceId || operation.blob_id !== sourceId) {
        return createApiError("Invalid append receipt", 502);
      }
      return createApiResponse(operation, operation.status, 0, 202);
    }
    if (action !== "seal" || typeof appendOperationId !== "string") return createApiError("Invalid Playground action", 400);
    const operation = await accepted(flushKey, () => client.flushBlob(uid, sourceId, {
      idempotency_key: flushKey, append_operation_ids: [appendOperationId],
    }));
    if (operation.kind !== "fact_flush" || operation.source_id !== sourceId || operation.blob_id !== sourceId) {
      return createApiError("Invalid Fact receipt", 502);
    }
    return createApiResponse(operation, operation.status, 0, operation.status === "processing" ? 202 : 200);
  } catch (error) {
    return memoiaApiError(error);
  }
}
