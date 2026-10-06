import { memoiaApiError } from "@/lib/memoia-api-response";
import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoiaClient } from "@/utils/memoia/client";

/**
 * 获取项目用户画像和事件信息
 * @returns 用户
 */
export async function GET(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  if (!uid) {
    return createApiError("Project not found", 404);
  }
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    const [profileResult, eventResult] = await Promise.all([client.getProfiles(uid), client.getEvents(uid)]);
    const profiles = profileResult.profiles;
    const events = eventResult.events;

    return createApiResponse({
      profiles: profiles,
      events: events,
    });
  } catch (error) {
    return memoiaApiError(error);
  }
}
