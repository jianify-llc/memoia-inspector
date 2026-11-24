// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDataStreamRuntime } from "@assistant-ui/react-data-stream";
import { AssistantRuntimeProvider, type AssistantRuntime } from "@assistant-ui/react";
import { Stream } from "openai/core/streaming";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import { playgroundStream } from "@/lib/playground-responses";
import { retainReference } from "@/lib/playground-reference-client";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("connects the upgraded encoder to the actual UI runtime across two turns", async () => {
  const requests: Array<{ messages: Array<{ role: string; unstable_id: string }>; reference_tokens: string[] }> = [];
  const references = new Map<string, string>();
  const finished = vi.fn();
  let runtime!: AssistantRuntime;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    requests.push(request);
    const id = request.messages.filter((m: { role: string }) => m.role === "user").at(-1).unstable_id;
    const events = [{ type: "response.output_text.delta", delta: "A complete reply" },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 10, output_tokens: 3 } } }];
    return playgroundStream(async () => new Stream<ResponseStreamEvent>(async function* () {
      for (const event of events) yield event as ResponseStreamEvent;
    }, new AbortController()), {}, { message_id: id, memoia_reference: `reference-${id}` });
  }));
  function Harness() {
    runtime = useDataStreamRuntime({ api: "/api/chat", sendExtraMessageFields: true,
      body: { get reference_tokens() { return [...references.values()]; } },
      onResponse: response => retainReference(response, references), onFinish: finished });
    return <AssistantRuntimeProvider runtime={runtime}>{null}</AssistantRuntimeProvider>;
  }
  render(<Harness />);
  await act(async () => { await runtime.thread.append({ role: "user", content: [{ type: "text", text: "First" }] }); });
  await waitFor(() => expect(finished).toHaveBeenCalledTimes(1));
  expect(finished.mock.calls[0][0]).toMatchObject({ role: "assistant", status: { type: "complete", reason: "stop" },
    content: [{ type: "text", text: "A complete reply" }] });
  await act(async () => { await runtime.thread.append({ role: "user", content: [{ type: "text", text: "Second" }] }); });
  await waitFor(() => expect(finished).toHaveBeenCalledTimes(2));
  expect(requests).toHaveLength(2);
  expect(requests[1].messages.map(m => m.role)).toEqual(["user", "assistant", "user"]);
  expect(requests[0].messages[0].unstable_id).toBe(requests[1].messages[0].unstable_id);
  expect(requests[1].reference_tokens).toEqual([`reference-${requests[0].messages[0].unstable_id}`]);
  expect(references.size).toBe(2);
});
