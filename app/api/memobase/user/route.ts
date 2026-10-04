import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoBaseClient, getMemobaseUser, clearMemobaseUser } from "@/utils/memobase/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";

/**
 * 获取项目用户
 * @returns 用户
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const order_by = (searchParams.get("order_by") || "updated_at") as "updated_at" | "profile_count" | "event_count";
    const order_desc = searchParams.get("order_desc") === "true";
    const limit = parseInt(searchParams.get("limit") || "10");
    const offset = parseInt(searchParams.get("offset") || "0");

    const usersInfo = await (await memoBaseClient()).getUsers(search, order_by, order_desc, limit, offset)

    return createApiResponse(usersInfo);
  } catch (error) {
    console.error(error);
    return createApiError("Internal Server Error", 500);
  }
}

/**
 * 删除 user
 */
export async function DELETE(req: Request) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  try {
    const deleted = await (await memoBaseClient()).deleteUser(await getMemobaseUser());
    if (!deleted) {
      return createApiError("删除失败：Memoia 未确认删除", 502);
    }
    await clearMemobaseUser();
  } catch (error: unknown) {
    console.error(error);
    return createApiError("删除失败", 500);
  }

  return createApiResponse(null, "删除成功");
}
