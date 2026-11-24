import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { memoiaClient } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";

export async function GET(request: Request, { params }: { params: Promise<{ project_id: string }> }) {
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const { project_id } = await params;
    const query = new URL(request.url).searchParams;
    return createApiResponse(await client.listKeys(project_id, { limit: Number(query.get("limit") ?? 20), offset: Number(query.get("offset") ?? 0) }));
  } catch (error) { return memoiaApiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ project_id: string }> }) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const body = await readJsonObject(request);
    if (body.error) return body.error;
    const input: unknown = body.data;
    const { project_id } = await params;
    // A new token is returned once. Do not log it or persist it in cookies.
    return createApiResponse(await client.createKey(project_id, input as Parameters<typeof client.createKey>[1]), "Created", 0, 201);
  } catch (error) { return memoiaApiError(error); }
}
