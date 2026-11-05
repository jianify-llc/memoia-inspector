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
    <form onSubmit={handleSubmit} className="p-6 rounded shadow">
      <h2 className="text-xl font-bold mb-2">{t("title")}</h2>
      <p className="mb-6 text-gray-600">{t(managed ? "managedDesc" : "desc")}</p>
      <div className="grid gap-4">
        <div className="grid gap-3">
          <Label htmlFor="url">{managed ? t("connection") : "URL"}</Label>
          {managed ? (
            <select
              id="url"
              name="url"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            >
              {hasWorker && <option value="worker">{t("worker")}</option>}
              {defaultUrl && <option value={defaultUrl}>URL · {new URL(defaultUrl).hostname}</option>}
            </select>
          ) : (
            <Input id="url" name="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          )}
        </div>
        <div className="grid gap-3">
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
