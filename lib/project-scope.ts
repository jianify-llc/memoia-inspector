import { MemoiaError } from "@jianify/memoia";

export function requestProjectScope(request: Request) {
  const endpoint = request.headers.get("x-memoia-endpoint");
  const projectId = request.headers.get("x-memoia-project");
  if (!endpoint || !projectId) throw new MemoiaError("INVALID_INPUT", 400, false);
  return { endpoint, projectId };
}
