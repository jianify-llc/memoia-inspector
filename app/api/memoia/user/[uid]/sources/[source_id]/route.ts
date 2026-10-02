import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { memoiaClient } from "@/utils/memoia/client";

export async function GET(_request: Request, { params }: { params: Promise<{ uid: string; source_id: string }> }) {
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const { uid, source_id } = await params;
    return createApiResponse(await client.getSource(uid, source_id));
  } catch (error) {
    return memoiaApiError(error);
  }
}
