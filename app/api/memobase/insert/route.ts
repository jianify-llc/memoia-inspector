import { createApiResponse, createApiError } from "@/lib/api-response";
import { memoiaClient, getMemoiaUser } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { readJsonObject } from "@/lib/json-body";

export async function POST(req: Request) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const body = await readJsonObject(req);
  if (body.error) return body.error;
  try {
    const { messages, idempotency_key } = body.data;
    if (!Array.isArray(messages) || !messages.length || messages.some(message => !message || typeof message.created_at !== "string") || typeof idempotency_key !== "string" || !idempotency_key) {
      return createApiError("Bad Request", 400);
    }
    const client = await memoiaClient();
    if (!client) return createApiError("Unauthorized", 401);
    const uid = await getMemoiaUser();
    const result = await client.importBlob(uid, { source_id: "playground", idempotency_key,
      messages: messages.map((message, index) => ({ role: message.role, content: message.content,
        message_id: `${idempotency_key}:${index}`, occurred_at: message.created_at })) });
    // completed 只确认 Fact 原子写入；后台 flush 失败不能重放正文。
    if (result.status !== "completed") return createApiError("Memory processing is not complete", 503);
    return createApiResponse(result, "Facts imported");
  } catch (error) {
    if (error instanceof SyntaxError) return createApiError("Bad Request", 400);
    return memoiaApiError(error);
  }
}
