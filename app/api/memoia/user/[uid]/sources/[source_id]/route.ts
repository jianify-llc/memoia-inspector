import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { memoiaClient } from "@/utils/memoia/client";

export async function GET(request: Request, { params }: { params: Promise<{ uid: string; source_id: string }> }) {
  try {
    const query = new URL(request.url).searchParams;
    const fields = new Set(["limit", "message_offset", "blob_offset", "evidence_offset"]);
    if ([...query.keys()].some(key => !fields.has(key))) return createApiError("Invalid source page", 400);
    const page = {
      limit: Number(query.get("limit") ?? 20),
      message_offset: Number(query.get("message_offset") ?? 0),
      blob_offset: Number(query.get("blob_offset") ?? 0),
      evidence_offset: Number(query.get("evidence_offset") ?? 0),
    };
    if (!Object.values(page).every(Number.isSafeInteger) || page.limit < 1 || page.limit > 100 ||
        page.message_offset < 0 || page.blob_offset < 0 || page.evidence_offset < 0) {
      return createApiError("Invalid source page", 400);
    }
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const { uid, source_id } = await params;
    return createApiResponse(await client.getSource(uid, source_id, { signal: request.signal }, page));
  } catch (error) {
    return memoiaApiError(error);
  }
}
