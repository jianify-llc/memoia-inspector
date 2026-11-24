import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { memoiaClient } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";

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
    if (typeof input !== "object" || input === null || !("operation_id" in input) || typeof input.operation_id !== "string") {
      return createApiError("Operation ID is required", 400);
    }
    const { uid } = await params;
    const operation = await client.retryOperation(uid, input.operation_id, { deadline: Date.now() + 90_000 });
    return createApiResponse(operation, operation.status, 0, operation.status === "processing" ? 202 : 200);
  } catch (error) {
    return memoiaApiError(error);
  }
}
