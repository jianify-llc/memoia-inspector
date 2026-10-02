"use server";

import { MemoiaClient } from "@jianify/memoia";
import { getLocale } from "@/utils/memobase/client";

/** The selected project's existing session cookie remains the sole token owner. */
export async function memoiaClient() {
  const [baseUrl, apiKey] = await getLocale();
  if (!baseUrl || !apiKey) return null;
  return new MemoiaClient({ baseUrl, apiKey, maxAttempts: 2 });
}
