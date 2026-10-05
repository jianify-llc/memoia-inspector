import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoBaseClient } from "@/utils/memobase/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";

/**
 * 获取项目配置
 * @returns 项目配置
 */
export async function GET() {
  try {
    const config = await (await memoBaseClient()).getConfig()

    return createApiResponse(config);
  } catch (error) {
    console.error(error);
    return createApiError("Internal Server Error", 500);
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
    const updated = await (await memoBaseClient()).updateConfig(config)
    if (!updated) {
      return createApiError("更新失败：Memoia 未接受配置", 502);
    }
  } catch (e) {
    console.error(e);
    return createApiError("Internal Server Error", 500);
  }

  return createApiResponse();
}
