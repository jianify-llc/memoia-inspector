"use client";

import type { MaintenanceStatus } from "@jianify/memoia";
import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Fact 完成与 flush 完成分别显示；恢复原 Operation，不重放输入。 */
export function MaintenanceNotice({ state, busy = false, onRecover }: {
  state: MaintenanceStatus;
  busy?: boolean;
  onRecover?: (operationId: string) => void;
}) {
  const t = useTranslations("maintenance");
  const failed = state.flushes.some(flush => flush.status === "failed");
  const pending = state.pending_blob_count > 0 || state.flushes.some(flush => flush.status !== "completed");
  return (
    <div role="status" className="space-y-1 rounded-md border p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">{t("title")} <Badge variant="secondary">{t(failed ? "failed" : pending ? "pending" : "completed")}</Badge></p>
      <p>{t("pendingBlobs", { count: state.pending_blob_count })}</p>
      {pending ? <p className="text-muted-foreground">{t("stale")}</p> : null}
      {state.flushes.map(flush => (
        <div key={flush.operation_id} className="space-y-1 border-t pt-2">
          <code className="break-all text-xs">{flush.operation_id}</code> <Badge variant="secondary">{t(flush.status)}</Badge>
          <p>{t("batch", { count: flush.blob_ids.length, attempts: flush.attempts })}</p>
          {flush.error ? <p>{flush.error.code} · {t(flush.status !== "failed" && flush.retryable ? "automaticRetry" : "manualRecovery")}</p> : null}
          {flush.status === "failed" && onRecover ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onRecover(flush.operation_id)}>{t("recover")}</Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
