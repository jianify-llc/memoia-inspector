import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { memoiaClient } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";

export async function DELETE(_request: Request, { params }: { params: Promise<{ project_id: string; key_id: string }> }) {
  const originError = rejectCrossOriginMutation(_request);
  if (originError) return originError;
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const { project_id, key_id } = await params;
    await client.revokeKey(project_id, key_id);
    return createApiResponse(null, "Revoked");
  } catch (error) { return memoiaApiError(error); }
}
