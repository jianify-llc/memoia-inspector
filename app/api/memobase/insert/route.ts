import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoBaseClient, getMemobaseUser } from "@/utils/memobase/client";

import { BlobType, Blob } from "@memobase/memobase";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";

export async function POST(req: Request) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  const { messages } = await req.json();
  if (!messages) {
    return createApiError("参数错误", 400);
  }

  try {
    const user = await (await memoBaseClient()).getOrCreateUser(await getMemobaseUser());
    await user.insert(
      Blob.parse({
        type: BlobType.Enum.chat,
        messages: messages,
      })
    );
  } catch {
    return createApiError("插入失败", 500);
  }

  return createApiResponse(null, "插入成功");
}
