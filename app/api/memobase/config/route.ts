import { memoiaApiError } from "@/lib/memoia-api-response";
import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoiaClient } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";

/**
 * 获取项目配置
 * @returns 项目配置
 */
export async function GET() {
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    const { profile_config: config } = await client.getConfig();

    return createApiResponse(config);
  } catch (error) {
    return memoiaApiError(error);
  }
}

/**
 * 更新项目配置
 */
export async function PUT(req: Request) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const body = await readJsonObject(req);
  if (body.error) return body.error;
  const { config } = body.data;
  if (!config) {
    return createApiError("参数错误", 400);
  }

  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    await client.updateConfig({ profile_config: config });
  } catch (e) {
    return memoiaApiError(e);
  }

  return createApiResponse();
}
