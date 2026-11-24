import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";
import { memoiaClient } from "@/utils/memoia/client";

export async function PUT(request: Request, { params }: { params: Promise<{ uid: string; fact_id: string }> }) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const body = await readJsonObject(request);
    if (body.error) return body.error;
    const { uid, fact_id } = await params;
    const operation = await client.updateFact(uid, fact_id, body.data as Parameters<typeof client.updateFact>[2], { deadline: Date.now() + 90_000 });
    return createApiResponse(operation, operation.status, 0, operation.status === "processing" ? 202 : 200);
  } catch (error) {
    return memoiaApiError(error);
  }
}
