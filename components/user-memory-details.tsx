"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { UserEvent, UserProfile } from "@memobase/memobase";
import { getProjectUserMemories } from "@/api/models/memobase";
import { SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserMemory } from "@/components/user-memory";
import { UserProvenance } from "@/components/user-provenance";
import { hasUnconfirmedMutation, type ProvenanceMutation } from "@/lib/operation-recovery";

/** Detail reads refresh on open; operation state belongs to the project Users view. */
export function UserMemoryDetails({ userId, open, mutation, setMutation, onInvalidate, onResolved }: {
  userId: string;
  open: boolean;
  mutation: ProvenanceMutation;
  setMutation: Dispatch<SetStateAction<ProvenanceMutation>>;
  onInvalidate: (uid: string) => void;
  onResolved: (uid: string) => Promise<void>;
}) {
  const t = useTranslations("project.users");
  const provenanceText = useTranslations("provenance");
  const router = useRouter();
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [events, setEvents] = useState<UserEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const unresolved = hasUnconfirmedMutation(mutation);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setProfiles([]);
    setEvents([]);
    setLoading(true);
    setError(false);
    try {
      const response = await getProjectUserMemories(userId, controller.signal);
      if (controller.signal.aborted) return;
      if (response.code === 401) router.push("/login");
      if (response.code !== 0 || !response.data) { setError(true); return; }
      setProfiles(response.data.profiles);
      setEvents(response.data.events);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [userId, router]);

  useEffect(() => {
    if (!open || unresolved) return;
    void refresh();
    return () => { request.current?.abort(); };
  }, [refresh, open, unresolved, mutation.operation]);

  const invalidate = () => {
    request.current?.abort();
    setProfiles([]);
    setEvents([]);
    setLoading(false);
    setError(false);
    onInvalidate(userId);
  };

  const resolved = () => {
    void onResolved(userId);
  };

  return (
    <SheetContent side="right" className="p-0">
      <Tabs defaultValue="memories" className="h-full overflow-hidden pt-4">
        <TabsList className="mx-4">
          <TabsTrigger value="memories">{t("table.memories")}</TabsTrigger>
          <TabsTrigger value="provenance">{t("provenance")}</TabsTrigger>
        </TabsList>
        <TabsContent value="memories" className="min-h-0 flex-1 overflow-hidden">
          {unresolved ? <p role="status" className="p-4">{provenanceText("awaitConfirmation")}</p> : (
            <>
              {error ? <p role="alert" className="px-4">{t("getMemoriesFailed")}</p> : null}
              <UserMemory
                isLoading={loading}
                setIsLoading={setLoading}
                profiles={profiles}
                events={events}
                profilesFold
                onRefresh={async () => { await Promise.all([refresh(), onResolved(userId)]); }}
                canDownload={!loading && !error && Boolean(profiles.length || events.length)}
                downloadFileName={`memobase-${userId}.json`}
              />
            </>
          )}
        </TabsContent>
        <TabsContent value="provenance" className="min-h-0 flex-1 overflow-hidden">
          <UserProvenance userId={userId} mutation={mutation} setMutation={setMutation}
            onInvalidate={invalidate} onResolved={resolved} />
        </TabsContent>
      </Tabs>
    </SheetContent>
  );
}
