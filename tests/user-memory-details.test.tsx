// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserEvent, UserProfile } from "@memobase/memobase";
import messages from "@/messages/en.json";

const api = vi.hoisted(() => ({
  memories: vi.fn(), users: vi.fn(), provenance: vi.fn(), source: vi.fn(), deleteMessages: vi.fn(),
  query: vi.fn(), retry: vi.fn(), deleteUser: vi.fn(), push: vi.fn(),
}));
vi.mock("next/navigation", () => { const router = { push: api.push }; return { useRouter: () => router }; });
vi.mock("@/api/models/memobase", () => ({ getProjectUserMemories: api.memories, getProjectUsers: api.users, deleteUserByUid: api.deleteUser }));
vi.mock("@/api/models/memoia", () => ({ getUserProvenance: api.provenance, getSource: api.source,
  deleteSourceMessages: api.deleteMessages, getOperation: api.query, retryOperation: api.retry, PROVENANCE_PAGE_SIZE: 20 }));
// Keep the real detail owner, provenance, Radix tabs/dialogs and JSON download.
// Replace only the unrelated profile editor/timeline presentation.
vi.mock("@/components/user-memory", async () => {
  const { JsonDownload } = await import("@/components/json-download");
  return { UserMemory: ({ profiles, events, canDownload, onRefresh }: {
    profiles: UserProfile[]; events: UserEvent[]; canDownload: boolean; onRefresh: () => Promise<void>;
  }) => <div>
    <div data-testid="memory-snapshot">{profiles.map((profile) => profile.content).join("; ")}</div>
    <button onClick={() => void onRefresh()}>Refresh memories</button>
    {canDownload ? <JsonDownload data={{ profiles, events }} trigger={<button>Download detail</button>} /> : null}
  </div> };
});
import Users from "@/components/project/tabs/users";

const profile = (content: string) => ({ id: content, content, topic: "interest", sub_topic: content, created_at: "2026-10-05T00:00:00Z" });
const oldMemories = { profiles: [profile("hiking"), profile("pottery")], events: [{ id: "hiking" }, { id: "pottery" }] };
const newMemories = { profiles: [profile("pottery")], events: [{ id: "pottery" }] };
const user = (count: number) => ({ id: "user-1", profile_count: count, event_count: count, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z" });
const completed = { operation_id: "op-1", source_id: "source-1", blob_id: null, status: "completed", result: { profile_ids: [], event_ids: [] }, error: null };
const accepted = { ...completed, status: "processing", result: null };
const response = <T,>(data: T) => ({ code: 0, message: "OK", data });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
let currentMemories = oldMemories;
let userCount = 2;
let downloaded: Blob[];
beforeEach(() => {
  vi.resetAllMocks();
  currentMemories = oldMemories;
  userCount = 2;
  downloaded = [];
  api.memories.mockImplementation(async () => response(currentMemories));
  api.users.mockImplementation(async () => response({ users: [user(userCount)], count: 1 }));
  api.provenance.mockResolvedValue(response({ sources: [{ source_id: "source-1", legacy: false, created_at: "2026-10-05T00:00:00Z" }], profiles: [], history: [], operations: [] }));
  api.source.mockResolvedValue(response({ source_id: "source-1", blobs: [], evidence: [], message_ids: ["hobby", "craft"], deleted_message_ids: [], next_message_offset: null, next_blob_offset: null, next_evidence_offset: null }));
  api.deleteMessages.mockImplementation(async () => { currentMemories = newMemories; userCount = 1; return response(completed); });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL(blob: Blob | MediaSource) { downloaded.push(blob as Blob); return "blob:test"; }
    static revokeObjectURL() {}
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = () => render(<NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
  <Users project={{ endpoint_url: "https://memoia.example", endpoint_token: "fixture-token", config_yaml: "" }} />
</NextIntlClientProvider>);
const tab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
const openDetails = async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: messages.project.users.table.memories }));
  await screen.findByTestId("memory-snapshot");
};
const deleteMessage = async () => {
  tab(messages.project.users.provenance);
  fireEvent.click(await screen.findByRole("button", { name: messages.provenance.inspect }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "hobby" }));
  fireEvent.click(screen.getByRole("button", { name: messages.provenance.deleteMessages }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.provenance.deleteMessages }));
};
const downloadText = async () => {
  const reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(downloaded[0]);
  });
};
const counterCells = () => [...document.querySelectorAll("tbody tr:first-child td")].slice(1, 3).map((cell) => cell.textContent);

describe("source mutation → all user memory views", () => {
  it("refreshes memories, counts and the actual downloaded JSON after completed deletion", async () => {
    await openDetails();
    expect(screen.getByTestId("memory-snapshot").textContent).toContain("hiking");
    await deleteMessage();
    await waitFor(() => expect(api.memories).toHaveBeenCalledTimes(2));
    tab(messages.project.users.table.memories);
    await waitFor(() => expect(screen.getByTestId("memory-snapshot").textContent).toBe("pottery"));
    expect(counterCells()).toEqual(["1", "1"]);
    fireEvent.click(screen.getByRole("button", { name: "Download detail" }));
    await waitFor(() => expect(downloaded).toHaveLength(1));
    expect(JSON.parse(await downloadText())).toEqual(newMemories);
    expect(api.provenance).toHaveBeenCalledTimes(2);
  });

  it.each(["processing", "unknown"])("keeps the original key across tabs for %s, then queries without replaying", async (outcome) => {
    if (outcome === "processing") api.deleteMessages.mockResolvedValue(response(accepted));
    else api.deleteMessages.mockRejectedValue(new Error("lost acknowledgement"));
    api.query.mockImplementation(async () => { currentMemories = newMemories; userCount = 1; return response(completed); });
    await openDetails();
    await deleteMessage();
    await screen.findByRole("button", { name: messages.provenance.query });
    const key = api.deleteMessages.mock.calls[0][3];
    tab(messages.project.users.table.memories);
    expect(screen.queryByTestId("memory-snapshot")).toBeNull();
    expect(screen.queryByRole("button", { name: "Download detail" })).toBeNull();
    expect(counterCells()).toEqual(["—", "—"]);
    // SheetContent unmounts on close; its detail owner still retains the key.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: messages.project.users.table.memories }));
    tab(messages.project.users.provenance);
    await waitFor(() => expect((screen.getByRole("button", { name: messages.provenance.query }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: messages.provenance.query }));
    await waitFor(() => expect(api.memories).toHaveBeenCalledTimes(2));
    expect(api.query).toHaveBeenCalledWith("user-1", key, outcome === "processing" ? "op-1" : undefined);
    expect(api.deleteMessages).toHaveBeenCalledOnce();
    tab(messages.project.users.table.memories);
    await waitFor(() => expect(screen.getByTestId("memory-snapshot").textContent).toBe("pottery"));
    expect(counterCells()).toEqual(["1", "1"]);
  });

  it("does not restore old memories when completed-operation readback fails", async () => {
    await openDetails();
    api.memories.mockResolvedValue({ code: 502, data: null, message: "readback failed" });
    await deleteMessage();
    await waitFor(() => expect(api.memories).toHaveBeenCalledTimes(2));
    tab(messages.project.users.table.memories);
    await screen.findByRole("alert");
    expect(screen.getByTestId("memory-snapshot").textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Download detail" })).toBeNull();
    api.memories.mockResolvedValue(response(newMemories));
    fireEvent.click(screen.getByRole("button", { name: "Refresh memories" }));
    await waitFor(() => expect(screen.getByTestId("memory-snapshot").textContent).toBe("pottery"));
  });

  it("ignores an older read completing after delete and fresh readback", async () => {
    const stale = deferred<ReturnType<typeof response<typeof oldMemories>>>();
    api.memories.mockReturnValueOnce(stale.promise);
    await openDetails();
    await deleteMessage();
    await waitFor(() => expect(api.memories).toHaveBeenCalledTimes(2));
    await act(async () => { stale.resolve(response(oldMemories)); });
    expect(api.memories.mock.calls[0][1].aborted).toBe(true);
    tab(messages.project.users.table.memories);
    await waitFor(() => expect(screen.getByTestId("memory-snapshot").textContent).toBe("pottery"));
  });

  it("queries an accepted recovery by operation ID after an unknown response", async () => {
    const failed = { ...accepted, status: "failed", error: { code: "reconciliation_too_large", retryable: false } };
    api.provenance.mockResolvedValue(response({ sources: [], profiles: [], history: [], operations: [failed] }));
    api.retry.mockRejectedValue(new Error("lost recovery acknowledgement"));
    api.query.mockImplementation(async () => { currentMemories = newMemories; userCount = 1; return response(completed); });
    await openDetails();
    tab(messages.project.users.provenance);
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.recover }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledOnce());
    tab(messages.project.users.table.memories);
    expect(screen.queryByTestId("memory-snapshot")).toBeNull();
    tab(messages.project.users.provenance);
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.query }));
    await waitFor(() => expect(api.query).toHaveBeenCalledWith("user-1", null, "op-1"));
    await waitFor(() => expect(api.memories).toHaveBeenCalledTimes(2));
    tab(messages.project.users.table.memories);
    await waitFor(() => expect(screen.getByTestId("memory-snapshot").textContent).toBe("pottery"));
    expect(api.retry).toHaveBeenCalledOnce();
    expect(api.deleteMessages).not.toHaveBeenCalled();
  });

  it("refreshes both views after direct completion of an accepted recovery", async () => {
    const failed = { ...accepted, status: "failed", error: { code: "provider_unavailable", retryable: true } };
    api.provenance.mockResolvedValue(response({ sources: [], profiles: [], history: [], operations: [failed] }));
    api.retry.mockImplementation(async () => { currentMemories = newMemories; userCount = 1; return response(completed); });
    await openDetails();
    tab(messages.project.users.provenance);
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.recover }));
    await waitFor(() => expect(api.memories).toHaveBeenCalledTimes(2));
    tab(messages.project.users.table.memories);
    await waitFor(() => expect(screen.getByTestId("memory-snapshot").textContent).toBe("pottery"));
    expect(counterCells()).toEqual(["1", "1"]);
    expect(api.deleteMessages).not.toHaveBeenCalled();
  });

  it("cancels an in-flight table download before it can export withdrawn evidence", async () => {
    const staleDownload = deferred<ReturnType<typeof response<typeof oldMemories>>>();
    api.memories.mockReturnValueOnce(staleDownload.promise);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: messages.project.users.table.download }));
    fireEvent.click(screen.getByRole("button", { name: messages.project.users.table.memories }));
    await screen.findByTestId("memory-snapshot");
    await deleteMessage();
    await act(async () => { staleDownload.resolve(response(oldMemories)); });
    expect(api.memories.mock.calls[0][1].aborted).toBe(true);
    expect(downloaded).toHaveLength(0);
  });

  it("keeps an unknown operation while visiting another user, without sharing its memory state", async () => {
    api.users.mockImplementation(async () => response({ users: [user(userCount), { ...user(2), id: "user-2" }], count: 2 }));
    api.deleteMessages.mockRejectedValue(new Error("lost acknowledgement"));
    mount();
    const openUser = async (uid: string) => {
      const row = (await screen.findByText(uid)).closest("tr")!;
      fireEvent.click(within(row).getByRole("button", { name: messages.project.users.table.memories }));
    };
    await openUser("user-1");
    await screen.findByTestId("memory-snapshot");
    await deleteMessage();
    await screen.findByRole("button", { name: messages.provenance.query });
    const key = api.deleteMessages.mock.calls[0][3];
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await openUser("user-2");
    await screen.findByTestId("memory-snapshot");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await openUser("user-1");
    expect(screen.queryByTestId("memory-snapshot")).toBeNull();
    tab(messages.project.users.provenance);
    api.query.mockResolvedValue(response(completed));
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.query }));
    await waitFor(() => expect(api.query).toHaveBeenCalledWith("user-1", key, undefined));
    expect(api.deleteMessages).toHaveBeenCalledOnce();
  });
});
