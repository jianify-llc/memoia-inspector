import { memoiaApiError } from "@/lib/memoia-api-response";
import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoiaClient, getMemoiaUser } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";

/**
 * 删除 profile
 * @param profile_id profile ID
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ profile_id: string }> }) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const { profile_id } = await params;
  if (!profile_id) {
    return createApiError("Bad Request", 400);
  }

  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    await client.deleteProfile(await getMemoiaUser(), profile_id);
  } catch (error: unknown) {
    return memoiaApiError(error);
  }

  return createApiResponse(null, "删除成功");
}


/**
 * 更新 profile
 * @param profile_id profile ID
 * @param body profile data
 */
export async function PUT(req: Request, { params }: { params: Promise<{ profile_id: string }> }) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const { profile_id } = await params;
  if (!profile_id) {
    return createApiError("Bad Request", 400);
  }

  const body = await readJsonObject(req);
  if (body.error) return body.error;
  const { content, topic, sub_topic } = body.data;
  if (typeof content !== "string" || typeof topic !== "string" || typeof sub_topic !== "string") {
    return createApiError("INVALID_INPUT", 400);
  }

  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    await client.updateProfile(await getMemoiaUser(), profile_id, { content, topic, sub_topic });
  } catch (error: unknown) {
    return memoiaApiError(error);
  }

  return createApiResponse(null, "成功");
}
