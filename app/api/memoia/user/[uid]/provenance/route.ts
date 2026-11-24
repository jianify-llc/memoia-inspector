import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { memoiaClient } from "@/utils/memoia/client";

export async function GET(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const { uid } = await params;
    if (!uid) return createApiError("User ID is required", 400);
    const query = new URL(request.url).searchParams;
    const limit = Number(query.get("limit") ?? 20);
    const offset = Number(query.get("offset") ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) return createApiError("Invalid pagination", 400);
    const page = { limit, offset };
    const [sources, profiles, history, operations, maintenance] = await Promise.all([
      client.listSources(uid, page), client.getProfiles(uid), client.getHistory(uid, page), client.listOperations(uid, page),
      client.getMaintenance(uid),
    ]);
    return createApiResponse({ sources: sources.sources, profiles: profiles.profiles, history: history.entries, operations: operations.operations, maintenance });
  } catch (error) {
    return memoiaApiError(error);
  }
}
