"use client";

import { useState, FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

import { toast } from "sonner";
import { setLocale } from "@/utils/memoia/client";

export default function ProjectSettingsForm({ boundOrigin }: { boundOrigin?: string }) {
  const router = useRouter();
  const t = useTranslations("settings");
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const endpoint = boundOrigin ?? url.trim();
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
      <p className="mb-6 text-gray-600">{t(boundOrigin ? "managedDesc" : "desc")}</p>
      <div className="grid gap-4">
        <div className="grid gap-3">
          <Label htmlFor="url">URL</Label>
          <Input
            id="url"
            name="url"
            value={boundOrigin ?? url}
            readOnly={Boolean(boundOrigin)}
            onChange={(e) => setUrl(e.target.value)}
          />
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
        <Button type="submit" disabled={loading || !(boundOrigin ?? url).trim() || !key.trim()}>
          {loading ? t("saveing") : t("save")}
        </Button>
      </div>
    </form>
  );
}
