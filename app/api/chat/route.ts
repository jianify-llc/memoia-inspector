import { openai } from "@/lib/openai";
import { jsonSchema, streamText } from "ai";

import { memoiaClient, getMemoiaUser } from "@/utils/memoia/client";
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
    { enabled: isPlaygroundConfigured() },
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
  const { messages, tools } = body.data;

  try {
    const client = await memoiaClient();
    if (!client) return new Response("Unauthorized", { status: 401 });
    const uid = await getMemoiaUser();
    const latest = messages.at(-1)?.content;
    const query = typeof latest === "string" ? latest : latest?.filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join("\n");
    const [profileResult, eventResult] = await Promise.all([client.getProfiles(uid), client.getContext(uid, { query: query || null, max_token_size: 750 })]);
    const context = [profileResult.profiles.map(p => `${p.topic}::${p.sub_topic}: ${p.content}`).join("\n"), eventResult.context].filter(Boolean).join("\n\n");

    const finalSystemPrompt = `You're Memobase Assistant, a helpful assistant that demonstrates the capabilities of Memobase Memory. \n${context}`;
    const result = streamText({
      model: openai(process.env.OPENAI_MODEL!),
      messages,
      // forward system prompt and tools from the frontend
      system: finalSystemPrompt,
      tools: Object.fromEntries(
        Object.entries<{ parameters: unknown }>(tools).map(([name, tool]) => [
          name,
          {
            parameters: jsonSchema(tool.parameters!),
          },
        ])
      ),
    });

    const lastMessage =
      messages[messages.length - 1].content[
        messages[messages.length - 1].content.length - 1
      ].text;

    return result.toDataStreamResponse({
      headers: {
        "x-last-user-message": encodeURIComponent(lastMessage),
        "x-last-user-recorded-at": messages.at(-1)?.createdAt || new Date().toISOString(),
      },
      getErrorMessage(error) {
        void error;
        return "Internal Server Error";
      },
    });
  } catch (error) {
    void error;
    return new Response("Internal Server Error", { status: 500 });
  }
}
