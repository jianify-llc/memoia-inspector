import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { memoiaClient } from "@/utils/memoia/client";

export async function GET(_request: Request, { params }: { params: Promise<{ uid: string }> }) {
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const { uid } = await params;
    if (!uid) return createApiError("User ID is required", 400);
    return createApiResponse(await client.getMaintenance(uid));
  } catch (error) {
    return memoiaApiError(error);
  }
}
