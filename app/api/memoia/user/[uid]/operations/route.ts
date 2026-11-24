import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { memoiaClient } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";
import { MemoiaError } from "@jianify/memoia";

export async function GET(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const query = new URL(request.url).searchParams;
    const key = query.get("key");
    const operationId = query.get("operation_id");
    if (!key && !operationId) return createApiError("Operation key or ID is required", 400);
    const { uid } = await params;
    return createApiResponse(key ? await client.getOperationByKey(uid, key) : await client.getOperation(uid, operationId!));
  } catch (error) {
    return memoiaApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const body = await readJsonObject(request);
    if (body.error) return body.error;
    const input: unknown = body.data;
    const { uid } = await params;
    if (typeof input === "object" && input !== null && "seal_append" in input && typeof input.seal_append === "string") {
      let append;
      try { append = await client.getOperation(uid, input.seal_append); }
      catch (error) {
        if (error instanceof MemoiaError && error.status === 404) return createApiError("append_not_found", 410);
        throw error;
      }
      if (append.kind !== "append" || !append.source_id || append.blob_id !== append.source_id ||
          !/^playground:[a-f0-9-]{36}$/i.test(append.source_id)) {
        return createApiError("Append is not owned by Playground", 409);
      }
      if (append.status !== "staged") {
        try { return createApiResponse(await client.getOperationByKey(uid, `playground:fact:${append.operation_id}`)); }
        catch (error) {
          if (error instanceof MemoiaError && error.status === 404 && append.status === "failed") {
            return createApiError(append.error?.code || "Append failed", 409);
          }
          throw error;
        }
      }
      const operation = await client.flushBlob(uid, append.blob_id, {
        idempotency_key: `playground:fact:${append.operation_id}`, append_operation_ids: [append.operation_id],
      });
      return createApiResponse(operation, operation.status, 0, operation.status === "processing" ? 202 : 200);
    }
    if (typeof input !== "object" || input === null || !("operation_id" in input) || typeof input.operation_id !== "string") {
      return createApiError("Operation ID is required", 400);
    }
    const operation = await client.retryOperation(uid, input.operation_id, { deadline: Date.now() + 90_000 });
    return createApiResponse(operation, operation.status, 0, operation.status === "processing" ? 202 : 200);
  } catch (error) {
    return memoiaApiError(error);
  }
}
