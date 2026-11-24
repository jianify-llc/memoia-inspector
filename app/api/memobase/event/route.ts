import { memoiaApiError } from "@/lib/memoia-api-response";
import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoiaClient, getMemoiaUser } from "@/utils/memoia/client";

export async function GET() {
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    const { events: event } = await client.getEvents(await getMemoiaUser());

    return createApiResponse(event, "获取记录成功");
  } catch (error: unknown) {
    return memoiaApiError(error);
  }
}
