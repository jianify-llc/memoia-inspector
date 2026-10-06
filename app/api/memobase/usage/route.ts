import { memoiaApiError } from "@/lib/memoia-api-response";
import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoiaClient } from "@/utils/memoia/client";

/**
 * 获取项目用量
 * @returns 用量
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const last_days = parseInt(searchParams.get("last_days") || "7");

    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    const { usages } = await client.getUsage(last_days);

    const sortedUsage = [...usages].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return createApiResponse({ usages: sortedUsage });
  } catch (error) {
    return memoiaApiError(error);
  }
}
