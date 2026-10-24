"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Evidence, FactTime, UpdateFact } from "@jianify/memoia";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FactCorrectionValues } from "@/lib/operation-recovery";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type FactProposal = Omit<UpdateFact, "idempotency_key">;

export function FactValues({ fact }: { fact: Pick<Evidence, "content" | "subject" | "reporter" | "certainty" | "support_groups" | "fact_time"> }) {
  const t = useTranslations("provenance");
  return <div className="space-y-1 break-words text-sm">
    <p>{fact.content}</p>
    <p>{t("subject")}: {fact.subject || "—"}</p>
    <p>{t("reporter")}: {fact.reporter || "—"} · {t("certainty")}: {fact.certainty}</p>
    <p>{t("support")}: {fact.support_groups.map(group => `(${group.join(" AND ")})`).join(" OR ")}</p>
    <p>{t("factTime")}: {fact.fact_time ? `${fact.fact_time.start || "—"} / ${fact.fact_time.end || "—"} · ${fact.fact_time.precision}` : t("unknownTime")}</p>
    {fact.fact_time?.evidence.map((item, index) => <p key={index} className="text-xs">{item.message_id}: {item.expression}</p>)}
  </div>;
}

/** The proposal preserves Fact identity and is submitted only after an explicit comparison. */
export function FactCorrection({ fact, messageIds, mode, busy, draft, submitted, onDraftChange, onCancel, onSubmit }: {
  fact: Evidence;
  messageIds: string[];
  mode: "edit" | "delete";
  busy: boolean;
  draft?: FactCorrectionValues;
  submitted?: boolean;
  onDraftChange: (draft: FactCorrectionValues) => void;
  onCancel: () => void;
  onSubmit: (proposal: FactProposal | Pick<FactProposal, "reason" | "expected_revision">) => void;
}) {
  const t = useTranslations("provenance");
  const values: FactCorrectionValues = draft ?? { content: fact.content, subject: fact.subject ?? "", reporter: fact.reporter ?? "",
    certainty: fact.certainty === "legacy" ? "" : fact.certainty, support_groups: fact.support_groups,
    fact_time: fact.fact_time || null, reason: "" };
  const { content, subject, reporter, certainty, support_groups: groups, fact_time: factTime, reason } = values;
  const changeDraft = (patch: Partial<FactCorrectionValues>) => onDraftChange({ ...values, ...patch });
  const setFactTime = (value: FactTime | null) => changeDraft({ fact_time: value });
  const [checked, setChecked] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const proposal: FactProposal = { expected_revision: fact.revision, reason: reason.trim(), content: content.trim(),
    subject: subject.trim(), reporter: reporter.trim(), certainty: certainty as UpdateFact["certainty"],
    support_groups: groups, fact_time: factTime };
  const validDate = (date: string | null) => !date || (/^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date);
  const validProposal = () => {
    if (!reason.trim() || !checked) return false;
    if (mode === "delete") return true;
    if (!content.trim()) return false;
    if (!subject.trim() || !reporter.trim() || !certainty) return false;
    if (!groups.length || groups.length > 20 || groups.some(group => !group.length)) return false;
    if (groups.some(group => group.some(id => !messageIds.includes(id)))) return false;
    if (new Set(groups.map(group => JSON.stringify([...group].sort()))).size !== groups.length) return false;
    if (!factTime) return true;
    if (!validDate(factTime.start) || !validDate(factTime.end)) return false;
    if (!factTime.evidence.length || factTime.evidence.length > 20) return false;
    if (!factTime.evidence.every(item => messageIds.includes(item.message_id) && item.expression.trim())) return false;
    if (!groups.some(group => factTime.evidence.every(item => group.includes(item.message_id)))) return false;
    if (factTime.precision === "unknown") return !factTime.start && !factTime.end;
    if (!factTime.start || !factTime.end || factTime.start > factTime.end) return false;
    if (factTime.precision === "day") return factTime.start === factTime.end;
    if (factTime.precision === "year") return factTime.start.endsWith("-01-01") && factTime.end === `${factTime.start.slice(0, 4)}-12-31`;
    if (factTime.precision === "month") {
      const lastDay = new Date(`${factTime.start}T00:00:00Z`);
      lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
      return factTime.start.endsWith("-01") && factTime.end === lastDay.toISOString().slice(0, 10);
    }
    return true;
  };
  const inputClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";

  return <section aria-label={t(mode === "edit" ? "editFact" : "deleteFact")} className="space-y-4 border-t pt-4">
    <h4 className="font-medium">{t(mode === "edit" ? "editFact" : "deleteFact")}</h4>
    <p className="break-all text-xs">Fact {fact.fact_id} · Blob {fact.blob_id} · {t("factRevision", { revision: fact.revision })}</p>
    {submitted ? <p className="text-sm text-muted-foreground">{t("draftRetained")}</p> : null}
    {mode === "edit" ? <>
      <label className="block space-y-1 text-sm">{t("factContent")}<Textarea value={content} onChange={event => changeDraft({ content: event.target.value })} /></label>
      <label className="block space-y-1 text-sm">{t("subject")}<Input value={subject} onChange={event => changeDraft({ subject: event.target.value })} /></label>
      <label className="block space-y-1 text-sm">{t("reporter")}<Input value={reporter} onChange={event => changeDraft({ reporter: event.target.value })} /></label>
      <label className="block space-y-1 text-sm">{t("certainty")}<select className={inputClass} value={certainty} onChange={event => changeDraft({ certainty: event.target.value as UpdateFact["certainty"] })}>
        <option value="" disabled>{t("selectCertainty")}</option>
        {["asserted", "reported", "uncertain"].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t("support")}</legend>
        <p className="text-xs text-muted-foreground">{t("supportHelp")}</p>
        {groups.map((group, index) => <fieldset key={index} className="space-y-2">
          <legend className="text-xs font-medium">{t("supportGroup", { number: index + 1 })}{index ? " · OR" : ""}</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-2">
            {messageIds.map(id => <label key={id} className="flex min-w-0 items-center gap-2 break-all text-xs">
              <input type="checkbox" checked={group.includes(id)} onChange={event => changeDraft({ support_groups: groups.map((value, i) => i === index ? (event.target.checked ? [...value, id] : value.filter(item => item !== id)) : value) })} />{id}
            </label>)}
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => changeDraft({ support_groups: groups.filter((_, i) => i !== index) })}>{t("removeGroup")}</Button>
        </fieldset>)}
        <Button type="button" size="sm" variant="outline" onClick={() => changeDraft({ support_groups: [...groups, []] })}>{t("addGroup")}</Button>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t("factTime")}</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(factTime)} onChange={event => setFactTime(event.target.checked ? { start: null, end: null, precision: "unknown", evidence: [] } : null)} />{t("setFactTime")}</label>
        {factTime ? <>
          <p className="text-xs text-muted-foreground">{t("timeHelp")}</p>
          <label className="block space-y-1 text-sm">{t("precision")}<select className={inputClass} value={factTime.precision} onChange={event => {
            const precision = event.target.value as FactTime["precision"];
            setFactTime({ ...factTime, precision,
              start: precision === "unknown" ? null : factTime.start,
              end: precision === "unknown" ? null : precision === "day" ? factTime.start : factTime.end });
          }}>
            {["year", "month", "day", "range", "unknown"].map(value => <option key={value}>{value}</option>)}
          </select></label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-sm">{t("startDate")}<Input type="date" disabled={factTime.precision === "unknown"} value={factTime.start || ""} onChange={event => setFactTime({ ...factTime, start: event.target.value || null, end: factTime.precision === "day" ? event.target.value || null : factTime.end })} /></label>
            <label className="space-y-1 text-sm">{t("endDate")}<Input type="date" disabled={factTime.precision === "unknown" || factTime.precision === "day"} value={factTime.end || ""} onChange={event => setFactTime({ ...factTime, end: event.target.value || null })} /></label>
          </div>
          {factTime.evidence.map((item, index) => <div key={index} className="space-y-2">
            <label className="block space-y-1 text-sm">{t("timeMessage")}<select className={inputClass} value={item.message_id} onChange={event => setFactTime({ ...factTime, evidence: factTime.evidence.map((value, i) => i === index ? { ...value, message_id: event.target.value } : value) })}>
              <option value="">{t("selectMessage")}</option>{messageIds.map(id => <option key={id}>{id}</option>)}
            </select></label>
            <label className="block space-y-1 text-sm">{t("timeExpression")}<Input value={item.expression} onChange={event => setFactTime({ ...factTime, evidence: factTime.evidence.map((value, i) => i === index ? { ...value, expression: event.target.value } : value) })} /></label>
            <Button type="button" size="sm" variant="outline" onClick={() => setFactTime({ ...factTime, evidence: factTime.evidence.filter((_, i) => i !== index) })}>{t("removeTimeEvidence")}</Button>
          </div>)}
          <Button type="button" size="sm" variant="outline" onClick={() => setFactTime({ ...factTime, evidence: [...factTime.evidence, { message_id: "", expression: "" }] })}>{t("addTimeEvidence")}</Button>
        </> : null}
      </fieldset>
    </> : <p className="text-sm">{t("deleteFactScope")}</p>}
    <label className="block space-y-1 text-sm">{t("correctionReason")}<Textarea value={reason} onChange={event => changeDraft({ reason: event.target.value })} /></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />{t("callerVerified")}</label>
    {invalid ? <p role="alert" className="text-sm text-destructive">{t("invalidCorrection")}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} variant={mode === "delete" ? "destructive" : "default"} onClick={() => { const valid = validProposal(); setInvalid(!valid); if (valid) setConfirm(true); }}>{t("reviewCorrection")}</Button>
      <Button disabled={busy} variant="outline" onClick={onCancel}>{t("cancel")}</Button>
    </div>
    <AlertDialog open={confirm} onOpenChange={setConfirm}>
      <AlertDialogContent className="max-h-[85dvh] overflow-y-auto">
        <AlertDialogHeader><AlertDialogTitle>{t("confirmCorrection")}</AlertDialogTitle><AlertDialogDescription>{t("correctionConsequences")}</AlertDialogDescription></AlertDialogHeader>
        <p className="break-all text-xs">Fact {fact.fact_id} · {t("factRevision", { revision: fact.revision })}</p>
        <h4 className="font-medium">{t("before")}</h4><FactValues fact={fact} />
        <h4 className="font-medium">{t("after")}</h4>{mode === "edit" ? <FactValues fact={proposal} /> : <p>{t("deleteFactScope")}</p>}
        <p className="whitespace-pre-wrap break-words text-sm">{t("correctionReason")}: {reason}</p>
        <AlertDialogFooter><AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={() => onSubmit(mode === "edit" ? proposal : { reason: proposal.reason, expected_revision: proposal.expected_revision })}>{t(mode === "edit" ? "saveCorrection" : "deleteFact")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
