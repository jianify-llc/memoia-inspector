import { memoiaApiError } from "@/lib/memoia-api-response";
import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoiaClient } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";

function expectedProject(req: Request) {
  const endpoint = req.headers.get("x-memoia-endpoint");
  const projectId = req.headers.get("x-memoia-project");
  return endpoint && projectId ? { endpoint, projectId } : undefined;
}

/**
 * 获取项目用户画像和事件信息
 * @returns 用户
 */
export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  if (!uid) {
    return createApiError("Project not found", 404);
  }
  const expected = expectedProject(req);
  if (!expected) return createApiError("PROJECT_REQUIRED", 400);
  try {
    const client = await memoiaClient(expected);
    if (!client) return createApiError("Unauthorized", 401);
    const [profileResult, eventResult, maintenance] = await Promise.all([client.getProfiles(uid), client.getEvents(uid), client.getMaintenance(uid)]);
    const profiles = profileResult.profiles;
    const events = eventResult.events;

    return createApiResponse({
      profiles: profiles,
      events: events,
      maintenance,
    });
  } catch (error) {
    return memoiaApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const expected = expectedProject(req);
  if (!expected) return createApiError("PROJECT_REQUIRED", 400);
  const body = await readJsonObject(req);
  if (body.error) return body.error;
  const { action, id, content, topic, sub_topic, title } = body.data;
  const { uid } = await params;
  if (!uid || typeof action !== "string") return createApiError("INVALID_INPUT", 400);
  try {
    const client = await memoiaClient(expected);
    if (!client) return createApiError("Unauthorized", 401);
    if (action === "addProfile" || action === "updateProfile") {
      if (typeof content !== "string" || typeof topic !== "string" || typeof sub_topic !== "string") return createApiError("INVALID_INPUT", 400);
      if (action === "addProfile") await client.addProfile(uid, { content, topic, sub_topic });
      else if (typeof id === "string") await client.updateProfile(uid, id, { content, topic, sub_topic });
      else return createApiError("INVALID_INPUT", 400);
    } else if (action === "deleteProfile" && typeof id === "string") {
      await client.deleteProfile(uid, id);
    } else if (action === "deleteEvent" && typeof id === "string") {
      await client.deleteEvent(uid, id);
    } else if (action === "addEvent" && typeof content === "string" && typeof title === "string") {
      await client.addEvent(uid, { content, title: title || null });
    } else if (action === "updateEvent" && typeof id === "string" &&
      (typeof content === "string" || typeof title === "string") &&
      (content === undefined || typeof content === "string") && (title === undefined || typeof title === "string")) {
      await client.updateEvent(uid, id, { ...(content !== undefined ? { content } : {}), ...(title !== undefined ? { title: title || null } : {}) });
    } else return createApiError("INVALID_INPUT", 400);
    return createApiResponse(null);
  } catch (error) {
    return memoiaApiError(error);
  }
}
