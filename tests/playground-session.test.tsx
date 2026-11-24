// @vitest-environment jsdom
import { StrictMode } from "react";
import { render, fireEvent, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ options: {} as Record<string, unknown>,
  running: false, insert: vi.fn(async () => ({ code: 0 })), cancel: vi.fn(), reset: vi.fn() }));
const runtime = { thread: { getState: () => ({ isRunning: state.running }), cancelRun: () => {
  if (!state.running) throw new Error("Empty thread rejects actions");
  state.cancel(); state.running = false;
}, import: state.reset } };
vi.mock("@assistant-ui/react-data-stream", () => ({ useDataStreamRuntime: (options: Record<string, unknown>) => {
  state.options = options; return runtime;
} }));
vi.mock("@assistant-ui/react", () => ({ AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/assistant-ui/assistant-sidebar", () => ({ AssistantSidebar: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/assistant-ui/thread", () => ({ Thread: () => null }));
vi.mock("@/components/user-memory", () => ({ UserMemory: ({ onNewUser }: { onNewUser: () => Promise<void> }) =>
  <button onClick={() => void onNewUser()}>New test user</button> }));
vi.mock("@/api/models/memobase", () => ({ getProfile: async () => ({ code: 0, data: [] }),
  getEvent: async () => ({ code: 0, data: [] }), getPlaygroundMaintenance: async () => ({ code: 0, data: { pending_blob_count: 0, flushes: [] } }),
  initializePlaygroundUser: async () => ({ code: 0 }), deleteUser: async () => ({ code: 0 }),
  insertMessages: (...args: unknown[]) => state.insert(...args as []),
}));

import Playground from "@/components/project/tabs/playground";
const project = { endpoint_url: "https://memoia.example", endpoint_token: "fixture", config_yaml: "" };
type Options = { body: { reference_tokens: string[]; session_id: string; request_id: string; chain_receipt: string | null }; sendExtraMessageFields: boolean;
  onResponse: (response: Response) => Promise<void>; onFinish: (message: unknown) => Promise<void> };
const options = () => state.options as unknown as Options;

beforeEach(() => {
  vi.clearAllMocks();
  state.running = false;
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ enabled: true })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("retains references under StrictMode and clears them on user replacement, fencing old callbacks", async () => {
  const view = render(<StrictMode><Playground project={project} /></StrictMode>);
  await screen.findByRole("button", { name: "New test user" });
  const old = options();
  expect(old.sendExtraMessageFields).toBe(true);
  await old.onResponse(new Response('8:[{"message_id":"m1","memoia_reference":"signed"}]\n', {
    headers: { "x-playground-request": old.body.request_id, "x-last-user-message": "original", "x-last-user-recorded-at": "2026-10-12T00:00:00Z" },
  }));
  expect(old.body.reference_tokens).toEqual(["signed"]);
  fireEvent.click(screen.getByRole("button", { name: "New test user" }));
  await waitFor(() => expect(state.reset).toHaveBeenCalledWith({ messages: [] }));
  expect(options().body.reference_tokens).toEqual([]);
  await old.onFinish({ id: "reply", role: "assistant", content: [{ type: "text", text: "late" }], createdAt: new Date() });
  expect(state.insert).not.toHaveBeenCalled();
  const latest = options();
  state.running = true;
  view.unmount();
  await latest.onFinish({ id: "reply", role: "assistant", content: [{ type: "text", text: "after unmount" }], createdAt: new Date() });
  expect(state.insert).not.toHaveBeenCalled();
  expect(state.cancel).toHaveBeenCalled();
});

it("can leave a disabled empty Playground without sending an SDK thread action", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ enabled: false })));
  const view = render(<StrictMode><Playground project={project} /></StrictMode>);
  await screen.findByText("notConfigured");
  view.unmount();
  expect(state.cancel).not.toHaveBeenCalled();
});

it("imports only a completed answer, never partial, cancelled or tool-only output", async () => {
  render(<Playground project={project} />);
  await screen.findByRole("button", { name: "New test user" });
  const requestId = options().body.request_id;
  await options().onResponse(new Response('8:[{"message_id":"m1","memoia_reference":"signed"}]\n', {
    headers: { "x-playground-request": requestId, "x-last-user-message": "original", "x-last-user-recorded-at": "2026-10-12T00:00:00Z" },
  }));
  const reply = { id: "a1", role: "assistant", content: [{ type: "text", text: "partial" }], createdAt: new Date(),
    metadata: { unstable_annotations: [{ session_id: options().body.session_id, request_id: requestId, chain_receipt: "signed-chain" }] } };
  for (const status of [undefined, { type: "running" }, { type: "incomplete", reason: "error" },
    { type: "incomplete", reason: "cancelled" }, { type: "complete", reason: "unknown" }]) {
    await options().onFinish({ ...reply, status });
    expect(options().body.chain_receipt).toBeNull();
  }
  expect(state.insert).not.toHaveBeenCalled();
  await options().onFinish({ ...reply, status: { type: "requires-action", reason: "tool-calls" } });
  expect(options().body.chain_receipt).toBe("signed-chain");
  expect(state.insert).not.toHaveBeenCalled();
  await options().onFinish({ ...reply, status: { type: "complete", reason: "stop" } });
  expect(options().body.chain_receipt).toBe("signed-chain");
  expect(state.insert).toHaveBeenCalledTimes(1);
});

it("ignores a delayed completion from a superseded request", async () => {
 render(<Playground project={project} />);
 await screen.findByRole("button", { name: "New test user" });
 const session = options().body.session_id;
 const oldRequest = options().body.request_id;
 const newRequest = options().body.request_id;
 const completed = (request: string, receipt: string) => ({ id: "reply", role: "assistant", content: [], status: { type: "complete", reason: "stop" }, metadata: { unstable_annotations: [{ session_id: session, request_id: request, chain_receipt: receipt }] } });
 await options().onFinish(completed(newRequest, "new-chain"));
 await options().onFinish(completed(oldRequest, "old-chain"));
 expect(options().body.chain_receipt).toBe("new-chain");
 expect(state.insert).not.toHaveBeenCalled();
});
