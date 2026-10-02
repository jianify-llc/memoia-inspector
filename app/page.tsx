"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { Project } from "@/types";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ApiKeys from "@/components/project/tabs/api-keys";
import Users from "@/components/project/tabs/users";
import Usage from "@/components/project/tabs/usage";
import Config from "@/components/project/tabs/config";
import Playground from "@/components/project/tabs/playground";
import ProjectAdmin from "@/components/project/tabs/project-admin";

import { getLocale } from "@/utils/memobase/client";

import { toast } from "sonner";
import { getConfig } from "@/api/models/memobase";

export default function ProjectPage() {
  const router = useRouter();
  const t = useTranslations("project");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [project, setProject] = useState<Project | null>(null);

  const fetchProject = useCallback(async () => {
    const res = await getLocale();
    if (res.length < 2) {
      router.push("/settings");
      throw new Error("Project credentials are missing");
    }

    const config = await getConfig();
    if (config.code !== 0) {
      throw new Error(config.message);
    }

    setProject({
      endpoint_url: res[0],
      endpoint_token: res[1],
      config_yaml: config.data || "",
    });
  }, [router]);

  const loadProject = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setProject(null);
    try {
      await fetchProject();
    } catch {
      setLoadError(true);
      toast.error(t("getProjectsFailed"));
    } finally {
      setLoading(false);
    }
  }, [fetchProject, t]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-[6dvh] w-full" />
          <Skeleton className="h-[4dvh] w-full" />
          <Skeleton className="h-[60dvh] w-full" />
        </div>
      ) : loadError || !project ? (
        <div className="flex flex-col items-start gap-3">
          <p>{t("getProjectsFailed")}</p>
          <Button onClick={() => void loadProject()}>{t("retry")}</Button>
        </div>
      ) : (
        <>
          <Tabs defaultValue="apiKeys" className="w-full">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="apiKeys">{t("tabs.apiKeys")}</TabsTrigger>
                <TabsTrigger value="users">{t("tabs.users")}</TabsTrigger>
                <TabsTrigger value="usage">{t("tabs.usage")}</TabsTrigger>
                <TabsTrigger value="config">{t("tabs.config")}</TabsTrigger>
                <TabsTrigger value="projectAdmin">{t("tabs.projectAdmin")}</TabsTrigger>
                <TabsTrigger value="playground">
                  {t("tabs.playground")}
                  <Badge
                    variant="secondary"
                    className="bg-blue-500 text-white dark:bg-blue-600"
                  >
                    {"New"}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="apiKeys">
              <ApiKeys project={project!} />
            </TabsContent>
            <TabsContent value="users">
              <Users project={project} />
            </TabsContent>
            <TabsContent value="usage">
              <Usage project={project} />
            </TabsContent>
            <TabsContent value="config">
              <Config project={project} onRefresh={() => fetchProject()} />
            </TabsContent>
            <TabsContent value="projectAdmin">
              <ProjectAdmin />
            </TabsContent>
            <TabsContent value="playground">
              <Playground project={project} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
