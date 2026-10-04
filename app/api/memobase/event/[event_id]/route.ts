import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoBaseClient, getMemobaseUser } from "@/utils/memobase/client";
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
    const user = await (await memoBaseClient()).getOrCreateUser(await getMemobaseUser());
    await user.deleteEvent(event_id);
  } catch (error: unknown) {
    console.error(error);
    return createApiError("删除失败", 500);
  }

  return createApiResponse(null, "删除成功");
}
