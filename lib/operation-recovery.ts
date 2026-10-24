import type { Evidence, Operation, UpdateFact } from "@jianify/memoia";

export type FactCorrectionValues = Omit<UpdateFact, "idempotency_key" | "expected_revision" | "certainty"> & {
  certainty: UpdateFact["certainty"] | "";
};

export type FactCorrectionDraft = {
  fact: Evidence;
  mode: "edit" | "delete";
  draft?: FactCorrectionValues;
  submitted?: boolean;
};

export type ProvenanceMutation = {
  pendingKey: string | null;
  operation: Operation | null;
  busy: boolean;
  correction?: FactCorrectionDraft | null;
};

export function hasUnconfirmedMutation(mutation: { pendingKey: string | null; operation: Pick<Operation, "status"> | null }) {
  if (mutation.pendingKey) return true;
  return Boolean(mutation.operation && mutation.operation.status !== "completed");
}

/** flush 修复后恢复原批次；输入错误不能因此获得正文重放权限。 */
export function canResumeOperation(operation: Pick<Operation, "status" | "error" | "kind">) {
  if (operation.status === "processing") return true;
  if (operation.status !== "failed") return false;
  if (operation.kind === "flush") return true;
  if (operation.kind === "correct" && operation.error?.code === "input_required") return true;
  return Boolean(operation.error?.retryable || operation.error?.code === "reconciliation_too_large" || operation.error?.code === "related_facts_too_large");
}
