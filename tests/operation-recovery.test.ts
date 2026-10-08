import { describe, expect, it } from "vitest";
import { canResumeOperation, hasUnconfirmedMutation } from "@/lib/operation-recovery";

describe("explicit accepted-operation recovery", () => {
  it("blocks stale reads until the original key or accepted receipt is resolved", () => {
    expect(hasUnconfirmedMutation({ pendingKey: null, operation: null })).toBe(false);
    expect(hasUnconfirmedMutation({ pendingKey: "original-key", operation: null })).toBe(true);
    expect(hasUnconfirmedMutation({ pendingKey: null, operation: { status: "processing" } })).toBe(true);
    expect(hasUnconfirmedMutation({ pendingKey: null, operation: { status: "failed" } })).toBe(true);
    expect(hasUnconfirmedMutation({ pendingKey: null, operation: { status: "completed" } })).toBe(false);
  });
  it("offers recovery for historical capacity but not a permanently rejected input", () => {
    expect(canResumeOperation({ kind: "import", status: "failed", error: { code: "reconciliation_too_large", retryable: false } })).toBe(true);
    expect(canResumeOperation({ kind: "import", status: "failed", error: { code: "input_too_long", retryable: false } })).toBe(false);
    expect(canResumeOperation({ kind: "import", status: "failed", error: { code: "model_unavailable", retryable: true } })).toBe(true);
    expect(canResumeOperation({ kind: "import", status: "processing", error: null })).toBe(true);
    expect(canResumeOperation({ kind: "import", status: "completed", error: null })).toBe(false);
  });
  it("explicitly resumes a repaired failed flush without allowing rejected input replay", () => {
    const error = { code: "maintenance_invalid_identifier", retryable: false };
    expect(canResumeOperation({ kind: "flush", status: "failed", error })).toBe(true);
    expect(canResumeOperation({ kind: "import", status: "failed", error })).toBe(false);
  });
});
