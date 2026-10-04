import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { memoiaClient } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";

export async function POST(request: Request, { params }: { params: Promise<{ uid: string; source_id: string }> }) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    let input: unknown;
    try { input = await request.json(); } catch { return createApiError("Invalid JSON", 400); }
    const { uid, source_id } = await params;
    // Runtime validation belongs to the generated SDK contract, not a second
    // handwritten copy of the API's message/key rules.
    const operation = await client.deleteMessages(uid, source_id, input as Parameters<typeof client.deleteMessages>[2], { deadline: Date.now() + 90_000 });
    return createApiResponse(operation, operation.status, 0, operation.status === "processing" ? 202 : 200);
  } catch (error) {
    return memoiaApiError(error);
  }
}
