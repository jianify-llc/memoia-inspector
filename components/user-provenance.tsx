"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import type { Operation, Source } from "@jianify/memoia";
import { getOperation, getSource, getUserProvenance, PROVENANCE_PAGE_SIZE, deleteSourceMessages, retryOperation, type UserProvenanceData } from "@/api/models/memoia";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { canResumeOperation, hasUnconfirmedMutation, type ProvenanceMutation } from "@/lib/operation-recovery";
import { appendSourcePage, type SourceCollection } from "@/lib/source-page";

/** Provenance reads locally; the detail owner coordinates mutation and memory refresh. */
export function UserProvenance({ userId, mutation, setMutation, onInvalidate, onResolved }: {
  userId: string;
  mutation: ProvenanceMutation;
  setMutation: Dispatch<SetStateAction<ProvenanceMutation>>;
  onInvalidate: () => void;
  onResolved: () => void;
}) {
  const t = useTranslations("provenance");
  const [data, setData] = useState<UserProvenanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Source | null>(null);
  const [selectedMessages, setSelectedMessages] = useState<string[]>([]);
  const [confirm, setConfirm] = useState(false);
  const { busy, pendingKey, operation } = mutation;
  const unresolved = hasUnconfirmedMutation(mutation);
  const setBusy = (value: boolean) => setMutation((current) => ({ ...current, busy: value }));
  const setPendingKey = (value: string | null) => setMutation((current) => ({ ...current, pendingKey: value }));
  const setOperation = (value: Operation | null) => setMutation((current) => ({ ...current, operation: value }));

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setSelected(null);
    setSelectedMessages([]);
    if (unresolved) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    setError(false);
    void getUserProvenance(userId, controller.signal, page).then((response) => {
      if (controller.signal.aborted) return;
      if (response.code !== 0 || !response.data) { setError(true); return; }
      setData(response.data);
    }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, revision, page, unresolved]);

  const acceptOperation = (result: Operation) => {
    setOperation(result);
    if (result.status === "completed") {
      setPendingKey(null);
      setSelected(null);
      setSelectedMessages([]);
      setRevision((value) => value + 1);
      onResolved();
      toast.success(t("completed"));
    } else if (result.status === "failed") {
      // Failed/unknown is not successful deletion, and a fresh key must not hide
      // the original operation. Query and recover explicitly instead of replaying.
      toast.error(result.error?.code || t("failed"));
    }
  };

  const deleteMessages = async () => {
    if (!selected || !selectedMessages.length || unresolved || busy) return;
    const key = `inspector:delete-messages:${crypto.randomUUID()}`;
    setPendingKey(key);
    setOperation(null);
    setBusy(true);
    onInvalidate();
    try {
      const response = await deleteSourceMessages(userId, selected.source_id, selectedMessages, key);
      if (response.code !== 0 || !response.data) {
        // Authentication/parameter errors were rejected before acceptance.
        // An unclassified/server failure may have committed; retain its key.
        // 413 can occur after accepted withdrawal hid evidence; query its key.
        if ([400, 401, 403, 415, 422].includes(response.code)) {
          setPendingKey(null);
          onResolved();
        }
        toast.error(response.message === "OUTCOME_UNKNOWN" ? t("unknown") : response.message || t("failed"));
        return;
      }
      acceptOperation(response.data);
    } catch { toast.error(t("unknown")); }
    finally { setBusy(false); }
  };

  const query = async () => {
    if (!pendingKey && !operation) return;
    setBusy(true);
    try {
      const response = await getOperation(userId, pendingKey, operation?.operation_id);
      if (response.code !== 0 || !response.data) { toast.error(response.message || t("failed")); return; }
      acceptOperation(response.data);
    } catch { toast.error(t("failed")); }
    finally { setBusy(false); }
  };

  const inspect = async (sourceId: string) => {
    if (unresolved || busy) return;
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
    setOperation(known);
    setBusy(true);
    onInvalidate();
    try {
      const response = await retryOperation(userId, known.operation_id);
      if (response.code !== 0 || !response.data) { toast.error(response.message || t("failed")); return; }
      acceptOperation(response.data);
    } catch { toast.error(t("unknown")); }
    finally { setBusy(false); }
  };

  const more = async (collection: SourceCollection) => {
    if (!selected || busy || unresolved) return;
    const offset = collection === "messages" ? selected.next_message_offset :
      collection === "blobs" ? selected.next_blob_offset : selected.next_evidence_offset;
    if (offset === null) return;
    const field = collection === "messages" ? "message_offset" :
      collection === "blobs" ? "blob_offset" : "evidence_offset";
    setBusy(true);
    try {
      const response = await getSource(userId, selected.source_id, { [field]: offset });
      if (response.code !== 0 || !response.data) { toast.error(response.message || t("failed")); return; }
      setSelected(appendSourcePage(selected, response.data, collection));
    } catch { toast.error(t("failed")); }
    finally { setBusy(false); }
  };

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        <Button variant="outline" size="sm" disabled={loading || busy || unresolved} onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("scope")}</p>
      {loading ? <p role="status">{t("loading")}</p> : error ? <p role="alert">{t("failed")}</p> : null}
      {unresolved ? (
        <Card>
          <CardContent className="space-y-2 pt-4">
            <p role="status">{operation?.status === "processing" ? t("processing") : t("unknown")}</p>
            <code className="block break-all text-xs">{pendingKey || operation?.operation_id}</code>
            <Button size="sm" disabled={busy} onClick={() => void query()}>{t("query")}</Button>
            {operation && canResumeOperation(operation) ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void recover()}>{t("recover")}</Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {data && !unresolved ? (
        <>
          <h3 className="font-semibold">{t("sources")}</h3>
          {!data.sources.length ? <p>{t("empty")}</p> : data.sources.map((source) => (
            <Card key={source.source_id}>
              <CardContent className="space-y-2 pt-4">
                {source.legacy ? <Badge variant="secondary">legacy</Badge> : null}
                <p className="break-all text-xs text-muted-foreground">{source.source_id}</p>
                <p className="text-xs">{new Date(source.created_at).toLocaleString()}</p>
                <Button variant="outline" size="sm" disabled={busy || unresolved} onClick={() => void inspect(source.source_id)}>{t("inspect")}</Button>
              </CardContent>
            </Card>
          ))}
          {selected ? (
            <Card>
              <CardHeader><CardTitle>{t("evidence")}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <h4 className="font-medium">{t("blobs")}</h4>
                {selected.blobs.map((blob) => (
                  <div key={blob.blob_id} className="space-y-1 border-b pb-2 text-xs">
                    <code className="break-all">{blob.blob_id}</code>
                    <Badge variant="secondary">{blob.status}</Badge>
                    <p>{blob.message_ids.join(", ")}</p>
                  </div>
                ))}
                {selected.next_blob_offset !== null ? <Button variant="outline" size="sm" disabled={busy || unresolved} onClick={() => void more("blobs")}>{t("moreBlobs")}</Button> : null}
                {selected.evidence.map((fact) => (
                  <div key={fact.fact_id} className="space-y-1 border-b pb-2">
                    <p>{fact.content}</p>
                    <p className="text-xs text-muted-foreground">{fact.topic} / {fact.sub_topic}</p>
                    <p className="break-all text-xs">{t("support")}: {fact.support_groups.map((group) => group.join(" + ")).join(" | ")}</p>
                  </div>
                ))}
                {selected.next_evidence_offset !== null ? <Button variant="outline" size="sm" disabled={busy || unresolved} onClick={() => void more("evidence")}>{t("moreEvidence")}</Button> : null}
                <p className="text-sm">{t("messages")}</p>
                {selected.message_ids.filter((id) => !selected.deleted_message_ids.includes(id)).map((id) => (
                  <label key={id} className="flex items-center gap-2 break-all text-sm">
                    <input type="checkbox" checked={selectedMessages.includes(id)} disabled={busy || unresolved}
                      onChange={(event) => setSelectedMessages((values) => event.target.checked ? [...values, id] : values.filter((value) => value !== id))} />
                    {id}
                  </label>
                ))}
                {selected.next_message_offset !== null ? <Button variant="outline" size="sm" disabled={busy || unresolved} onClick={() => void more("messages")}>{t("moreMessages")}</Button> : null}
                <Button variant="destructive" disabled={!selectedMessages.length || busy || unresolved} onClick={() => setConfirm(true)}>{t("deleteMessages")}</Button>
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
                <p className="break-all">{existing.source_id}</p>
                {existing.blob_id ? <p className="break-all text-xs">{existing.blob_id}</p> : null}
                <p className="break-all text-xs">{existing.operation_id}</p>
                {existing.error ? <p>{existing.error.code}</p> : null}
                {canResumeOperation(existing) ? (
                  <Button variant="outline" size="sm" disabled={busy || unresolved} onClick={() => void recover(existing)}>{t("recover")}</Button>
                ) : null}
              </CardContent>
            </Card>
          ))}
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" disabled={page === 0 || busy || unresolved} onClick={() => setPage((value) => value - 1)}>{t("previous")}</Button>
            <span className="text-sm">{t("page", { number: page + 1 })}</span>
            <Button variant="outline" disabled={busy || unresolved || ![data.sources, data.history, data.operations].some((items) => items.length === PROVENANCE_PAGE_SIZE)} onClick={() => setPage((value) => value + 1)}>{t("next")}</Button>
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
            <AlertDialogAction disabled={busy} onClick={() => void deleteMessages()}>{t("deleteMessages")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
