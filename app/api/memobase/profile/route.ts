import { memoiaApiError } from "@/lib/memoia-api-response";
import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoiaClient, getMemoiaUser } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";

/**
 * 获取 profile
 */
export async function GET() {
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    const { profiles } = await client.getProfiles(await getMemoiaUser());

    return createApiResponse(profiles, "获取记录成功");
  } catch (error: unknown) {
    return memoiaApiError(error);
  }
}

/**
 * 添加 profile
 * @param body profile data
 */
export async function POST(req: Request) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const body = await readJsonObject(req);
  if (body.error) return body.error;
  const { content, topic, sub_topic } = body.data;
  if (typeof content !== "string" || typeof topic !== "string" || typeof sub_topic !== "string") {
    return createApiError("INVALID_INPUT", 400);
  }

  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    await client.addProfile(await getMemoiaUser(), { content, topic, sub_topic });
  } catch (error: unknown) {
    return memoiaApiError(error);
  }

  return createApiResponse(null, "成功");
}
