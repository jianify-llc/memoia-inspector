"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { IssuedKey, KeyCreate, Keys, ManagedProject } from "@jianify/memoia";
import { ADMIN_PAGE_SIZE, createKey, createProject, listKeys, listProjects, revokeKey, updateProject } from "@/api/models/projects";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";

type Confirmation = { project: ManagedProject } | { key: Keys["keys"][number] };

/** The API owns authorization. Tokens returned on creation stay in this mounted view only. */
export default function ProjectAdmin() {
  const t = useTranslations("projectAdmin");
  const [projects, setProjects] = useState<ManagedProject[]>([]);
  const [keys, setKeys] = useState<Keys["keys"]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [projectPage, setProjectPage] = useState(0);
  const [keyPage, setKeyPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [keyName, setKeyName] = useState("");
  const [scopes, setScopes] = useState<KeyCreate["scopes"]>(["read", "write"]);
  const [expiry, setExpiry] = useState("");
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false); setProjects([]); setKeys([]);
    void Promise.all([
      listProjects(projectPage, controller.signal),
      selected ? listKeys(selected, keyPage, controller.signal) : Promise.resolve(null),
    ]).then(([projectResponse, keyResponse]) => {
      if (controller.signal.aborted) return;
      if (projectResponse.code !== 0 || !projectResponse.data || (keyResponse && (keyResponse.code !== 0 || !keyResponse.data))) {
        setError(true); return;
      }
      setProjects(projectResponse.data.projects);
      setKeys(keyResponse?.data?.keys ?? []);
      setUnknown(false);
    }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectPage, keyPage, selected, revision]);

  const failed = (message: string) => {
    if (message === "OUTCOME_UNKNOWN") setUnknown(true);
    toast.error(message === "OUTCOME_UNKNOWN" ? t("unknown") : message || t("failed"));
  };
  const addProject = async () => {
    setBusy(true);
    try {
      const response = await createProject(projectId);
      if (response.code !== 0 || !response.data) { failed(response.message); return; }
      setProjectId(""); setProjectPage(0); setRevision((value) => value + 1);
    } catch { failed("OUTCOME_UNKNOWN"); }
    finally { setBusy(false); }
  };
  const issueKey = async () => {
    if (!selected) return;
    setBusy(true); setIssued(null);
    try {
      const response = await createKey(selected, { name: keyName, scopes, expires_at: expiry ? new Date(expiry).toISOString() : null });
      if (response.code !== 0 || !response.data) { failed(response.message); return; }
      setIssued(response.data); setKeyName(""); setKeyPage(0); setRevision((value) => value + 1);
    } catch { failed("OUTCOME_UNKNOWN"); }
    finally { setBusy(false); }
  };
  const confirmMutation = async () => {
    if (!confirmation) return;
    setBusy(true);
    try {
      const response = "project" in confirmation
        ? await updateProject(confirmation.project.project_id, { status: confirmation.project.status === "active" ? "suspended" : "active" })
        : selected ? await revokeKey(selected, confirmation.key.key_id) : null;
      if (!response || response.code !== 0) { failed(response?.message || t("failed")); return; }
      setRevision((value) => value + 1);
    } catch { failed("OUTCOME_UNKNOWN"); }
    finally { setBusy(false); setConfirmation(null); }
  };
  const blocked = loading || busy || unknown;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{t("title")}</h2>
        <Button variant="outline" disabled={busy || loading} onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("scope")}</p>
      {loading ? <p role="status">{t("loading")}</p> : error ? <p role="alert">{t("failed")}</p> : null}
      {unknown ? <p role="alert">{t("unknown")}</p> : null}
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); void addProject(); }}>
        <label className="space-y-1 text-sm">{t("projectId")}<Input value={projectId} maxLength={64} required pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*" disabled={blocked} onChange={(event) => setProjectId(event.target.value)} /></label>
        <Button disabled={blocked || !projectId} type="submit">{t("createProject")}</Button>
      </form>
      {projects.map((project) => (
        <Card key={project.project_id}><CardContent className="flex flex-wrap items-center gap-2 pt-4">
          <span className="break-all">{project.project_id}</span><Badge variant="secondary">{project.status}</Badge>
          <Button variant="outline" size="sm" disabled={blocked} onClick={() => { setIssued(null); setSelected(project.project_id); setKeyPage(0); }}>{t("manageKeys")}</Button>
          {project.project_id !== "__root__" ? <Button variant="outline" size="sm" disabled={blocked} onClick={() => setConfirmation({ project })}>{project.status === "active" ? t("suspend") : t("activate")}</Button> : null}
        </CardContent></Card>
      ))}
      <div className="flex gap-2"><Button variant="outline" disabled={blocked || !projectPage} onClick={() => setProjectPage((value) => value - 1)}>{t("previous")}</Button><Button variant="outline" disabled={blocked || projects.length !== ADMIN_PAGE_SIZE} onClick={() => setProjectPage((value) => value + 1)}>{t("next")}</Button></div>
      {selected ? (
        <section className="space-y-3">
          <h3 className="font-semibold">{t("keys")}: {selected}</h3>
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); void issueKey(); }}>
            <label className="block max-w-sm space-y-1 text-sm">{t("keyName")}<Input value={keyName} required maxLength={128} disabled={blocked} onChange={(event) => setKeyName(event.target.value)} /></label>
            <div className="flex flex-wrap gap-4">{(["read", "write", "admin"] as const).map((scope) => <label key={scope} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={scopes.includes(scope)} disabled={blocked} onChange={(event) => setScopes((values) => event.target.checked ? [...values, scope] : values.filter((value) => value !== scope))} />{scope}</label>)}</div>
            <label className="block max-w-sm space-y-1 text-sm">{t("expiry")}<Input type="datetime-local" value={expiry} disabled={blocked} onChange={(event) => setExpiry(event.target.value)} /></label>
            <Button disabled={blocked || !keyName || !scopes.length} type="submit">{t("issueKey")}</Button>
          </form>
          {issued ? <Card><CardContent className="space-y-2 pt-4"><p>{t("tokenOnce")}</p><code className="block break-all text-sm">{issued.token}</code><CopyButton textToCopy={issued.token} /><Button variant="outline" size="sm" onClick={() => setIssued(null)}>{t("hideToken")}</Button></CardContent></Card> : null}
          {keys.map((key) => <Card key={key.key_id}><CardContent className="space-y-1 pt-4 text-sm"><p>{key.name}</p><p className="break-all text-xs">{key.key_id}</p><p>{key.scopes.join(", ")}</p><p>{key.expires_at ? new Date(key.expires_at).toLocaleString() : t("noExpiry")}</p>{key.revoked_at ? <Badge variant="secondary">{t("revoked")}</Badge> : <Button variant="destructive" size="sm" disabled={blocked} onClick={() => setConfirmation({ key })}>{t("revoke")}</Button>}</CardContent></Card>)}
          <div className="flex gap-2"><Button variant="outline" disabled={blocked || !keyPage} onClick={() => setKeyPage((value) => value - 1)}>{t("previous")}</Button><Button variant="outline" disabled={blocked || keys.length !== ADMIN_PAGE_SIZE} onClick={() => setKeyPage((value) => value + 1)}>{t("next")}</Button></div>
        </section>
      ) : null}
      <AlertDialog open={!!confirmation} onOpenChange={(open) => { if (!open) setConfirmation(null); }}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle><AlertDialogDescription>{t("confirmDescription")}</AlertDialogDescription></AlertDialogHeader><p className="break-all text-sm">{confirmation && ("project" in confirmation ? confirmation.project.project_id : confirmation.key.key_id)}</p><AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => void confirmMutation()}>{t("confirm")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
