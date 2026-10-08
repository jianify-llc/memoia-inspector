import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import type { MaintenanceStatus } from "@jianify/memoia";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { MaintenanceNotice } from "@/components/maintenance-status";

const flush = { operation_id: "11111111-1111-4111-8111-111111111111", status: "failed" as const,
  blob_ids: ["22222222-2222-4222-8222-222222222222"], attempts: 4, available_at: null,
  error: { code: "maintenance_timeout", retryable: true }, retryable: true };
const state: MaintenanceStatus = { pending_blob_count: 0, flushes: [flush] };
const render = (status: MaintenanceStatus, locale = "en", onRecover?: (id: string) => void) => renderToStaticMarkup(
  <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "en" ? en : zh}>
    <MaintenanceNotice state={status} onRecover={onRecover} />
  </NextIntlClientProvider>,
);

describe("Fact confirmation is independent of derived UI state", () => {
  it("shows fixed batch progress and original-flush recovery after a derived failure", () => {
    const html = render(state, "en", () => undefined);
    expect(html).toContain("Blobs 1 · Attempts 4/4");
    expect(html).toContain("maintenance_timeout");
    expect(html).toContain("does not require importing messages again");
    expect(html).toContain("Resume original flush");
    expect(html.split("</p>")[0]).toContain("Failed");
    expect(html.split("</p>")[0]).not.toContain("Pending");
  });
  it("allows explicit recovery after nonretryable failures but requires the failed task identity", () => {
    const manual = render({ ...state, flushes: [{ ...flush, retryable: false }] }, "en", () => undefined);
    expect(manual).toContain("<button");
    expect(manual).toContain("Automatic retries stopped");
    expect(render({ ...state, flushes: [] }, "en", () => undefined)).not.toContain("<button");
    for (const status of ["pending", "running", "completed"] as const) {
      expect(render({ ...state, flushes: [{ ...flush, status }] }, "en", () => undefined)).not.toContain("<button");
    }
  });
  it("labels pending state in Chinese and removes the stale warning only on completion", () => {
    expect(render({ ...state, pending_blob_count: 1, flushes: [] }, "zh")).toContain("待更新");
    const completed = render({ ...state, flushes: [{ ...flush, status: "completed", error: null }] });
    expect(completed).toContain("Up to date");
    expect(completed).not.toContain("older profile/event text may remain");
  });
  it("shows the bounded tail and automatic backoff without offering a fresh retry budget", () => {
    const html = render({ pending_blob_count: 2, flushes: [{ ...flush, status: "pending", attempts: 1 }] }, "en", () => undefined);
    expect(html).toContain("Blobs 1 · Attempts 1/4");
    expect(html).toContain("maintenance_timeout");
    expect(html).not.toContain("Resume original flush");
    expect(html).not.toContain("Up to date");
  });
  it("does not hide a failed original flush behind a new pending batch", () => {
    const html = render({ pending_blob_count: 1, flushes: [flush, {...flush, operation_id: "new", status: "pending"}] });
    expect(html.split("</p>")[0]).toContain("Failed");
  });
});
