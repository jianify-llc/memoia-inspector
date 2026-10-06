import { memoiaApiError } from "@/lib/memoia-api-response";
import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoiaClient } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";

/**
 * 删除 user
 * @param uid 用户ID
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const { uid } = await params;
  if (!uid) {
    return createApiError("Bad Request", 400);
  }
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    await client.forgetUser(uid);
  } catch (error: unknown) {
    return memoiaApiError(error);
  }

  return createApiResponse(null, "删除成功");
}
