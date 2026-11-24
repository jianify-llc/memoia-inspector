import { createApiError, createApiResponse } from "@/lib/api-response";
import { memoiaApiError } from "@/lib/memoia-api-response";
import { memoiaClient } from "@/utils/memoia/client";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";

export async function GET(request: Request) {
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const query = new URL(request.url).searchParams;
    return createApiResponse(await client.listProjects({ limit: Number(query.get("limit") ?? 20), offset: Number(query.get("offset") ?? 0) }));
  } catch (error) { return memoiaApiError(error); }
}

export async function POST(request: Request) {
  const originError = rejectCrossOriginMutation(request);
  if (originError) return originError;
  try {
    const client = await memoiaClient();
    if (!client) return createApiError("Project credentials are required", 401);
    const body = await readJsonObject(request);
    if (body.error) return body.error;
    const input: unknown = body.data;
    return createApiResponse(await client.createProject(input as Parameters<typeof client.createProject>[0]), "Created", 0, 201);
  } catch (error) { return memoiaApiError(error); }
}
