import { describe, expect, it } from "vitest";
import { retainReference } from "@/lib/playground-reference-client";

describe("current-session signed references", () => {
  it("retains once before stream completion and never waits for the UI tee", async () => {
    const references = new Map<string, string>();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('8:[{"message_id":"m1","memoia_reference":"signed-original"}]\n')); },
    }));
    await retainReference(response, references);
    expect([...references]).toEqual([["m1", "signed-original"]]);
    const retry = new Response('8:[{"message_id":"m1","memoia_reference":"different-retry"}]\n');
    await retainReference(retry, references);
    expect(references.get("m1")).toBe("signed-original");
    void response.body?.cancel();
  });

  it("has no cross-session storage and ignores an ordinary failed stream", async () => {
    const firstSession = new Map([["m1", "signed"]]);
    firstSession.clear();
    const nextSession = new Map<string, string>();
    await retainReference(new Response('3:"Internal Server Error"\n'), nextSession);
    expect(firstSession.size).toBe(0);
    expect(nextSession.size).toBe(0);
  });
});
