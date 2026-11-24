// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/messages/en.json";
import type { ProvenanceMutation } from "@/lib/operation-recovery";
import { toast } from "sonner";

const api = vi.hoisted(() => ({ provenance: vi.fn(), source: vi.fn(), update: vi.fn(), remove: vi.fn(), deleteMessages: vi.fn(), query: vi.fn(), retry: vi.fn(), invalidate: vi.fn(), resolved: vi.fn() }));
vi.mock("@/api/models/memoia", () => ({ getUserProvenance: api.provenance, getSource: api.source, updateFact: api.update, deleteFact: api.remove, deleteSourceMessages: api.deleteMessages, getOperation: api.query, retryOperation: api.retry, PROVENANCE_PAGE_SIZE: 20 }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { UserProvenance } from "@/components/user-provenance";

const response = <T,>(data: T) => ({ code: 0, data, message: "OK" });
const fact = { fact_id: "fact-1", blob_id: "blob-1", revision: 3, content: "Original fact", subject: "user", reporter: "user", certainty: "asserted", support_groups: [["m1"]], fact_time: null, created_at: null, updated_at: null };
const receipt = { kind: "correct", operation_id: "op-1", source_id: "source-1", blob_id: "blob-1", status: "completed", result: { memory_version: 4 }, error: null };
function Harness() {
  const [mutation, setMutation] = useState<ProvenanceMutation>({ pendingKey: null, operation: null, busy: false });
  return <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC"><UserProvenance userId="user-1" mutation={mutation} setMutation={setMutation} onInvalidate={api.invalidate} onResolved={api.resolved} /></NextIntlClientProvider>;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.provenance.mockResolvedValue(response({ sources: [{ source_id: "source-1", created_at: "2026-10-01T00:00:00Z" }], profiles: [], history: [], operations: [], maintenance: { pending_blob_count: 0, flushes: [] } }));
  api.source.mockResolvedValue(response({ source_id: "source-1", blobs: [{ blob_id: "blob-1", message_ids: ["m1", "m2", "deleted"], created_at: "2026-10-01T00:00:00Z", kind: "import", status: "active" }], evidence: [fact], message_ids: ["m1", "foreign-blob"], deleted_message_ids: ["deleted"], next_message_offset: 20, next_blob_offset: null, next_evidence_offset: null }));
  api.update.mockResolvedValue(response(receipt));
  api.remove.mockResolvedValue(response(receipt));
});
afterEach(cleanup);
async function open(mode: "edit" | "delete" = "edit") {
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: messages.provenance.inspect }));
  fireEvent.click(await screen.findByRole("button", { name: messages.provenance[mode === "edit" ? "editFact" : "deleteFact"] }));
  return screen.getByRole("region", { name: messages.provenance[mode === "edit" ? "editFact" : "deleteFact"] });
}
function verifyOriginal(editor: HTMLElement) {
  fireEvent.change(within(editor).getByLabelText(messages.provenance.correctionReason), { target: { value: "Checked original caller conversation" } });
  fireEvent.click(within(editor).getByLabelText(messages.provenance.callerVerified));
}
describe("targeted Fact correction", () => {
  it("edits every semantic field, scopes evidence to the original Blob, and confirms before/after", async () => {
    const editor = await open();
    expect(within(editor).queryByLabelText("foreign-blob")).toBeNull();
    expect(within(editor).queryByLabelText("deleted")).toBeNull();
    // m2 is outside the current Source message page, but belongs to the original Blob.
    fireEvent.click(within(editor).getByLabelText("m2"));
    fireEvent.change(within(editor).getByLabelText(messages.provenance.factContent), { target: { value: "Corrected fact" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.subject), { target: { value: "friend" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.reporter), { target: { value: "user" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.certainty), { target: { value: "reported" } });
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.addGroup }));
    fireEvent.click(within(editor).getAllByLabelText("m2")[1]);
    fireEvent.click(within(editor).getByLabelText(messages.provenance.setFactTime));
    fireEvent.change(within(editor).getByLabelText(messages.provenance.precision), { target: { value: "day" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.startDate), { target: { value: "2026-10-01" } });
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.addTimeEvidence }));
    fireEvent.change(within(editor).getByLabelText(messages.provenance.timeMessage), { target: { value: "m2" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.timeExpression), { target: { value: "yesterday" } });
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Original fact")).toBeTruthy();
    expect(within(dialog).getByText("Corrected fact")).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: messages.provenance.saveCorrection }));
    await waitFor(() => expect(api.resolved).toHaveBeenCalledOnce());
    expect(api.update).toHaveBeenCalledExactlyOnceWith("user-1", "fact-1", { idempotency_key: expect.stringMatching(/^inspector:correct-fact:/), expected_revision: 3, reason: "Checked original caller conversation", content: "Corrected fact", subject: "friend", reporter: "user", certainty: "reported", support_groups: [["m1", "m2"], ["m2"]], fact_time: { start: "2026-10-01", end: "2026-10-01", precision: "day", evidence: [{ message_id: "m2", expression: "yesterday" }] } });
    expect(api.deleteMessages).not.toHaveBeenCalled();
  });
  it("requires reason/original-chat verification and rejects empty support groups before submission", async () => {
    const editor = await open();
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    expect(within(editor).getByRole("alert")).toBeTruthy();
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByLabelText("m1"));
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.update).not.toHaveBeenCalled();
  });
  it("deletes only the chosen Fact with its displayed revision and reason", async () => {
    const editor = await open("delete");
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.provenance.deleteFact }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledOnce());
    expect(api.remove).toHaveBeenCalledWith("user-1", "fact-1", { idempotency_key: expect.any(String), expected_revision: 3, reason: "Checked original caller conversation" });
    expect(api.update).not.toHaveBeenCalled();
    expect(api.deleteMessages).not.toHaveBeenCalled();
  });
  it("retains unknown writes for query and never resends a reconstructed proposal", async () => {
    api.update.mockRejectedValue(new Error("acknowledgement lost"));
    api.query.mockResolvedValue(response(receipt));
    const editor = await open();
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.provenance.saveCorrection }));
    const query = await screen.findByRole("button", { name: messages.provenance.query });
    expect(screen.getByText(messages.provenance.expiredCorrection)).toBeTruthy();
    expect(screen.queryByText("Original fact")).toBeNull();
    fireEvent.click(query);
    await waitFor(() => expect(api.resolved).toHaveBeenCalledOnce());
    expect(api.query).toHaveBeenCalledWith("user-1", api.update.mock.calls[0][2].idempotency_key, undefined);
    expect(api.update).toHaveBeenCalledOnce();
    expect(api.invalidate).toHaveBeenCalledOnce();
  });
  it("resumes an accepted correction by receipt, then shows maintenance separately from the Fact commit", async () => {
    api.update.mockResolvedValue(response({ ...receipt, status: "processing", result: null }));
    api.retry.mockResolvedValue(response(receipt));
    const editor = await open();
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.provenance.saveCorrection }));
    const recover = await screen.findByRole("button", { name: messages.provenance.recover });
    await waitFor(() => expect((recover as HTMLButtonElement).disabled).toBe(false));
    api.provenance.mockResolvedValue(response({ sources: [], profiles: [], history: [], operations: [receipt], maintenance: { pending_blob_count: 1, flushes: [] } }));
    fireEvent.click(recover);
    await waitFor(() => expect(api.resolved).toHaveBeenCalledOnce());
    expect(api.retry).toHaveBeenCalledExactlyOnceWith("user-1", "op-1");
    expect(api.update).toHaveBeenCalledOnce();
    await screen.findByText(messages.maintenance.stale);
  });
  it("shows legacy generation timestamps as unknown, independently of batch time", async () => {
    await open();
    expect(screen.getByText(`${messages.provenance.factCreated}: ${messages.provenance.unknownTime}`)).toBeTruthy();
    expect(screen.getByText(`${messages.provenance.factUpdated}: ${messages.provenance.unknownTime}`)).toBeTruthy();
    expect(screen.getByText(new RegExp(`^${messages.provenance.blobCreated}:`))).toBeTruthy();
  });
  it("ends an explicitly acknowledged terminal revision rejection without repeating the proposal", async () => {
    api.update.mockResolvedValue({ code: 409, data: null, message: "fact_revision_conflict" });
    api.query.mockResolvedValue(response({ ...receipt, status: "failed", result: null, error: { code: "fact_revision_conflict", retryable: false } }));
    const editor = await open();
    verifyOriginal(editor);
    fireEvent.change(within(editor).getByLabelText(messages.provenance.factContent), { target: { value: "Deliberate revised proposal" } });
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.provenance.saveCorrection }));
    const query = await screen.findByRole("button", { name: messages.provenance.query });
    fireEvent.click(query);
    const dismiss = await screen.findByRole("button", { name: messages.provenance.dismissRejectedCorrection });
    expect(api.resolved).not.toHaveBeenCalled();
    const source = await api.source.getMockImplementation()!();
    api.source.mockResolvedValue({ ...source, data: { ...source.data, evidence: [{ ...fact, revision: 4, content: "Current server revision" }] } });
    fireEvent.click(dismiss);
    await waitFor(() => expect(api.resolved).toHaveBeenCalledOnce());
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.inspect }));
    await screen.findByText(messages.provenance.draftRetained);
    const restored = screen.getByRole("region", { name: messages.provenance.editFact });
    expect((within(restored).getByLabelText(messages.provenance.callerVerified) as HTMLInputElement).checked).toBe(false);
    expect((within(restored).getByLabelText(messages.provenance.factContent) as HTMLTextAreaElement).value).toBe("Deliberate revised proposal");
    verifyOriginal(restored);
    fireEvent.click(within(restored).getByRole("button", { name: messages.provenance.reviewCorrection }));
    expect(within(screen.getByRole("alertdialog")).getByText("Current server revision")).toBeTruthy();
    expect(api.update).toHaveBeenCalledOnce();
    expect(api.retry).not.toHaveBeenCalled();
  });
  it("resumes input_required only by original receipt after the caller has supplied the original proposal", async () => {
    api.update.mockResolvedValue(response({ ...receipt, status: "failed", result: null, error: { code: "input_required", retryable: false } }));
    api.retry.mockResolvedValueOnce({ code: 409, data: null, message: "input_required" }).mockResolvedValueOnce(response(receipt));
    const editor = await open();
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.provenance.saveCorrection }));
    await screen.findByText("input_required");
    expect(screen.queryByRole("button", { name: messages.provenance.dismissRejectedCorrection })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: messages.provenance.recoverReplenished }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledOnce());
    expect(toast.success).not.toHaveBeenCalled();
    expect(api.resolved).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(messages.provenance.inputRequiredQuery);
    await waitFor(() => expect((screen.getByRole("button", { name: messages.provenance.recoverReplenished }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: messages.provenance.recoverReplenished }));
    await waitFor(() => expect(api.resolved).toHaveBeenCalledOnce());
    expect(api.retry.mock.calls).toEqual([["user-1", "op-1"], ["user-1", "op-1"]]);
    expect(api.update).toHaveBeenCalledOnce();
  });
  it("requires explicit subject, reporter and a supported certainty when correcting legacy facts", async () => {
    const original = api.source.getMockImplementation()!;
    api.source.mockImplementation(async () => {
      const result = await original();
      return { ...result, data: { ...result.data, evidence: [{ ...fact, subject: null, reporter: null, certainty: "legacy" }] } };
    });
    const editor = await open();
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((within(editor).getByLabelText(messages.provenance.certainty) as HTMLSelectElement).value).toBe("");
    fireEvent.change(within(editor).getByLabelText(messages.provenance.subject), { target: { value: "user" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.reporter), { target: { value: "user" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.certainty), { target: { value: "uncertain" } });
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();
  });
  it.each([
    ["range", "2024-06-10", "", false],
    ["range", "2024-06-10", "2024-06-09", false],
    ["month", "2024-02-02", "2024-02-29", false],
    ["month", "2024-02-01", "2024-02-28", false],
    ["month", "2024-02-01", "2024-02-29", true],
    ["year", "2024-01-02", "2024-12-31", false],
    ["year", "2024-01-01", "2024-12-31", true],
  ])("checks the actual %s boundary contract (%s–%s)", async (precision, start, end, valid) => {
    const editor = await open();
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByLabelText(messages.provenance.setFactTime));
    fireEvent.change(within(editor).getByLabelText(messages.provenance.precision), { target: { value: precision } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.startDate), { target: { value: start } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.endDate), { target: { value: end } });
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.addTimeEvidence }));
    fireEvent.change(within(editor).getByLabelText(messages.provenance.timeMessage), { target: { value: "m1" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.timeExpression), { target: { value: "original date expression" } });
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    expect(Boolean(screen.queryByRole("alertdialog"))).toBe(valid);
    expect(api.update).not.toHaveBeenCalled();
  });
  it("requires time evidence and keeps unknown dates empty", async () => {
    const editor = await open();
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByLabelText(messages.provenance.setFactTime));
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.change(within(editor).getByLabelText(messages.provenance.precision), { target: { value: "day" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.startDate), { target: { value: "2024-06-10" } });
    fireEvent.change(within(editor).getByLabelText(messages.provenance.precision), { target: { value: "unknown" } });
    expect((within(editor).getByLabelText(messages.provenance.startDate) as HTMLInputElement).value).toBe("");
    expect((within(editor).getByLabelText(messages.provenance.endDate) as HTMLInputElement).value).toBe("");
    expect((within(editor).getByLabelText(messages.provenance.startDate) as HTMLInputElement).disabled).toBe(true);
  });
  it("requires time evidence to be jointly supported by one AND group", async () => {
    const editor = await open();
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.addGroup }));
    fireEvent.click(within(editor).getAllByLabelText("m2")[1]);
    fireEvent.click(within(editor).getByLabelText(messages.provenance.setFactTime));
    for (const id of ["m1", "m2"]) {
      fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.addTimeEvidence }));
      const selects = within(editor).getAllByLabelText(messages.provenance.timeMessage);
      const expressions = within(editor).getAllByLabelText(messages.provenance.timeExpression);
      fireEvent.change(selects[selects.length - 1], { target: { value: id } });
      fireEvent.change(expressions[expressions.length - 1], { target: { value: "date expression" } });
    }
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(within(editor).getAllByLabelText("m2")[0]);
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
  it("retains a rejected draft for deliberate correction after fresh evidence is read", async () => {
    api.update.mockResolvedValue({ code: 422, data: null, message: "invalid_fact_evidence" });
    const editor = await open();
    verifyOriginal(editor);
    fireEvent.change(within(editor).getByLabelText(messages.provenance.factContent), { target: { value: "Keep this proposed correction" } });
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.provenance.saveCorrection }));
    await waitFor(() => expect(api.resolved).toHaveBeenCalledOnce());
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.inspect }));
    await screen.findByText(messages.provenance.draftRetained);
    expect((screen.getByLabelText(messages.provenance.factContent) as HTMLTextAreaElement).value).toBe("Keep this proposed correction");
    expect((screen.getByLabelText(messages.provenance.correctionReason) as HTMLTextAreaElement).value).toBe("Checked original caller conversation");
    expect((screen.getByLabelText(messages.provenance.callerVerified) as HTMLInputElement).checked).toBe(false);
    expect(api.update).toHaveBeenCalledOnce();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("releases an unregistered fact_not_found rejection without waiting for an absent receipt", async () => {
    api.remove.mockResolvedValue({ code: 404, data: null, message: "fact_not_found" });
    const editor = await open("delete");
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.provenance.deleteFact }));
    await waitFor(() => expect(api.resolved).toHaveBeenCalledOnce());
    await screen.findByRole("button", { name: messages.provenance.inspect });
    expect(screen.queryByRole("button", { name: messages.provenance.query })).toBeNull();
    expect(api.query).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("handles a real retry HTTP input_required without fabricating a failed receipt or successful completion", async () => {
    api.update.mockResolvedValue(response({ ...receipt, status: "processing", result: null }));
    api.retry.mockResolvedValue({ code: 409, data: null, message: "input_required" });
    const editor = await open();
    verifyOriginal(editor);
    fireEvent.click(within(editor).getByRole("button", { name: messages.provenance.reviewCorrection }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: messages.provenance.saveCorrection }));
    fireEvent.click(await screen.findByRole("button", { name: messages.provenance.recover }));
    await screen.findByRole("button", { name: messages.provenance.recoverReplenished });
    expect(screen.getByRole("status").textContent).toBe(messages.provenance.processing);
    expect(screen.getByRole("button", { name: messages.provenance.query })).toBeTruthy();
    expect(api.resolved).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(api.update).toHaveBeenCalledOnce();
  });
});
