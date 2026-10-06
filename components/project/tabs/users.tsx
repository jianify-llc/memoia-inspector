"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { UserMemoryDetails } from "@/components/user-memory-details";
import type { ProvenanceMutation } from "@/lib/operation-recovery";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { JsonDownload } from "@/components/json-download";

import { ProjectUser } from "@/api/models/memobase";
import { ProjectUsersOrderBy } from "@/types";
import { deleteUserByUid, getProjectUserMemories } from "@/api/models/memobase";
import { getProjectUsers } from "@/api/models/memobase";

import { ArrowDown01, ArrowDown10, ArrowDownUp } from "lucide-react";

import { toast } from "sonner";

import { Project } from "@/types";

const EMPTY_MUTATION: ProvenanceMutation = { pendingKey: null, operation: null, busy: false };

export default function Users({ project }: { project: Project }) {
  const t = useTranslations("project.users");
  const router = useRouter();
  const [users, setUsers] = useState<ProjectUser[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [orderBy, setOrderBy] = useState<ProjectUsersOrderBy>("updated_at");
  const [orderDesc, setOrderDesc] = useState(true);
  const [limit] = useState(10);
  const [page, setPage] = useState(1);

  const [open, setOpen] = useState(false);
  const [memoriesUserId, setMemoriesUserId] = useState<string | null>(null);
  const [downloadingUserId, setDownloadingUserId] = useState<string | null>(null);
  const [invalidUserIds, setInvalidUserIds] = useState<string[]>([]);
  const [mutations, setMutations] = useState<Record<string, ProvenanceMutation>>({});
  const usersRequest = useRef<AbortController | null>(null);
  const downloads = useRef(new Map<AbortController, string>());
  const mounted = useRef(true);
  const currentProject = useRef(project);
  currentProject.current = project;

  const [selectedUser, setSelectedUser] = useState<ProjectUser | null>(null);

  const handleDelete = async (uid: string) => {
    setLoading(true);
    try {
      const res = await deleteUserByUid(uid);
      if (res.code === 0) {
        toast.success(t("deleteSuccess"));
        await fetchUsers();
      } else {
        toast.error(res.message || t("deleteFailed"));
      }
    } catch {
      toast.error(t("deleteFailed"));
    } finally {
      setLoading(false);
      setSelectedUser(null);
    }
  };

  const fetchUsers = useCallback(async () => {
    if (!mounted.current || currentProject.current.endpoint_url !== project.endpoint_url ||
      currentProject.current.endpoint_token !== project.endpoint_token) return false;
    usersRequest.current?.abort();
    const controller = new AbortController();
    usersRequest.current = controller;
    try {
      const res = await getProjectUsers(
        "",
        debouncedSearch,
        orderBy,
        orderDesc,
        limit,
        limit * (page - 1),
        controller.signal
      );
      if (controller.signal.aborted) return false;
      if (res.code === 401) {
        router.push("/login");
      }
      if (res.code === 0 && res.data) {
        setUsers(res.data.users);
        setCount(res.data.count);
        return true;
      } else {
        toast.error(res.message || t("getUsersFailed"));
      }
    } catch {
      if (!controller.signal.aborted) toast.error(t("getUsersFailed"));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
    return false;
  }, [limit, orderBy, orderDesc, page, router, debouncedSearch, t, project.endpoint_url, project.endpoint_token]);

  const downloadMemories = async (uid: string) => {
    if (invalidUserIds.includes(uid)) return;
    const controller = new AbortController();
    downloads.current.set(controller, uid);
    setDownloadingUserId(uid);
    try {
      const res = await getProjectUserMemories(uid, controller.signal);
      if (controller.signal.aborted) return;
      if (res.code === 401) {
        router.push("/login");
      }
      if (res.code === 0 && res.data) {
        return {
          profiles: res.data.profiles,
          events: res.data.events,
        };
      } else {
        toast.error(res.message || t("getMemoriesFailed"));
      }
    } catch {
      if (!controller.signal.aborted) toast.error(t("getMemoriesFailed"));
    } finally {
      downloads.current.delete(controller);
      if (!controller.signal.aborted) setDownloadingUserId(null);
    }
  };

  const invalidateMemories = (uid: string) => {
    usersRequest.current?.abort();
    for (const [request, targetUserId] of downloads.current) {
      if (targetUserId === uid) request.abort();
    }
    setDownloadingUserId((value) => value === uid ? null : value);
    setLoading(false);
    setInvalidUserIds((values) => values.includes(uid) ? values : [...values, uid]);
  };

  const refreshAfterMutation = async (uid: string) => {
    if (await fetchUsers()) setInvalidUserIds((values) => values.filter((value) => value !== uid));
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!project) return;
    setLoading(true);
    void fetchUsers();
    return () => usersRequest.current?.abort();
  }, [fetchUsers, project]);

  useEffect(() => {
    const activeDownloads = downloads.current;
    setOpen(false);
    setMemoriesUserId(null);
    setInvalidUserIds([]);
    setMutations({});
    setUsers([]);
    setCount(0);
    return () => { for (const request of activeDownloads.keys()) request.abort(); };
  }, [project.endpoint_url, project.endpoint_token]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);

    return () => clearTimeout(timer);
  }, [search]);

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetHeader className="hidden">
          <SheetTitle>Assistant</SheetTitle>
          <SheetDescription>Assistant</SheetDescription>
        </SheetHeader>

        {memoriesUserId ? <UserMemoryDetails key={memoriesUserId} userId={memoriesUserId} open={open}
          mutation={mutations[memoriesUserId] || EMPTY_MUTATION}
          setMutation={(update) => {
            if (!mounted.current || currentProject.current.endpoint_url !== project.endpoint_url ||
              currentProject.current.endpoint_token !== project.endpoint_token) return;
            setMutations((values) => ({ ...values, [memoriesUserId]: typeof update === "function" ?
              update(values[memoriesUserId] || EMPTY_MUTATION) : update }));
          }}
          onInvalidate={invalidateMemories} onResolved={refreshAfterMutation} /> : null}
      </Sheet>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex w-full max-w-xl items-center space-x-2">
            <Input
              value={search}
              placeholder={t("placeholder")}
              onChange={(e) => setSearch(e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setPage(1);
                }
              }}
            />
            <Button
              type="submit"
              onClick={() => {
                setPage(1);
              }}
            >
              {t("search")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOrderBy("updated_at");
                setOrderDesc(true);
                setPage(1);
              }}
            >
              {t("reset")}
            </Button>
          </div>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-[60dvh] w-full" />
              <Skeleton className="h-[4dvh] w-1/2 m-auto" />
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("table.id")}</TableHead>
                    <TableHead>
                      <Button
                        variant="ghost"
                        className="group/item"
                        onClick={() => {
                          setOrderBy("profile_count");
                          setOrderDesc(!orderDesc);
                          setPage(1);
                        }}
                      >
                        {t("table.profileCount")}
                        {orderBy === "profile_count" ? (
                          <>
                            {orderDesc ? (
                              <ArrowDown10 className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ArrowDown01 className="h-4 w-4 text-muted-foreground" />
                            )}
                          </>
                        ) : (
                          <ArrowDownUp className="h-4 w-4 text-muted-foreground/30 group-hover/item:text-muted-foreground" />
                        )}
                      </Button>
                    </TableHead>
                    <TableHead>
                      <Button
                        variant="ghost"
                        className="group/item"
                        onClick={() => {
                          setOrderBy("event_count");
                          setOrderDesc(!orderDesc);
                          setPage(1);
                        }}
                      >
                        {t("table.eventCount")}
                        {orderBy === "event_count" ? (
                          <>
                            {orderDesc ? (
                              <ArrowDown10 className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ArrowDown01 className="h-4 w-4 text-muted-foreground" />
                            )}
                          </>
                        ) : (
                          <ArrowDownUp className="h-4 w-4 text-muted-foreground/30 group-hover/item:text-muted-foreground" />
                        )}
                      </Button>
                    </TableHead>
                    <TableHead>{t("table.createdAt")}</TableHead>
                    <TableHead>{t("table.updatedAt")}</TableHead>
                    <TableHead>{t("table.action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>{user.id}</TableCell>
                      <TableCell className="pl-5">
                        {invalidUserIds.includes(user.id) ? "—" : user.profile_count.toLocaleString()}
                      </TableCell>
                      <TableCell className="pl-5">
                        {invalidUserIds.includes(user.id) ? "—" : user.event_count.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {new Date(user.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {new Date(user.updated_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setMemoriesUserId(user.id);
                            setOpen(true);
                          }}
                        >
                          {t("table.memories")}
                        </Button>
                        <JsonDownload
                          fileName={`memobase-${user.id}.json`}
                          disabled={invalidUserIds.includes(user.id) || downloadingUserId === user.id}
                          beforeEvent={() => downloadMemories(user.id)}
                          trigger={
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                (!user.profile_count && !user.event_count) ||
                                invalidUserIds.includes(user.id) || downloadingUserId === user.id
                              }
                            >
                              {downloadingUserId === user.id
                                ? t("table.downloading")
                                : t("table.download")}
                            </Button>
                          }
                        />
                        <AlertDialog
                          open={selectedUser?.id === user.id}
                          onOpenChange={(open) =>
                            !open && setSelectedUser(null)
                          }
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setSelectedUser(user)}
                            >
                              {t("delete")}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t("deleteConfirmTitle")}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("deleteConfirmDescription")}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel
                                onClick={() => setSelectedUser(null)}
                              >
                                {t("cancel")}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(user.id)}
                              >
                                {t("confirm")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationLink className="w-20 text-sm text-muted-foreground">
                      {t("table.count", { count })}
                    </PaginationLink>
                  </PaginationItem>
                  {page > 1 && (
                    <>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => {
                            setPage(page - 1);
                          }}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationLink
                          onClick={() => {
                            setPage(page - 1);
                          }}
                        >
                          {page - 1}
                        </PaginationLink>
                      </PaginationItem>
                    </>
                  )}
                  <PaginationItem>
                    <PaginationLink isActive>{page}</PaginationLink>
                  </PaginationItem>
                  {page < Math.ceil(count / limit) && (
                    <>
                      <PaginationItem>
                        <PaginationLink
                          onClick={() => {
                            setPage(page + 1);
                          }}
                        >
                          {page + 1}
                        </PaginationLink>
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext
                          onClick={() => {
                            setPage(page + 1);
                          }}
                        />
                      </PaginationItem>
                    </>
                  )}
                </PaginationContent>
              </Pagination>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
