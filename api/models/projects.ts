import type { IssuedKey, KeyCreate, Keys, ManagedProject, Projects, ProjectUpdate } from "@jianify/memoia";
import service, { type Res } from "@/api/http";

const path = (project: string) => `/api/memoia/projects/${encodeURIComponent(project)}`;
export const ADMIN_PAGE_SIZE = 20;
export const listProjects = (page: number, signal?: AbortSignal): Promise<Res<Projects>> => service.get("/api/memoia/projects", { limit: ADMIN_PAGE_SIZE, offset: page * ADMIN_PAGE_SIZE }, undefined, signal);
export const createProject = (projectId: string): Promise<Res<ManagedProject>> => service.post("/api/memoia/projects", { project_id: projectId });
export const updateProject = (project: string, input: ProjectUpdate): Promise<Res<ManagedProject>> => service.patch(path(project), input);
export const listKeys = (project: string, page: number, signal?: AbortSignal): Promise<Res<Keys>> => service.get(`${path(project)}/keys`, { limit: ADMIN_PAGE_SIZE, offset: page * ADMIN_PAGE_SIZE }, undefined, signal);
export const createKey = (project: string, input: KeyCreate): Promise<Res<IssuedKey>> => service.post(`${path(project)}/keys`, input);
export const revokeKey = (project: string, keyId: string): Promise<Res<null>> => service.delete(`${path(project)}/keys/${encodeURIComponent(keyId)}`);
