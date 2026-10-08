import service, { Res } from "../http";
import type { Profiles, Events, Users, Usage, MaintenanceStatus, Operation } from "@jianify/memoia";
import { z } from "zod";
export type UserProfile = Profiles["profiles"][number];
export type UserEvent = Events["events"][number];
export type GetProjectUsersResponse = Users;
export type ProjectUser = Users["users"][number];
export type GetProjectUsageItemResponse = Usage["usages"][number];
// 这是编辑表单的规则，HTTP 对象由 SDK 的生成校验器负责。
export const ProfileEditor = z.object({ id: z.string(), content: z.string().min(1), topic: z.string().min(1), sub_topic: z.string().min(1) });

export const getProfile = (): Promise<Res<UserProfile[]>> =>
  service.get("/api/memobase/profile");

export const insertMessages = (
  messages: {
    role: "user" | "assistant";
    content: string;
    alias?: string | undefined;
    created_at: string;
  }[], idempotencyKey: string
): Promise<Res<Operation>> =>
  service.post("/api/memobase/insert", {
    idempotency_key: idempotencyKey,
    messages,
  });

export const getEvent = (): Promise<Res<UserEvent[]>> =>
  service.get("/api/memobase/event");

export const getPlaygroundMaintenance = (): Promise<Res<MaintenanceStatus>> =>
  service.get("/api/memobase/maintenance");

export const addProfile = (content: string, topic: string, subTopic: string): Promise<Res<null>> =>
  service.post("/api/memobase/profile", {
    content,
    topic,
    sub_topic: subTopic,
  });

export const deleteProfile = (id: string): Promise<Res<null>> =>
  service.delete(`/api/memobase/profile/${id}`);

export const updateProfile = (id: string, content: string, topic: string, subTopic: string): Promise<Res<null>> =>
  service.put(`/api/memobase/profile/${id}`, {
    content,
    topic,
    sub_topic: subTopic,
  });

/** 顺序回执保证供应商写入之前浏览器已有稳定用户 Cookie。 */
export const initializePlaygroundUser = async (id: string): Promise<Res<{ id: string }>> => {
  const prepared = await service.post<Res<{ id: string }>>("/api/memobase/user", { action: "prepare", id });
  if (prepared.code !== 0) return prepared;
  if (!prepared.data) return { code: 502, data: null, message: "INVALID_RESPONSE" };
  return service.post("/api/memobase/user", { action: "initialize", id: prepared.data.id });
};

export const deleteUser = (): Promise<Res<null>> =>
  service.delete(`/api/memobase/user`);

export const deleteUserByUid = (uid: string): Promise<Res<null>> =>
  service.delete(`/api/memobase/user/${uid}`);

export const getProjectUsers = (pid: string, search: string, order_by: string, order_desc: boolean, limit: number, offset: number, signal?: AbortSignal) => {
  return service.get<Res<GetProjectUsersResponse>>(`/api/memobase/user`, { search, order_by, order_desc, limit, offset }, undefined, signal);
}

export const getProjectUsage = (last_days: number = 7) => {
  return service.get<Res<{ usages: GetProjectUsageItemResponse[] }>>(`/api/memobase/usage?last_days=${last_days}`);
};

export const deleteEvent = (id: string): Promise<Res<null>> =>
  service.delete(`/api/memobase/event/${id}`);

export const getConfig = (): Promise<Res<string>> =>
  service.get("/api/memobase/config");

export const updateConfig = (config: string): Promise<Res<null>> =>
  service.put("/api/memobase/config", {
    config,
  });

export const getProjectUserMemories = (uid: string, signal?: AbortSignal) => {
  return service.get<Res<{ profiles: UserProfile[], events: UserEvent[], maintenance: MaintenanceStatus }>>(`/api/memobase/user/${uid}/memories`, undefined, undefined, signal);
}
