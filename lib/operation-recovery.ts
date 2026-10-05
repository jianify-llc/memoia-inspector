import type { Operation } from "@jianify/memoia";

export type ProvenanceMutation = { pendingKey: string | null; operation: Operation | null; busy: boolean };

export function hasUnconfirmedMutation(mutation: { pendingKey: string | null; operation: Pick<Operation, "status"> | null }) {
  if (mutation.pendingKey) return true;
  return Boolean(mutation.operation && mutation.operation.status !== "completed");
}

/** Capacity failures require an explicit operator retry, not automatic polling/replay. */
export function canResumeOperation(operation: Pick<Operation, "status" | "error">) {
  if (operation.status === "processing") return true;
  if (operation.status !== "failed") return false;
  return Boolean(operation.error?.retryable || operation.error?.code === "reconciliation_too_large");
}
