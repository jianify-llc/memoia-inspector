import { createApiError } from "@/lib/api-response";

/** SameSite is site-wide: reject sibling-origin browser writes using our credential Cookie. */
export function rejectCrossOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    if (new URL(origin).host === new URL(request.url).host) return null;
  } catch { /* Opaque or malformed origins cannot authorize a Cookie-backed write. */ }
  return createApiError("Cross-origin management requests are not allowed", 403);
}
