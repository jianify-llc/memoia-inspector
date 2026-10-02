"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Operation, Source } from "@jianify/memoia";
import { getOperation, getSource, getUserProvenance, PROVENANCE_PAGE_SIZE, retractSourceMessages, retryOperation, type UserProvenanceData } from "@/api/models/memoia";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

/** Provenance is read on demand, without a second cache or stored profile snapshot. */
export function UserProvenance({ userId }: { userId: string }) {
  const t = useTranslations("provenance");
  const [data, setData] = useState<UserProvenanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Source | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setSelected(null);
    setSelectedMessages([]);
    setLoading(true);
    setError(false);
    void getUserProvenance(userId, controller.signal, page).then((response) => {
      if (controller.signal.aborted) return;
      if (response.code !== 0 || !response.data) { setError(true); return; }
      setData(response.data);
    }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, revision, page]);

  const acceptOperation = (result: Operation) => {
    setOperation(result);
    if (result.status === "completed") {
      setPendingKey(null);
      setSelected(null);
      setSelectedMessages([]);
      setRevision((value) => value + 1);
      toast.success(t("completed"));
    } else if (result.status === "failed") {
      // Failed/unknown is not successful deletion, and a fresh key must not hide
      // the original operation. Query and recover explicitly instead of replaying.
      toast.error(result.error?.code || t("failed"));
    }
  };

  const retract = async () => {
    if (!selected || !selectedMessages.length || pendingKey) return;
    const key = `inspector:retract:${crypto.randomUUID()}`;
    setPendingKey(key);
    setOperation(null);
    setBusy(true);
    try {
      const response = await retractSourceMessages(userId, selected.source_id, selectedMessages, key);
      if (response.code !== 0 || !response.data) {
        // Authentication/parameter errors were rejected before acceptance.
        // An unclassified/server failure may have committed; retain its key.
        if ([400, 401, 403, 413, 422].includes(response.code)) setPendingKey(null);
        toast.error(response.message === "OUTCOME_UNKNOWN" ? t("unknown") : response.message || t("failed"));
        return;
      }
      acceptOperation(response.data);
    } catch { toast.error(t("unknown")); }
    finally { setBusy(false); }
  };

  const query = async () => {
    if (!pendingKey) return;
    setBusy(true);
    try {
      const response = await getOperation(userId, pendingKey);
      if (response.code !== 0 || !response.data) { toast.error(response.message || t("failed")); return; }
      acceptOperation(response.data);
    } catch { toast.error(t("failed")); }
    finally { setBusy(false); }
  };

  const inspect = async (sourceId: string) => {
    if (pendingKey) return;
    setBusy(true);
    setSelected(null);
    setSelectedMessages([]);
    try {
      const response = await getSource(userId, sourceId);
      if (response.code !== 0 || !response.data) { toast.error(response.message || t("failed")); return; }
      setSelected(response.data);
    } catch { toast.error(t("failed")); }
    finally { setBusy(false); }
  };

  const recover = async (known = operation) => {
    if (!known) return;
    setBusy(true);
    try {
      const response = await retryOperation(userId, known.operation_id);
      if (response.code !== 0 || !response.data) { toast.error(response.message || t("failed")); return; }
      acceptOperation(response.data);
    } catch { toast.error(t("unknown")); }
    finally { setBusy(false); }
  };

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        <Button variant="outline" size="sm" disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("scope")}</p>
      {loading ? <p role="status">{t("loading")}</p> : error ? <p role="alert">{t("failed")}</p> : null}
      {pendingKey ? (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p role="status">{operation?.status === "processing" ? t("processing") : t("unknown")}</p>
            <code className="block break-all text-xs">{pendingKey}</code>
            <Button size="sm" disabled={busy} onClick={() => void query()}>{t("query")}</Button>
            {operation && (operation.status === "processing" || operation.error?.retryable) ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void recover()}>{t("recover")}</Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {data ? (
        <>
          <h3 className="font-semibold">{t("sources")}</h3>
          {!data.sources.length ? <p>{t("empty")}</p> : data.sources.map((source) => (
            <Card key={source.source_id}>
              <CardContent className="space-y-2 pt-4">
                <p className="break-all text-sm">{source.external_id}</p>
                <Badge variant="secondary">{source.status}</Badge>
                <p className="break-all text-xs text-muted-foreground">{source.source_id}</p>
                <p className="text-xs">{new Date(source.created_at).toLocaleString()}</p>
                <Button variant="outline" size="sm" disabled={busy || !!pendingKey} onClick={() => void inspect(source.source_id)}>{t("inspect")}</Button>
              </CardContent>
            </Card>
          ))}
          {selected ? (
            <Card>
              <CardHeader><CardTitle>{t("evidence")}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {selected.evidence.map((fact) => (
                  <div key={fact.fact_id} className="space-y-1 border-b pb-2">
                    <p>{fact.content}</p>
                    <p className="text-xs text-muted-foreground">{fact.topic} / {fact.sub_topic}</p>
                    <p className="break-all text-xs">{t("support")}: {fact.support_groups.map((group) => group.join(" + ")).join(" | ")}</p>
                  </div>
                ))}
                <p className="text-sm">{t("messages")}</p>
                {selected.message_ids.filter((id) => !selected.retracted_message_ids.includes(id)).map((id) => (
                  <label key={id} className="flex items-center gap-2 break-all text-sm">
                    <input type="checkbox" checked={selectedMessages.includes(id)} disabled={busy || !!pendingKey || selected.status !== "active"}
                      onChange={(event) => setSelectedMessages((values) => event.target.checked ? [...values, id] : values.filter((value) => value !== id))} />
                    {id}
                  </label>
                ))}
                <Button variant="destructive" disabled={!selectedMessages.length || busy || !!pendingKey || selected.status !== "active"} onClick={() => setConfirm(true)}>{t("retract")}</Button>
              </CardContent>
            </Card>
          ) : null}
          <h3 className="font-semibold">{t("profiles")}</h3>
          {data.profiles.map((profile) => (
            <Card key={profile.id}>
              <CardContent className="space-y-1 pt-4">
                <p>{profile.content}</p>
                <p className="text-xs text-muted-foreground">{profile.topic} / {profile.sub_topic}</p>
                <p className="break-all text-xs">{profile.source_ids.join(", ")}</p>
              </CardContent>
            </Card>
          ))}
          <h3 className="font-semibold">{t("history")}</h3>
          {data.history.map((entry) => (
            <Card key={entry.revision_id}>
              <CardContent className="space-y-2 pt-4 text-sm">
                <p>{new Date(entry.created_at).toLocaleString()}</p>
                <p className="break-all text-xs">{entry.revision_id}</p>
                <p className="break-all text-xs">{t("operation")}: {entry.operation_id}</p>
                {[{ label: t("added"), values: entry.added }, { label: t("removed"), values: entry.removed }].map(({ label, values }) => (
                  <div key={label}>
                    <h4 className="font-medium">{label}</h4>
                    {values.map((profile) => <p key={profile.id}>{profile.topic} / {profile.sub_topic}: {profile.content}</p>)}
                  </div>
                ))}
                <details>
                  <summary className="cursor-pointer">{t("snapshot")}</summary>
                  {entry.profiles.map((profile) => <p key={profile.id}>{profile.topic} / {profile.sub_topic}: {profile.content}</p>)}
                </details>
              </CardContent>
            </Card>
          ))}
          <h3 className="font-semibold">{t("operations")}</h3>
          {data.operations.map((existing) => (
            <Card key={existing.operation_id}>
              <CardContent className="space-y-2 pt-4 text-sm">
                <Badge variant="secondary">{existing.status}</Badge>
                <p className="break-all">{existing.external_id}</p>
                <p className="break-all text-xs">{existing.operation_id}</p>
                {existing.error ? <p>{existing.error.code}</p> : null}
                {existing.status === "processing" || existing.error?.retryable ? (
                  <Button variant="outline" size="sm" disabled={busy || !!pendingKey} onClick={() => void recover(existing)}>{t("recover")}</Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" disabled={page === 0 || busy || !!pendingKey} onClick={() => setPage((value) => value - 1)}>{t("previous")}</Button>
            <span className="text-sm">{t("page", { number: page + 1 })}</span>
            <Button variant="outline" disabled={busy || !!pendingKey || ![data.sources, data.history, data.operations].some((items) => items.length === PROVENANCE_PAGE_SIZE)} onClick={() => setPage((value) => value + 1)}>{t("next")}</Button>
          </div>
        </>
      ) : null}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("confirmDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-all text-sm">{selectedMessages.join(", ")}</p>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void retract()}>{t("retract")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
