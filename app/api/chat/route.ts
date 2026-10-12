import { playgroundClient } from "@/lib/openai";
import { PLAYGROUND_INSTRUCTIONS, playgroundHistory, playgroundTools, playgroundInput,
  playgroundStream, playgroundCacheKey, supportsPromptCache } from "@/lib/playground-responses";

import { memoiaClient, getMemoiaUser, getLocale } from "@/utils/memoia/client";
import { verifyReferences, signReference } from "@/lib/playground-reference";
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
  const { messages, tools, reference_tokens } = body.data;
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
        if (!reference && user !== history.users.at(-1)) throw new Error("Missing original turn reference");
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
    const stream = await playgroundClient().responses.create({ model, stream: true, store: false,
      instructions: PLAYGROUND_INSTRUCTIONS, input: playgroundInput(history, references, cache), tools: modelTools,
      ...(cache ? { prompt_cache_options: { mode: "implicit", ttl: "30m" },
        prompt_cache_key: playgroundCacheKey(project.project_id, uid) } : {}) }, { signal: req.signal });
    return playgroundStream(stream, { "x-last-user-message": encodeURIComponent(history.lastText),
      "x-last-user-recorded-at": reference.recordedAt }, { message_id: last.id, memoia_reference: referenceToken });
  } catch (error) {
    void error;
    return new Response("Internal Server Error", { status: 500 });
  }
}
