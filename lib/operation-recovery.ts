import type { Operation } from "@jianify/memoia";

/** Capacity failures require an explicit operator retry, not automatic polling/replay. */
export function canResumeOperation(operation: Pick<Operation, "status" | "error">) {
  if (operation.status === "processing") return true;
  if (operation.status !== "failed") return false;
  return Boolean(operation.error?.retryable || operation.error?.code === "reconciliation_too_large");
}
