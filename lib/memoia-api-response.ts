import { MemoiaError } from "@jianify/memoia";
import { createApiError } from "@/lib/api-response";

/** Report classified errors, never provider bodies, project tokens or message text. */
export function memoiaApiError(error: unknown) {
  if (error instanceof MemoiaError) {
    console.warn("Memoia v2 management request failed", { code: error.code, status: error.status, outcome: error.outcome });
    if (error.code === "INVALID_INPUT") return createApiError(error.code, 400);
    const status = error.status && [401, 403, 404, 409, 413, 422, 429].includes(error.status) ? error.status : 502;
    return createApiError(error.outcome === "unknown" ? "OUTCOME_UNKNOWN" : error.code, status);
  }
  console.error("Memoia v2 management request failed", { kind: error instanceof Error ? error.name : "UnknownError" });
  return createApiError("Memoia management request failed", 502);
}
