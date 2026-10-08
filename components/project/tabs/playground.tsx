"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";

import { Card, CardContent } from "@/components/ui/card";
import { AssistantSidebar } from "@/components/assistant-ui/assistant-sidebar";
import { Thread } from "@/components/assistant-ui/thread";
import { UserMemory } from "@/components/user-memory";

import { UserProfile, UserEvent } from "@/api/models/memobase";

import {
  getProfile,
  getEvent,
  getPlaygroundMaintenance,
  insertMessages,
  deleteUser,
  initializePlaygroundUser,
} from "@/api/models/memobase";

import { toast } from "sonner";

import { Project } from "@/types";
import type { MaintenanceStatus } from "@jianify/memoia";

export default function Playground({ project }: { project: Project }) {
  const t = useTranslations("project.playground");
  const [isLoading, setIsLoading] = useState(false);
  // 相同挂载的重复初始化共用身份；项目切换或显式新用户才分配新 ID。
  const initializationIdentity = useRef({ projectId: project.endpoint_url, id: crypto.randomUUID() });
  if (initializationIdentity.current.projectId !== project.endpoint_url) {
    initializationIdentity.current = { projectId: project.endpoint_url, id: crypto.randomUUID() };
  }
  const lastUserMessageRef = useRef<string>("");
  const lastUserRecordedAt = useRef<string>("");
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [events, setEvents] = useState<UserEvent[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceStatus | null>(null);
  const [playgroundAvailable, setPlaygroundAvailable] = useState<boolean | null>(null);
  const chatApi = `${process.env["NEXT_PUBLIC_BASE_PATH"] || ""}/api/chat`;

  const runtime = useChatRuntime({
    api: chatApi,
    onResponse: (response) => {
      if (response.status !== 200) {
        return;
      }

      const message = response.headers.get("x-last-user-message") || "";
      lastUserMessageRef.current = decodeURIComponent(message);
      lastUserRecordedAt.current = response.headers.get("x-last-user-recorded-at") || "";
    },
    onFinish: async (message) => {
      if (!message.content || message.content.length === 0) {
        return;
      }

      const lastContent = message.content[message.content.length - 1];
      if (lastContent.type === "text") {
        try {
          const res = await insertMessages([
            {
              role: "user",
              content: lastUserMessageRef.current,
              created_at: lastUserRecordedAt.current,
            },
            {
              role: "assistant",
              content: lastContent.text,
              created_at: message.createdAt.toISOString(),
            },
          ], message.id);
          if (res.code !== 0) {
            toast.error(res.message || t("insertRecordsFailed"));
            return;
          }

          await refreshMemories();
        } catch {
          toast.error(t("insertRecordsFailed"));
        }
      }
    },
  });

  const fetchProfile = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getProfile();
      if (res.code === 401) {
        return;
      }
      if (res.code === 0) {
        setProfiles(res.data || []);
      } else {
        toast.error(res.message || t("getRecordsFailed"));
      }
    } catch {
      toast.error(t("getRecordsFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const fetchEvent = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await getEvent();
      if (res.code === 401) {
        return;
      }
      if (res.code === 0) {
        setEvents(res.data || []);
      } else {
        toast.error(res.message || t("getRecordsFailed"));
      }
    } catch {
      toast.error(t("getRecordsFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const refreshMemories = useCallback(async () => {
    // Fact 回执后只刷新派生状态；维护失败不重新提交消息。
    await Promise.all([fetchProfile(), fetchEvent()]);
    try {
      const result = await getPlaygroundMaintenance();
      if (result.code !== 0 || !result.data) {
        setMaintenance(null);
        toast.error(result.message || t("getRecordsFailed"));
        return;
      }
      setMaintenance(result.data);
    } catch {
      setMaintenance(null);
      toast.error(t("getRecordsFailed"));
    }
  }, [fetchProfile, fetchEvent, t]);

  useEffect(() => {
    let active = true;
    fetch(chatApi, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return false;
        const data: { enabled?: boolean } = await response.json();
        return data.enabled === true;
      })
      .catch(() => false)
      .then((enabled) => {
        if (active) setPlaygroundAvailable(enabled);
      });
    return () => { active = false; };
  }, [chatApi]);

  useEffect(() => {
    if (!project || !playgroundAvailable) return;
    const init = async () => {
      const result = await initializePlaygroundUser(initializationIdentity.current.id);
      if (result.code !== 0) {
        toast.error(result.message === "OUTCOME_UNKNOWN" ? t("getRecordsFailed") : result.message || t("getRecordsFailed"));
        return;
      }
      await refreshMemories();
    };
    init().catch(() => toast.error(t("getRecordsFailed")));
  }, [refreshMemories, playgroundAvailable, project, t]);

  if (playgroundAvailable !== true) {
    return (
      <Card>
        <CardContent role="status">
          {playgroundAvailable === null ? t("checking") : t("notConfigured")}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="py-0 overflow-hidden">
      <CardContent className="px-0 space-y-4">
        <AssistantRuntimeProvider runtime={runtime}>
          <AssistantSidebar threadSlot={<Thread />}>
            <UserMemory
              isLoading={isLoading}
              setIsLoading={setIsLoading}
              events={events}
              profiles={profiles}
              maintenance={maintenance}
              onRefresh={async () => {
                await refreshMemories();
              }}
              onNewUser={async () => {
                const result = await deleteUser();
                if (result.code !== 0) {
                  toast.error(result.message || t("getRecordsFailed"));
                  return;
                }
                setProfiles([]);
                setEvents([]);
                setMaintenance(null);
                initializationIdentity.current = { projectId: project.endpoint_url, id: crypto.randomUUID() };
                const initialized = await initializePlaygroundUser(initializationIdentity.current.id);
                if (initialized.code !== 0) {
                  toast.error(initialized.message || t("getRecordsFailed"));
                  return;
                }
                await refreshMemories();
              }}
              canAdd
              canEdit
              canDelete
            />
          </AssistantSidebar>
        </AssistantRuntimeProvider>
      </CardContent>
    </Card>
  );
}
