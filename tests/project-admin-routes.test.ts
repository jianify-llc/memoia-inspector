import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoiaError } from "@jianify/memoia";

const sdk = vi.hoisted(() => ({ listProjects: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), listKeys: vi.fn(), createKey: vi.fn(), revokeKey: vi.fn() }));
const factory = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/utils/memoia/client", () => ({ memoiaClient: factory.client }));
import { GET as projects, POST as createProject } from "@/app/api/memoia/projects/route";
import { PATCH as updateProject } from "@/app/api/memoia/projects/[project_id]/route";
import { GET as keys, POST as issueKey } from "@/app/api/memoia/projects/[project_id]/keys/route";
import { DELETE as revokeKey } from "@/app/api/memoia/projects/[project_id]/keys/[key_id]/route";
const params = { params: Promise.resolve({ project_id: "luvel-test", key_id: "key-id" }) };
const post = (body: unknown) => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); factory.client.mockResolvedValue(sdk); });

describe("project and scoped-key management", () => {
  it("requires project credentials before any administrative operation", async () => {
    factory.client.mockResolvedValue(null);
    expect((await projects(new Request("http://localhost"))).status).toBe(401);
    expect((await issueKey(post({}), params)).status).toBe(401);
    expect((await revokeKey(new Request("http://localhost"), params)).status).toBe(401);
    expect(sdk.createKey).not.toHaveBeenCalled();
  });
  it("rejects sibling-origin Cookie-backed writes before invoking the SDK", async () => {
    const request = new Request("https://inspector.example/api", { method: "POST", headers: { origin: "https://other.example" }, body: "{}" });
    expect((await createProject(request)).status).toBe(403);
    expect(sdk.createProject).not.toHaveBeenCalled();
  });
  it("reads paginated projects and keys without mixing their scope", async () => {
    sdk.listProjects.mockResolvedValue({ projects: [] }); sdk.listKeys.mockResolvedValue({ keys: [] });
    await projects(new Request("http://localhost?limit=20&offset=40"));
    await keys(new Request("http://localhost?limit=20&offset=60"), params);
    expect(sdk.listProjects).toHaveBeenCalledWith({ limit: 20, offset: 40 });
    expect(sdk.listKeys).toHaveBeenCalledWith("luvel-test", { limit: 20, offset: 60 });
  });
  it("returns an issued token only from a successful creation response", async () => {
    const issued = { key_id: "key-id", name: "Luvel", scopes: ["read", "write"], token: "one-time-test-token" };
    sdk.createKey.mockResolvedValue(issued);
    const response = await issueKey(post({ name: "Luvel", scopes: ["read", "write"] }), params);
    expect(response.status).toBe(201); expect((await response.json()).data).toEqual(issued);
    expect(sdk.createKey).toHaveBeenCalledWith("luvel-test", { name: "Luvel", scopes: ["read", "write"] });
  });
  it("does not report denied creation, suspension or revocation as success", async () => {
    const denied = new MemoiaError("HTTP_ERROR", 403, false);
    sdk.createProject.mockRejectedValue(denied); sdk.updateProject.mockRejectedValue(denied); sdk.revokeKey.mockRejectedValue(denied);
    for (const response of [await createProject(post({ project_id: "test" })), await updateProject(post({ status: "suspended" }), params), await revokeKey(new Request("http://localhost"), params)]) {
      expect(response.status).toBe(403); expect((await response.json()).data).toBeNull();
    }
  });
  it("preserves unknown outcomes and returns success only after actual bodyless revocation", async () => {
    sdk.createKey.mockRejectedValue(new MemoiaError("TRANSPORT_ERROR", null, false, "unknown"));
    expect((await (await issueKey(post({}), params)).json()).message).toBe("OUTCOME_UNKNOWN");
    sdk.revokeKey.mockResolvedValue(undefined);
    const response = await revokeKey(new Request("http://localhost"), params);
    expect(response.status).toBe(200); expect((await response.json()).code).toBe(0);
  });
});
