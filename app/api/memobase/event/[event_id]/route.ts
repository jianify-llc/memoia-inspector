import { memoiaApiError } from "@/lib/memoia-api-response";
import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoiaClient, getMemoiaUser } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";

/**
 * 删除 event
 * @param event_id event ID
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ event_id: string }> }) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const { event_id } = await params;
  if (!event_id) {
    return createApiError("Bad Request", 400);
  }

  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    await client.deleteEvent(await getMemoiaUser(), event_id);
  } catch (error: unknown) {
    return memoiaApiError(error);
  }

  return createApiResponse(null, "删除成功");
}
