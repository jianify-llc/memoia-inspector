import { createApiError } from "@/lib/api-response";

function httpOrigin(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid origin");
  return url.origin;
}

/** Cookie-backed writes need browser intent, not merely an Access login.
 * Forwarded headers alone are never authority. Proxy fallback requires the
 * browser's forbidden-to-JS same-origin metadata and its original Host together.
 */
export function rejectCrossOriginMutation(request: Request) {
  try {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin") throw new Error("Not a same-origin write");
    const supplied = request.headers.get("origin") ?? request.headers.get("referer");
    if (!supplied) throw new Error("Missing source origin");
    const origin = httpOrigin(supplied);
    const configured = process.env.INSPECTOR_PUBLIC_ORIGIN?.trim();
    let expected = httpOrigin(configured || request.url);
    if (!configured && site === "same-origin" && request.headers.has("host")) {
      expected = httpOrigin(`${new URL(origin).protocol}//${request.headers.get("host")}`);
    }
    if (origin !== expected) throw new Error("Origin mismatch");
    return null;
  } catch { /* Unknown, opaque and sibling origins fail closed before SDK calls. */ }
  return createApiError("Cross-origin management requests are not allowed", 403);
}
