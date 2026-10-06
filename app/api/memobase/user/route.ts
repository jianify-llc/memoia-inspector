import { z } from "zod";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoiaClient, getMemoiaUser, clearMemoiaUser, prepareMemoiaUser, initializeMemoiaUser } from "@/utils/memoia/client";
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

    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    const usersInfo = await client.listUsers({ search, order_by, order_desc, limit, offset });

    return createApiResponse(usersInfo);
  } catch (error) {
    return memoiaApiError(error);
  }
}

/**
 * 删除 user
 */
export async function DELETE(req: Request) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    await client.forgetUser(await getMemoiaUser());
    await clearMemoiaUser();
  } catch (error: unknown) {
    return memoiaApiError(error);
  }

  return createApiResponse(null, "删除成功");
}

/** 初始化分两次 HTTP：先持久会话身份，收到回执后才发送 Memoia 创建。 */
export async function POST(req: Request) {
  const rejected = rejectCrossOriginMutation(req);
  if (rejected) return rejected;
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("action" in body)) return createApiError("INVALID_INPUT", 400);
  const id = z.string().uuid().safeParse("id" in body ? body.id : null);
  if (!id.success) return createApiError("INVALID_INPUT", 400);
  try {
    if (body.action === "prepare") return createApiResponse({ id: await prepareMemoiaUser(id.data) });
    if (body.action === "initialize") return createApiResponse({ id: await initializeMemoiaUser(id.data) });
    return createApiError("INVALID_INPUT", 400);
  } catch (error) {
    return memoiaApiError(error);
  }
}
