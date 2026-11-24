import { playgroundClient } from "@/lib/openai";
import { playgroundHistory, playgroundTools, playgroundInput,
  playgroundStream, playgroundCacheKey, supportsPromptCache } from "@/lib/playground-responses";

import { memoiaClient, getMemoiaUser, getLocale } from "@/utils/memoia/client";
import { verifyReferences, signReference } from "@/lib/playground-reference";
import { chainInput, readChain, prepareChain, signChain } from "@/lib/playground-chain";
import { messageFingerprint } from "@/lib/playground-reference";
import { rejectCrossOriginMutation } from "@/lib/mutation-origin";
import { readJsonObject } from "@/lib/json-body";

export const maxDuration = 30;

const isPlaygroundConfigured = () => Boolean(
  process.env.OPENAI_API_KEY?.trim() &&
  process.env.OPENAI_BASE_URL?.trim() &&
  process.env.OPENAI_MODEL?.trim()
);

export async function GET() {
  return Response.json(
    { enabled: isPlaygroundConfigured(), promptCacheContract: supportsPromptCache(process.env.OPENAI_MODEL || "") },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const originError = rejectCrossOriginMutation(req);
  if (originError) return originError;
  if (!isPlaygroundConfigured()) {
    return new Response("Playground model is not configured", { status: 503 });
  }
  const body = await readJsonObject(req);
  if (body.error) return body.error;
  const { messages, tools, reference_tokens, session_id, request_id, chain_receipt } = body.data;
  if (typeof session_id !== "string" || !/^[a-f0-9-]{36}$/i.test(session_id) ||
    typeof request_id !== "string" || !/^[a-f0-9-]{36}$/i.test(request_id)) return new Response("Invalid session", { status: 400 });
  let history, modelTools;
  try { history = playgroundHistory(messages); modelTools = playgroundTools(tools); }
  catch { return new Response("Invalid Playground input", { status: 400 }); }

  try {
    const client = await memoiaClient();
    if (!client) return new Response("Unauthorized", { status: 401 });
    const uid = await getMemoiaUser();
    const [project, , locale] = await Promise.all([client.getProjectIdentity(), client.getUser(uid), getLocale()]);
    // Project scope comes from the authenticated Memoia receipt, never browser fields or URL alone.
    if (!project.project_id) return new Response("Unauthorized", { status: 401 });
    let references;
    try {
      references = verifyReferences(reference_tokens, locale[1], project.project_id, uid);
      for (const user of history.users) {
        const reference = references.get(user.id);
        if (!reference && user !== history.users.at(-1)) {
          return new Response("Retry the earlier unfinished turn: its original memory reference was not received.", { status: 409 });
        }
        if (reference && (reference.fingerprint !== user.fingerprint ||
          user.recordedAt !== null && reference.recordedAt !== user.recordedAt)) throw new Error("Changed original message");
      }
    } catch { return new Response("Invalid Playground references", { status: 400 }); }
    const last = history.users.at(-1)!;
    let reference = references.get(last.id);
    if (!reference) {
      const [profileResult, eventResult] = await Promise.all([client.getProfiles(uid),
        client.getContext(uid, { query: history.lastText || null, max_token_size: 750 })]);
      reference = { projectId: project.project_id, userId: uid, messageId: last.id, fingerprint: last.fingerprint,
        recordedAt: last.recordedAt || new Date().toISOString(),
        profiles: profileResult.profiles.map(p => `${p.topic}::${p.sub_topic}: ${p.content}`).join("\n"), memories: eventResult.context };
      references.set(last.id, reference);
    }
    const referenceToken = signReference(reference, locale[1]);

    const model = process.env.OPENAI_MODEL;
    if (!model) return new Response("Playground model is not configured", { status: 503 });
    const cache = supportsPromptCache(model);
    const scope = { projectId: project.project_id, userId: uid, sessionId: session_id };
    let receipt;
    try { receipt = readChain(chain_receipt, locale[1], scope); }
    catch { return new Response("Invalid chain receipt", { status: 400 }); }
    const full = chainInput(playgroundInput(history, references, cache));
    const contextHash = messageFingerprint([model, modelTools, full[0]]);
    const continuation = prepareChain(full, receipt, contextHash);
    return playgroundStream((signal) => playgroundClient().responses.create({ model, stream: true, store: true,
      ...continuation, tools: modelTools,
      ...(cache ? { prompt_cache_options: { mode: "implicit", ttl: "30m" },
        prompt_cache_key: playgroundCacheKey(project.project_id, uid, session_id) } : {}) }, { signal: AbortSignal.any([req.signal, signal]) }),
      { "x-last-user-message": encodeURIComponent(history.lastText),
      "x-last-user-recorded-at": reference.recordedAt, "x-playground-request": request_id }, { message_id: last.id, memoia_reference: referenceToken },
      (response) => ({ session_id, request_id, chain_receipt: signChain(scope, response.id, contextHash, full, response.output, locale[1]) }));
  } catch (error) {
    void error;
    return new Response("Internal Server Error", { status: 500 });
  }
}
