// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserEvent, UserProfile } from "@/api/models/memobase";
import messages from "@/messages/en.json";

const api = vi.hoisted(() => ({
  memories: vi.fn(), users: vi.fn(), provenance: vi.fn(), source: vi.fn(), deleteMessages: vi.fn(),
  updateFact: vi.fn(), deleteFact: vi.fn(), query: vi.fn(), retry: vi.fn(), deleteUser: vi.fn(), push: vi.fn(),
}));
vi.mock("next/navigation", () => { const router = { push: api.push }; return { useRouter: () => router }; });
vi.mock("@/api/models/memobase", () => ({ getProjectUserMemories: api.memories, getProjectUsers: api.users, deleteUserByUid: api.deleteUser }));
vi.mock("@/api/models/memoia", () => ({ getUserProvenance: api.provenance, getSource: api.source,
  deleteSourceMessages: api.deleteMessages, updateFact: api.updateFact, deleteFact: api.deleteFact, getOperation: api.query, retryOperation: api.retry, PROVENANCE_PAGE_SIZE: 20 }));
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
  api.provenance.mockResolvedValue(response({ sources: [{ source_id: "source-1", legacy: false, created_at: "2026-10-05T00:00:00Z" }], profiles: [], history: [], operations: [], maintenance: { pending_blob_count: 0, flushes: [] } }));
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

const correctionFact = { fact_id: "fact-1", blob_id: "blob-1", revision: 3, content: "Original fact", subject: "user", reporter: "user", certainty: "asserted", support_groups: [["hobby"]], fact_time: null, created_at: null, updated_at: null };
const correctionSource = { source_id: "source-1", blobs: [{ blob_id: "blob-1", message_ids: ["hobby"], created_at: "2026-10-05T00:00:00Z", kind: "import", status: "active" }], evidence: [correctionFact], message_ids: ["hobby"], deleted_message_ids: [], next_message_offset: null, next_blob_offset: null, next_evidence_offset: null };
const inspectCorrection = async () => {
  tab(messages.project.users.provenance);
  fireEvent.click(await screen.findByRole("button", { name: messages.provenance.inspect }));
  await screen.findByText("Original fact");
};
const submitCorrection = async () => {
  await inspectCorrection();
  fireEvent.click(screen.getByRole("button", { name: messages.provenance.editFact }));
  const editor = screen.getByRole("region", { name: messages.provenance.editFact });
  fireEvent.change(within(editor).getByLabelText(messages.provenance.factContent), { target: { value: "Retain this proposal" } });
  fireEvent.change(within(editor).getByLabelText(messages.provenance.correctionReason), { target: { value: "Verified original conversation" } });
  fireEvent.click(within(editor).getByLabelText(messages.provenance.callerVerified));
  fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.provenance.saveCorrection }));
  await waitFor(() => expect(api.updateFact).toHaveBeenCalledOnce());
};

describe("Fact proposal ownership across real tab unmounts", () => {
  it.each([false, true])("retains unsubmitted edits across tabs after a previous rejection is %s", async (afterRejection) => {
    api.source.mockResolvedValue(response(correctionSource));
    api.updateFact.mockResolvedValue({ code: 422, data: null, message: "invalid_fact_evidence" });
    await openDetails();
    if (afterRejection) {
      await submitCorrection();
      await inspectCorrection();
      await screen.findByText(messages.provenance.draftRetained);
    } else {
      await inspectCorrection();
      fireEvent.click(screen.getByRole("button", { name: messages.provenance.editFact }));
    }
    const editor = screen.getByRole("region", { name: messages.provenance.editFact });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.factContent), { target: { value: " Unsubmitted proposal " } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.correctionReason), { target: { value: " New audit reason " } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.subject), { target: { value: "friend" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.reporter), { target: { value: "user's friend" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.certainty), { target: { value: "uncertain" } });
    fireEvent.click(within(editor).getByLabelText("hobby"));
    fireEvent.click(within(editor).getByLabelText(messages.provenance.setFactTime));
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.addTimeEvidence }));
    fireEvent.change(within(editor).getByLabelText(messages.provenance.timeMessage), { target: { value: "hobby" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.timeExpression), { target: { value: "sometime last week" } });
    fireEvent.click(within(editor).getByLabelText(messages.provenance.callerVerified));
    tab(messages.project.users.table.memories);
    expect(screen.queryByText(messages.provenance.title)).toBeNull();
    await inspectCorrection();
    const restored = screen.getByRole("region", { name: messages.provenance.editFact });
    expect((within(restored).getByLabelText(messages.provenance.factContent) as HTMLTextAreaElement).value).toBe(" Unsubmitted proposal ");
    expect((within(restored).getByLabelText(messages.provenance.correctionReason) as HTMLTextAreaElement).value).toBe(" New audit reason ");
    expect((within(restored).getByLabelText(messages.provenance.subject) as HTMLInputElement).value).toBe("friend");
    expect((within(restored).getByLabelText(messages.provenance.reporter) as HTMLInputElement).value).toBe("user's friend");
    expect((within(restored).getByLabelText(messages.provenance.certainty) as HTMLSelectElement).value).toBe("uncertain");
    expect((within(restored).getByLabelText("hobby") as HTMLInputElement).checked).toBe(false);
    expect((within(restored).getByLabelText(messages.provenance.setFactTime) as HTMLInputElement).checked).toBe(true);
    expect((within(restored).getByLabelText(messages.provenance.timeMessage) as HTMLSelectElement).value).toBe("hobby");
    expect((within(restored).getByLabelText(messages.provenance.timeExpression) as HTMLInputElement).value).toBe("sometime last week");
    expect((within(restored).getByLabelText(messages.provenance.callerVerified) as HTMLInputElement).checked).toBe(false);
    expect(api.updateFact).toHaveBeenCalledTimes(afterRejection ? 1 : 0);
  });

  it.each([
    { code: 422, leaveBeforeResponse: false },
    { code: 422, leaveBeforeResponse: true },
    { code: 409, leaveBeforeResponse: false },
    { code: 409, leaveBeforeResponse: true },
  ])("retains a $code rejection when leaving before response is $leaveBeforeResponse", async ({ code, leaveBeforeResponse }) => {
    const pending = deferred<{ code: number; data: null; message: string }>();
    api.source.mockResolvedValue(response(correctionSource));
    api.updateFact.mockReturnValueOnce(pending.promise).mockResolvedValue(response({ ...completed, kind: "correct" }));
    const conflict = { ...accepted, kind: "correct", status: "failed", error: { code: "fact_revision_conflict", retryable: false } };
    api.query.mockResolvedValue(response(conflict));
    await openDetails();
    await submitCorrection();
    const originalKey = api.updateFact.mock.calls[0][2].idempotency_key;
    if (leaveBeforeResponse) {
      tab(messages.project.users.table.memories);
      expect(screen.queryByRole("region", { name: messages.provenance.editFact })).toBeNull();
      expect(screen.queryByText(messages.provenance.title)).toBeNull();
    }
    await act(async () => { pending.resolve({ code, data: null, message: code === 422 ? "invalid_fact_evidence" : "fact_revision_conflict" }); });
    if (code === 409) {
      tab(messages.project.users.provenance);
      const query = await screen.findByRole("button", { name: messages.provenance.query });
      fireEvent.click(query);
      await screen.findByRole("button", { name: messages.provenance.dismissRejectedCorrection });
      expect(api.query).toHaveBeenCalledWith("user-1", originalKey, undefined);
      fireEvent.click(screen.getByRole("button", { name: messages.provenance.dismissRejectedCorrection }));
    }
    tab(messages.project.users.table.memories);
    expect(screen.queryByText(messages.provenance.title)).toBeNull();
    api.source.mockResolvedValue(response({ ...correctionSource, evidence: [{ ...correctionFact, revision: 4, content: "Current server revision" }] }));
    tab(messages.project.users.provenance);
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.inspect }));
    const restored = await screen.findByRole("region", { name: messages.provenance.editFact });
    expect((within(restored).getByLabelText(messages.provenance.factContent) as HTMLTextAreaElement).value).toBe("Retain this proposal");
    expect((within(restored).getByLabelText(messages.provenance.correctionReason) as HTMLTextAreaElement).value).toBe("Verified original conversation");
    expect((within(restored).getByLabelText(messages.provenance.callerVerified) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(restored).getByRole("button", { name: messages.provenance.reviewCorrection }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.updateFact).toHaveBeenCalledOnce();
    fireEvent.click(within(restored).getByLabelText(messages.provenance.callerVerified));
    fireEvent.click(within(restored).getByRole("button", { name: messages.provenance.reviewCorrection }));
    expect(within(screen.getByRole("alertdialog")).getByText("Current server revision")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.provenance.saveCorrection }));
    await waitFor(() => expect(api.updateFact).toHaveBeenCalledTimes(2));
    expect(api.updateFact.mock.calls[1][2]).toMatchObject({ expected_revision: 4, content: "Retain this proposal", reason: "Verified original conversation" });
    expect(api.updateFact.mock.calls[1][2].idempotency_key).not.toBe(originalKey);
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.inspect }));
    await screen.findByText("Current server revision");
    expect(screen.queryByRole("region", { name: messages.provenance.editFact })).toBeNull();
    expect(api.retry).not.toHaveBeenCalled();
  });

  it("keeps a late rejected proposal with its user while another user's editor is open", async () => {
    const pending = deferred<{ code: number; data: null; message: string }>();
    api.users.mockImplementation(async () => response({ users: [user(2), { ...user(2), id: "user-2" }], count: 2 }));
    api.source.mockResolvedValue(response(correctionSource));
    api.updateFact.mockReturnValueOnce(pending.promise);
    mount();
    const openUser = async (uid: string) => {
      const row = (await screen.findByText(uid)).closest("tr")!;
      fireEvent.click(within(row).getByRole("button", { name: messages.project.users.table.memories }));
      await screen.findByTestId("memory-snapshot");
    };
    await openUser("user-1");
    await submitCorrection();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await openUser("user-2");
    await inspectCorrection();
    expect(screen.queryByRole("region", { name: messages.provenance.editFact })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages.provenance.editFact }));
    await act(async () => { pending.resolve({ code: 422, data: null, message: "invalid_fact_evidence" }); });
    expect((screen.getByLabelText(messages.provenance.factContent) as HTMLTextAreaElement).value).toBe("Original fact");
    expect((screen.getByLabelText(messages.provenance.correctionReason) as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await openUser("user-1");
    await inspectCorrection();
    expect((screen.getByLabelText(messages.provenance.factContent) as HTMLTextAreaElement).value).toBe("Retain this proposal");
    expect((screen.getByLabelText(messages.provenance.correctionReason) as HTMLTextAreaElement).value).toBe("Verified original conversation");
    expect(api.updateFact).toHaveBeenCalledOnce();
    expect(api.updateFact.mock.calls[0][0]).toBe("user-1");
  });

  it("releases a rejected draft when cancelling or choosing a different Fact", async () => {
    const otherFact = { ...correctionFact, fact_id: "fact-2", content: "Another fact" };
    api.source.mockResolvedValue(response(correctionSource));
    api.updateFact.mockResolvedValue({ code: 422, data: null, message: "invalid_fact_evidence" });
    await openDetails();
    await submitCorrection();
    api.source.mockResolvedValue(response({ ...correctionSource, evidence: [correctionFact, otherFact] }));
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.inspect }));
    await screen.findByText(messages.provenance.draftRetained);
    fireEvent.click(within(screen.getByText("Another fact").parentElement!).getByRole("button", { name: messages.provenance.editFact }));
    expect((screen.getByLabelText(messages.provenance.factContent) as HTMLTextAreaElement).value).toBe("Another fact");
    expect((screen.getByLabelText(messages.provenance.correctionReason) as HTMLTextAreaElement).value).toBe("");
    fireEvent.click(within(screen.getByRole("region", { name: messages.provenance.editFact })).getByRole("button", { name: messages.provenance.cancel }));
    tab(messages.project.users.table.memories);
    tab(messages.project.users.provenance);
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.inspect }));
    await screen.findByText("Another fact");
    expect(screen.queryByRole("region", { name: messages.provenance.editFact })).toBeNull();
    expect(api.updateFact).toHaveBeenCalledOnce();
  });
});

describe("source mutation → all user memory views", () => {
  it("shows fact attribution and uncertainty without requiring legacy profile categories", async () => {
    api.source.mockResolvedValue(response({ source_id: "source-1", blobs: [],
      evidence: [
        { fact_id: "reported", content: "User suspects Zhang is changing jobs", topic: null, sub_topic: null,
          subject: "Zhang", reporter: "user", certainty: "uncertain", support_groups: [["hobby"]] },
        { fact_id: "legacy", content: "User enjoys pottery", topic: "interest", sub_topic: "craft", support_groups: [["craft"]] },
      ],
      message_ids: ["hobby", "craft"], deleted_message_ids: [], next_message_offset: null, next_blob_offset: null, next_evidence_offset: null }));
    await openDetails();
    tab(messages.project.users.provenance);
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.inspect }));
    await screen.findByText(`${messages.provenance.subject}: Zhang`);
    expect(screen.getByText(`${messages.provenance.reporter}: user`)).toBeTruthy();
    expect(screen.getByText("uncertain")).toBeTruthy();
    expect(screen.getByText("interest / craft")).toBeTruthy();
    expect(screen.queryByText("/")).toBeNull();
  });

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
    api.provenance.mockResolvedValue(response({ sources: [], profiles: [], history: [], operations: [failed], maintenance: { pending_blob_count: 0, flushes: [] } }));
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
    api.provenance.mockResolvedValue(response({ sources: [], profiles: [], history: [], operations: [failed], maintenance: { pending_blob_count: 0, flushes: [] } }));
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

  it("retains the failed original flush code and explicit recovery after polling", async () => {
    const failed = { ...accepted, kind: "flush", error: { code: "maintenance_invalid_identifier", retryable: false }, status: "failed" };
    api.provenance.mockResolvedValue(response({ sources: [], profiles: [], history: [], operations: [failed], maintenance: { pending_blob_count: 0, flushes: [] } }));
    api.retry.mockResolvedValue(response({ ...failed, status: "processing", error: null }));
    api.query.mockResolvedValue(response(failed));
    await openDetails();
    tab(messages.project.users.provenance);
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.recover }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith("user-1", "op-1"));
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.query }));
    await screen.findByText("maintenance_invalid_identifier");
    expect(screen.getByRole("status").textContent).toBe(messages.provenance.failed);
    expect(screen.queryByText(messages.provenance.unknown)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages.provenance.recover }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledTimes(2));
    expect(api.retry.mock.calls.every(call => call[1] === "op-1")).toBe(true);
    expect(api.memories).toHaveBeenCalledOnce();
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
