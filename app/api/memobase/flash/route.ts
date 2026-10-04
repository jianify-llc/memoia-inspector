import { createApiResponse, createApiError } from "@/lib/api-response";

import { memoBaseClient, getMemobaseUser } from "@/utils/memobase/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";

export async function POST(req: Request) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  try {
    const user = await (await memoBaseClient()).getOrCreateUser(await getMemobaseUser());
    await user.flush();
  } catch {
    return createApiError("失败", 500);
  }

  return createApiResponse(null, "成功");
}
