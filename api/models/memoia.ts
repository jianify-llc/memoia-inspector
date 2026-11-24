import type { DeleteFact, History, MaintenanceStatus, Operation, Operations, Profiles, Source, Sources, SourceQuery, UpdateFact } from "@jianify/memoia";
import service, { type Res } from "@/api/http";
import { scopeHeaders, type UserMemoryScope } from "@/api/models/memobase";

export type UserProvenanceData = {
  sources: Sources["sources"];
  profiles: Profiles["profiles"];
  history: History["entries"];
  operations: Operations["operations"];
  maintenance: MaintenanceStatus;
};

const userPath = (uid: string) => `/api/memoia/user/${encodeURIComponent(uid)}`;
export const PROVENANCE_PAGE_SIZE = 20;
export const getUserProvenance = (scope: UserMemoryScope, signal?: AbortSignal, page = 0): Promise<Res<UserProvenanceData>> => service.get(`${userPath(scope.userId)}/provenance`, { limit: PROVENANCE_PAGE_SIZE, offset: page * PROVENANCE_PAGE_SIZE }, scopeHeaders(scope), signal);
export const getSource = (scope: UserMemoryScope, sourceId: string, page: SourceQuery = {}): Promise<Res<Source>> =>
  service.get(`${userPath(scope.userId)}/sources/${encodeURIComponent(sourceId)}`, { limit: PROVENANCE_PAGE_SIZE, ...page }, scopeHeaders(scope));
export const deleteSourceMessages = (scope: UserMemoryScope, sourceId: string, messageIds: string[], key: string): Promise<Res<Operation>> =>
  service.post(`${userPath(scope.userId)}/sources/${encodeURIComponent(sourceId)}/messages/delete`, { idempotency_key: key, message_ids: messageIds }, scopeHeaders(scope));
export const getOperation = (scope: UserMemoryScope, key: string | null, operationId?: string): Promise<Res<Operation>> =>
  service.get(`${userPath(scope.userId)}/operations`, key ? { key } : { operation_id: operationId }, scopeHeaders(scope));
export const retryOperation = (scope: UserMemoryScope, operationId: string): Promise<Res<Operation>> => service.post(`${userPath(scope.userId)}/operations`, { operation_id: operationId }, scopeHeaders(scope));
export const sealStagedAppend = (scope: UserMemoryScope, operationId: string): Promise<Res<Operation>> => service.post(`${userPath(scope.userId)}/operations`, { seal_append: operationId }, scopeHeaders(scope));
export const updateFact = (scope: UserMemoryScope, factId: string, input: UpdateFact): Promise<Res<Operation>> =>
  service.put(`${userPath(scope.userId)}/facts/${encodeURIComponent(factId)}`, input, scopeHeaders(scope));
export const deleteFact = (scope: UserMemoryScope, factId: string, input: DeleteFact): Promise<Res<Operation>> =>
  service.post(`${userPath(scope.userId)}/facts/${encodeURIComponent(factId)}/delete`, input, scopeHeaders(scope));
