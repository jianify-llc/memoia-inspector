import { describe, expect, it } from "vitest";
import { canResumeOperation } from "@/lib/operation-recovery";

describe("explicit accepted-operation recovery", () => {
  it("offers recovery for historical capacity but not a permanently rejected input", () => {
    expect(canResumeOperation({ status: "failed", error: { code: "reconciliation_too_large", retryable: false } })).toBe(true);
    expect(canResumeOperation({ status: "failed", error: { code: "input_too_long", retryable: false } })).toBe(false);
    expect(canResumeOperation({ status: "failed", error: { code: "model_unavailable", retryable: true } })).toBe(true);
    expect(canResumeOperation({ status: "processing", error: null })).toBe(true);
    expect(canResumeOperation({ status: "completed", error: null })).toBe(false);
  });
});
