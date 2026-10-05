import { createApiError } from "@/lib/api-response";
import type { NextResponse } from "next/server";

/** Routes declare their body contract; an empty Node request still has a stream. */
export async function readJsonObject(request: Request): Promise<
  | { data: Awaited<ReturnType<Request["json"]>>; error: null }
  | { data: null; error: NextResponse }
> {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return { data: null, error: createApiError("JSON Content-Type is required", 415) };
  }
  try {
    const data = await request.json();
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { data: null, error: createApiError("JSON object is required", 400) };
    }
    return { data, error: null };
  } catch {
    return { data: null, error: createApiError("Invalid JSON", 400) };
  }
}
