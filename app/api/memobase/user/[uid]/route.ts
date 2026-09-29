import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoBaseClient } from "@/utils/memobase/client";

/**
 * 删除 user
 * @param uid 用户ID
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  if (!uid) {
    return createApiError("Bad Request", 400);
  }
  try {
    const deleted = await (await memoBaseClient()).deleteUser(uid);
    if (!deleted) {
      return createApiError("删除失败：Memoia 未确认删除", 502);
    }
  } catch (error: unknown) {
    console.error(error);
    return createApiError("删除失败", 500);
  }

  return createApiResponse(null, "删除成功");
}
