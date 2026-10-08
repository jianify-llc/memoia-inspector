import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { getMemoiaUser, memoiaClient } from "@/utils/memoia/client";

export async function GET() {
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    return createApiResponse(await client.getMaintenance(await getMemoiaUser()));
  } catch (error) {
    return memoiaApiError(error);
  }
}
