import OpenAI from "openai";

/** Optional Playground owns its provider client; management routes never initialize it. */
export function playgroundClient() {
  return new OpenAI({ baseURL: process.env.OPENAI_BASE_URL, apiKey: process.env.OPENAI_API_KEY,
    // The old streamText path used two transport retries; do not add another layer.
    maxRetries: 2, logLevel: "off" });
}
