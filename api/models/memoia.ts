import type { History, Operation, Operations, Profiles, Source, Sources, SourceQuery } from "@jianify/memoia";
import service, { type Res } from "@/api/http";

export type UserProvenanceData = {
  sources: Sources["sources"];
  profiles: Profiles["profiles"];
  history: History["entries"];
  operations: Operations["operations"];
};

const userPath = (uid: string) => `/api/memoia/user/${encodeURIComponent(uid)}`;
export const PROVENANCE_PAGE_SIZE = 20;
export const getUserProvenance = (uid: string, signal?: AbortSignal, page = 0): Promise<Res<UserProvenanceData>> => service.get(`${userPath(uid)}/provenance`, { limit: PROVENANCE_PAGE_SIZE, offset: page * PROVENANCE_PAGE_SIZE }, undefined, signal);
export const getSource = (uid: string, sourceId: string, page: SourceQuery = {}): Promise<Res<Source>> =>
  service.get(`${userPath(uid)}/sources/${encodeURIComponent(sourceId)}`, { limit: PROVENANCE_PAGE_SIZE, ...page });
export const deleteSourceMessages = (uid: string, sourceId: string, messageIds: string[], key: string): Promise<Res<Operation>> =>
  service.post(`${userPath(uid)}/sources/${encodeURIComponent(sourceId)}/messages/delete`, { idempotency_key: key, message_ids: messageIds });
export const getOperation = (uid: string, key: string | null, operationId?: string): Promise<Res<Operation>> =>
  service.get(`${userPath(uid)}/operations`, key ? { key } : { operation_id: operationId });
export const retryOperation = (uid: string, operationId: string): Promise<Res<Operation>> => service.post(`${userPath(uid)}/operations`, { operation_id: operationId });
