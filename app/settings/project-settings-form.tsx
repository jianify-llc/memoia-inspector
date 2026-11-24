"use client";

import { useState, FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

import { toast } from "sonner";
import { setLocale } from "@/utils/memoia/client";

export default function ProjectSettingsForm({ managed, hasWorker, defaultUrl }: {
  managed: boolean;
  hasWorker: boolean;
  defaultUrl?: string;
}) {
  const router = useRouter();
  const t = useTranslations("settings");
  const canChooseConnection = managed && hasWorker && Boolean(defaultUrl);
  const httpLabel = defaultUrl && `URL · ${new URL(defaultUrl).hostname}`;
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState(hasWorker ? "worker" : defaultUrl ?? "");
  const [key, setKey] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const endpoint = url.trim();
    if (!endpoint || !key.trim()) {
      toast.error(t("emptyContent"));
      return;
    }

    setLoading(true);
    try {
      await setLocale(endpoint, key);
      router.push("/");
    } catch {
      toast.error(t("errorMsg"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl rounded p-4 shadow sm:p-6">
      <h2 className="text-xl font-bold mb-2">{t("title")}</h2>
      <p className="mb-6 text-muted-foreground">{t(managed ? "keyDesc" : "desc")}</p>
      <div className="grid gap-6">
        {canChooseConnection ? (
          <fieldset className="min-w-0 space-y-2">
            <legend className="mb-2 text-sm font-medium">{t("connection")}</legend>
            <label className="flex min-h-10 items-center gap-3 rounded-md border border-input px-3 py-2 text-sm">
              <input type="radio" name="url" value="worker" checked={url === "worker"} onChange={(e) => setUrl(e.target.value)} />
              {t("worker")}
            </label>
            <label className="flex min-h-10 items-center gap-3 rounded-md border border-input px-3 py-2 text-sm">
              <input type="radio" name="url" value={defaultUrl} checked={url === defaultUrl} onChange={(e) => setUrl(e.target.value)} />
              <span className="min-w-0 break-all">{httpLabel}</span>
            </label>
          </fieldset>
        ) : managed ? (
          <div className="grid gap-2 text-sm">
            <span className="font-medium">{t("connection")}</span>
            <p id="memoia-connection" className="break-all text-muted-foreground">
              {hasWorker ? t("worker") : httpLabel ?? t("connectionUnavailable")}
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="url">URL</Label>
            <Input id="url" name="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="key">KEY</Label>
          <Input
            id="key"
            name="key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <Button type="submit" disabled={loading || !url.trim() || !key.trim()}>
          {loading ? t("saveing") : t("save")}
        </Button>
      </div>
    </form>
  );
}
