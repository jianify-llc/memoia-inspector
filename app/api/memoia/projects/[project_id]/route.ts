import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { memoiaClient } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";

export async function PATCH(request: Request, { params }: { params: Promise<{ project_id: string }> }) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const body = await readJsonObject(request);
    if (body.error) return body.error;
    const input: unknown = body.data;
    const { project_id } = await params;
    return createApiResponse(await client.updateProject(project_id, input as Parameters<typeof client.updateProject>[1]));
  } catch (error) { return memoiaApiError(error); }
}
