import { readProject as getProjectContext, clearProject as clearLocale, saveProject as setLocale } from "@/utils/memoia/project-actions";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cookies, headers } from "next/headers";
import { GET as getUsage } from "@/app/api/memobase/usage/route";
import { GET as getUsers, POST } from "@/app/api/memobase/user/route";
import { GET as getUserMemories, POST as manageUserMemory } from "@/app/api/memobase/user/[uid]/memories/route";
import { DELETE as forgetProjectUser } from "@/app/api/memobase/user/[uid]/route";
import { POST as deleteSourceMessages } from "@/app/api/memoia/user/[uid]/sources/[source_id]/messages/delete/route";
import { memoiaClient, getMemoiaUser, prepareMemoiaUser, initializeMemoiaUser } from "@/utils/memoia/client";

import { projectCredentials } from "@/utils/memoia/project-credentials";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));

const values = new Map<string, string>();
const setCookie = vi.fn((name: string, value: string) => { values.set(name, value); });
const cookieStore = {
  get: (name: string) => values.has(name) ? { value: values.get(name) } : undefined,
  set: setCookie,
  delete: (name: string) => { values.delete(name); },
};

beforeEach(() => {
  values.clear();
  setCookie.mockClear();
  vi.mocked(getCloudflareContext).mockReset();
  vi.mocked(cookies).mockResolvedValue(cookieStore as never);
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("selected project and user memory", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const params = { params: Promise.resolve({ uid: userId }) };
  const request = (method: "GET" | "POST", endpoint = "https://one.example", project = "project-a") =>
    new Request("https://inspector.example/api/memobase/user/example/memories", {
      method, headers: { origin: "https://inspector.example", "content-type": "application/json", "x-memoia-endpoint": endpoint, "x-memoia-project": project },
      ...(method === "POST" ? { body: JSON.stringify({ action: "addProfile", content: "value", topic: "t", sub_topic: "s" }) } : {}),
    });

  it("rejects a changed endpoint before calling another Memoia instance", async () => {
    values.set("MEMOBASE_INSPECTOR_LOCALE", "https://two.example|fixture");
    const transport = vi.fn(); vi.stubGlobal("fetch", transport);
    expect((await getUserMemories(request("GET"), params)).status).toBe(409);
    expect((await manageUserMemory(request("POST"), params)).status).toBe(409);
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects another project with the same user id before reading or writing", async () => {
    values.set("MEMOBASE_INSPECTOR_LOCALE", "https://one.example|fixture");
    const transport = vi.fn().mockImplementation(async () => Response.json({ project_id: "project-b" })); vi.stubGlobal("fetch", transport);
    expect((await getUserMemories(request("GET"), params)).status).toBe(409);
    expect((await manageUserMemory(request("POST"), params)).status).toBe(409);
    expect((await getUsers(request("GET"))).status).toBe(409);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  });

  it("uses the selected user after confirming the project", async () => {
    values.set("MEMOBASE_INSPECTOR_LOCALE", "https://one.example|fixture");
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ project_id: "project-a" }))
      .mockResolvedValueOnce(Response.json({ id: "22222222-2222-4222-8222-222222222222" }, { status: 201 }));
    vi.stubGlobal("fetch", transport);
    expect((await manageUserMemory(request("POST"), params)).status).toBe(200);
    expect(String(transport.mock.calls[1][0])).toContain(`/api/users/${userId}/profiles`);
    expect(transport.mock.calls[1][1].method).toBe("POST");
  });

  it("prevents user and source deletion after another tab switches the project", async () => {
    values.set("MEMOBASE_INSPECTOR_LOCALE", "https://one.example|fixture");
    const transport = vi.fn().mockImplementation(async () => Response.json({ project_id: "project-b" })); vi.stubGlobal("fetch", transport);
    const headers = { origin: "https://inspector.example", "content-type": "application/json", "x-memoia-endpoint": "https://one.example", "x-memoia-project": "project-a" };
    const user = new Request("https://inspector.example/api/memobase/user/u", { method: "DELETE", headers });
    const messages = new Request("https://inspector.example/api/memoia/user/u/sources/s/messages/delete", { method: "POST", headers, body: JSON.stringify({ message_ids: ["m"], idempotency_key: "key" }) });
    expect((await forgetProjectUser(user, params)).status).toBe(409);
    expect((await deleteSourceMessages(messages, { params: Promise.resolve({ uid: userId, source_id: "s" }) })).status).toBe(409);
    expect(transport.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("project and playground cookie ownership", () => {
  it("clears the old user when switching projects", async () => {
    values.set("MEMOBASE_INSPECTOR_LOCALE", "https://one.example|token-one");
    values.set("MEMOBASE_INSPECTOR_USER", "old-user");
    await setLocale("https://two.example", "token-two");
    expect(values.get("MEMOBASE_INSPECTOR_LOCALE")).toBe("https://two.example|token-two");
    expect(values.has("MEMOBASE_INSPECTOR_USER")).toBe(false);
    expect(setCookie).toHaveBeenCalledWith(
      "MEMOBASE_INSPECTOR_LOCALE",
      "https://two.example|token-two",
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" })
    );
  });

  it("clears a stale user when expired credentials are reconnected", async () => {
    values.set("MEMOBASE_INSPECTOR_USER", "old-user");
    await setLocale("https://two.example", "token-two");
    expect(values.has("MEMOBASE_INSPECTOR_USER")).toBe(false);
  });

  it("does not create a user without project credentials", async () => {
    values.set("MEMOBASE_INSPECTOR_USER", "old-user");
    await expect(getMemoiaUser()).rejects.toMatchObject({ code: "PROJECT_REQUIRED", status: 401 });
    expect(values.has("MEMOBASE_INSPECTOR_USER")).toBe(false);
  });

  it("clears both cookies when clearing the project", async () => {
    values.set("MEMOBASE_INSPECTOR_LOCALE", "https://one.example|token-one");
    values.set("MEMOBASE_INSPECTOR_USER", "old-user");
    await clearLocale();
    expect(values.size).toBe(0);
  });

  it("rejects a cross-environment save and keeps the current project intact", async () => {
    vi.mocked(getCloudflareContext).mockReturnValue({ env: { MEMOIA: { fetch: vi.fn() } } } as never);
    await setLocale("worker", "test-key");
    values.set("MEMOBASE_INSPECTOR_USER", "existing-user");
    await expect(setLocale("https://online.example", "online-key")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await projectCredentials()).toEqual({ endpoint: "worker", key: "test-key" });
    expect(await getMemoiaUser()).toBe("existing-user");
  });

  it("accepts the configured HTTP endpoint alongside the Worker", async () => {
    vi.mocked(getCloudflareContext).mockReturnValue({ env: { MEMOIA: { fetch: vi.fn() } } } as never);
    vi.stubEnv("MEMOIA_HTTP_ORIGIN", "https://memoia-test.example");
    await setLocale("https://memoia-test.example/", "test-key");
    expect(await projectCredentials()).toEqual({ endpoint: "https://memoia-test.example", key: "test-key" });
    await expect(setLocale("https://memoia-online.example", "online-key")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects another environment in standalone mode when an origin is configured", async () => {
    vi.stubEnv("MEMOIA_HTTP_ORIGIN", "https://production.example");
    await setLocale("https://production.example", "production-key");
    await expect(setLocale("https://test.example", "test-key")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await projectCredentials()).toEqual({ endpoint: "https://production.example", key: "production-key" });
  });

  it("treats an old cross-environment cookie as disconnected everywhere", async () => {
    vi.mocked(getCloudflareContext).mockReturnValue({ env: { MEMOIA: { fetch: vi.fn() } } } as never);
    vi.stubEnv("MEMOIA_HTTP_ORIGIN", "https://test.example");
    values.set("MEMOBASE_INSPECTOR_LOCALE", "https://test.example|old-key");
    values.set("MEMOIA_INSPECTOR_CONNECTION", "https://online.example|other-key");
    values.set("MEMOBASE_INSPECTOR_USER", "old-user");
    const transport = vi.fn(); vi.stubGlobal("fetch", transport);
    expect(await projectCredentials()).toBeNull();
    expect((await getUsage(new Request("https://inspector.example/api/memobase/usage"))).status).toBe(401);
    await expect(prepareMemoiaUser("new-user")).rejects.toMatchObject({ code: "PROJECT_REQUIRED" });
    await expect(getMemoiaUser()).rejects.toMatchObject({ code: "PROJECT_REQUIRED" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("disconnects a stale standalone cookie when the fixed environment changes", async () => {
    vi.stubEnv("MEMOIA_HTTP_ORIGIN", "https://production.example");
    values.set("MEMOBASE_INSPECTOR_LOCALE", "https://test.example|old-key");
    values.set("MEMOBASE_INSPECTOR_USER", "old-user");
    const transport = vi.fn(); vi.stubGlobal("fetch", transport);
    expect(await projectCredentials()).toBeNull();
    expect((await getUsage(new Request("https://inspector.example/api/memobase/usage"))).status).toBe(401);
    expect(transport).not.toHaveBeenCalled();
  });

  it("routes the Test project SDK request only through the binding", async () => {
    const networkFetch = vi.fn(); vi.stubGlobal("fetch", networkFetch);
    const boundFetch = vi.fn().mockResolvedValue(Response.json({ usages: [] }));
    vi.mocked(getCloudflareContext).mockReturnValue({ env: { MEMOIA: { fetch: boundFetch } } } as never);
    await setLocale("worker", "test-key");
    expect((await getUsage(new Request("https://inspector.example/api/memobase/usage"))).status).toBe(200);
    expect(boundFetch).toHaveBeenCalledWith(expect.stringContaining("https://memoia.invalid/api/project/usage"), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    }));
    expect(networkFetch).not.toHaveBeenCalled();
  });
});


const uid = "11111111-1111-4111-8111-111111111111";
const missing = () => Response.json({ detail: { code: "NOT_FOUND", retryable: false } }, { status: 404 });
const unknownWrite = () => Response.json({ detail: { code: "internal_error", retryable: true } }, { status: 500 });

it("read and identity preparation never send a Memoia write", async () => {
  values.set("MEMOBASE_INSPECTOR_LOCALE", "https://fixture.invalid|fixture-only");
  const transport = vi.fn(); vi.stubGlobal("fetch", transport);
  await expect(getMemoiaUser()).rejects.toMatchObject({ code: "USER_NOT_INITIALIZED" });
  expect(await prepareMemoiaUser(uid)).toBe(uid);
  expect(await prepareMemoiaUser("22222222-2222-4222-8222-222222222222")).toBe(uid);
  expect(await getMemoiaUser()).toBe(uid);
  expect(transport).not.toHaveBeenCalled();
});

it("unknown create retains its ID; refresh only reads; explicit recovery reuses the same ID", async () => {
  values.set("MEMOBASE_INSPECTOR_LOCALE", "https://fixture.invalid|fixture-only");
  const transport = vi.fn(); vi.stubGlobal("fetch", transport);
  await prepareMemoiaUser(uid);
  transport.mockResolvedValueOnce(missing()).mockResolvedValueOnce(unknownWrite()).mockResolvedValueOnce(missing());
  await expect(initializeMemoiaUser(uid)).rejects.toMatchObject({ outcome: "unknown" });
  expect(await getMemoiaUser()).toBe(uid);
  expect(transport).toHaveBeenCalledTimes(3);
  transport.mockResolvedValueOnce(missing()).mockResolvedValueOnce(Response.json({ id: uid }, { status: 201 }));
  expect(await initializeMemoiaUser(uid)).toBe(uid);
  const writes = transport.mock.calls.filter(([, options]) => options.method === "POST");
  expect(writes).toHaveLength(2);
  expect(writes.map(([, options]) => JSON.parse(options.body))).toEqual([{ id: uid }, { id: uid }]);
});

it.each(["unknown", "conflict"])("%s create is confirmed only by reading its stable ID", async kind => {
  values.set("MEMOBASE_INSPECTOR_LOCALE", "https://fixture.invalid|fixture-only");
  const transport = vi.fn(); vi.stubGlobal("fetch", transport);
  await prepareMemoiaUser(uid);
  const createResult = kind === "unknown" ? unknownWrite() : Response.json({ detail: { code: "user_exists", retryable: false } }, { status: 409 });
  transport.mockResolvedValueOnce(missing()).mockResolvedValueOnce(createResult).mockResolvedValueOnce(Response.json({ data: {} }));
  expect(await initializeMemoiaUser(uid)).toBe(uid);
  expect(transport.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "POST", "GET"]);
  expect(String(transport.mock.calls[2][0])).toContain(uid);
});

it("project or user changes reject stale initialization before network I/O", async () => {
  values.set("MEMOBASE_INSPECTOR_LOCALE", "https://fixture.invalid|fixture-only");
  values.set("MEMOBASE_INSPECTOR_USER", "22222222-2222-4222-8222-222222222222");
  const transport = vi.fn(); vi.stubGlobal("fetch", transport);
  await expect(initializeMemoiaUser(uid)).rejects.toMatchObject({ code: "USER_CHANGED" });
  expect(transport).not.toHaveBeenCalled();
});


it.each(["{", "null", '{"action":"prepare","id":"not-an-id"}', '{"action":"unknown","id":"11111111-1111-4111-8111-111111111111"}'])("initialization rejects invalid input without network I/O: %s", async body => {
  values.set("MEMOBASE_INSPECTOR_LOCALE", "https://fixture.invalid|fixture-only");
  const transport = vi.fn(); vi.stubGlobal("fetch", transport);
  const response = await POST(new Request("https://inspector.example/api/memobase/user", { method: "POST", headers: { origin: "https://inspector.example", "content-type": "application/json" }, body }));
  expect(response.status).toBe(400);
  expect(transport).not.toHaveBeenCalled();
  expect(values.has("MEMOBASE_INSPECTOR_USER")).toBe(false);
});

it("prepare acknowledges the cookie before initialize can issue a remote write", async () => {
  values.set("MEMOBASE_INSPECTOR_LOCALE", "https://fixture.invalid|fixture-only");
  const transport = vi.fn(); vi.stubGlobal("fetch", transport);
  const request = (action: string) => new Request("https://inspector.example/api/memobase/user", { method: "POST", headers: { origin: "https://inspector.example", "content-type": "application/json" }, body: JSON.stringify({ action, id: uid }) });
  expect((await POST(request("initialize"))).status).toBe(409);
  expect(transport).not.toHaveBeenCalled();
  expect((await POST(request("prepare"))).status).toBe(200);
  expect(values.get("MEMOBASE_INSPECTOR_USER")).toBe(uid);
  expect(transport).not.toHaveBeenCalled();
  transport.mockResolvedValueOnce(missing()).mockResolvedValueOnce(Response.json({ id: uid }, { status: 201 }));
  expect((await POST(request("initialize"))).status).toBe(200);
  expect(transport.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "POST"]);
});


it("keeps the SDK write budget for a normal operation lasting more than ten seconds", async () => {
  vi.useFakeTimers();
  values.set("MEMOBASE_INSPECTOR_LOCALE", "https://fixture.invalid|fixture-only");
  const transport = vi.fn((_url: unknown, options: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => resolve(Response.json({ id: uid }, { status: 201 })), 15_000);
    options.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  }));
  vi.stubGlobal("fetch", transport);
  const client = await memoiaClient();
  const result = expect(client!.createUser({ id: uid })).resolves.toMatchObject({ id: uid });
  await vi.advanceTimersByTimeAsync(15_000);
  await result;
  expect(transport).toHaveBeenCalledTimes(1);
});

describe("Access-managed project", () => {
  const issuer = "https://inspector-fixtures.cloudflareaccess.com";
  const audience = "inspector-test";
  const fixtureKey = "mka_fixture";
  let assertion: (options?: { audience?: string; expires?: number; subject?: string; email?: string }) => Promise<string>;
  const bindingFetch = vi.fn();

  beforeEach(async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(publicKey), kid: "fixture", alg: "RS256" };
    assertion = (options = {}) => new SignJWT({ email: options.email ?? "operator@example.invalid", type: "app" })
      .setProtectedHeader({ alg: "RS256", kid: "fixture" })
      .setIssuer(issuer).setAudience(options.audience ?? audience)
      .setSubject(options.subject ?? "first-operator").setExpirationTime(options.expires ?? "5m")
      .sign(privateKey);
    vi.stubEnv("MEMOIA_PROJECT_KEY", fixtureKey);
    vi.stubEnv("INSPECTOR_ACCESS_ISSUER", issuer);
    vi.stubEnv("INSPECTOR_ACCESS_AUDIENCE", audience);
    vi.stubEnv("INSPECTOR_ACCESS_OPERATOR_EMAIL", "operator@example.invalid");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [jwk] })));
    vi.mocked(getCloudflareContext).mockReturnValue({ env: { MEMOIA: { fetch: bindingFetch } } } as never);
    bindingFetch.mockReset().mockImplementation(async () => Response.json({ project_id: "project-a" }));
    vi.mocked(headers).mockResolvedValue(new Headers() as never);
  });

  it("fails closed without an Access assertion or Service Binding, even with a project cookie", async () => {
    values.set("MEMOIA_INSPECTOR_CONNECTION", "worker|manual-key");
    await expect(getProjectContext()).rejects.toMatchObject({ status: 401 });
    expect((await getUsage(new Request("https://inspector.example/api/memobase/usage"))).status).toBe(401);
    vi.mocked(getCloudflareContext).mockReturnValue({ env: {} } as never);
    await expect(getProjectContext()).rejects.toMatchObject({ status: 503 });
    vi.mocked(getCloudflareContext).mockReturnValue({ env: { MEMOIA: { fetch: bindingFetch } } } as never);
    vi.stubEnv("MEMOIA_PROJECT_KEY", "management-token-fixture");
    await expect(getProjectContext()).rejects.toMatchObject({ status: 503 });
    expect(bindingFetch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("verifies operator, audience and expiry and never returns the managed key", async () => {
    const setAssertion = (jwt: string) => vi.mocked(headers).mockResolvedValue(new Headers({ "cf-access-jwt-assertion": jwt }) as never);
    setAssertion(await assertion({ audience: "another-inspector" }));
    await expect(getProjectContext()).rejects.toMatchObject({ status: 401 });
    setAssertion(await assertion({ email: "signed-but-not-authorized@example.invalid" }));
    await expect(getProjectContext()).rejects.toMatchObject({ status: 401 });
    setAssertion(await assertion({ expires: 1 }));
    await expect(getProjectContext()).rejects.toMatchObject({ status: 401 });
    expect(bindingFetch).not.toHaveBeenCalled();

    const valid = await assertion();
    const [header, claims, signature] = valid.split(".");
    const wrongFirstCharacter = signature[0] === "A" ? "B" : "A";
    setAssertion([header, claims, wrongFirstCharacter + signature.slice(1)].join("."));
    await expect(getProjectContext()).rejects.toMatchObject({ status: 401 });
    expect(bindingFetch).not.toHaveBeenCalled();
    setAssertion(valid);
    values.set("MEMOIA_INSPECTOR_CONNECTION", "worker|manual-key");
    values.set("MEMOBASE_INSPECTOR_USER", "old-manual-user");
    await expect(getProjectContext()).resolves.toEqual({ endpoint: "worker", projectId: "project-a", token: "" });
    expect(bindingFetch).toHaveBeenCalledTimes(1);
    const [input, init] = bindingFetch.mock.calls[0];
    expect(new Headers(init?.headers ?? input.headers).get("authorization")).toBe("Bearer " + fixtureKey);
    await expect(setLocale("worker", "manual-key")).rejects.toMatchObject({ status: 409 });

    await expect(getMemoiaUser()).rejects.toMatchObject({ code: "USER_NOT_INITIALIZED" });
    await expect(prepareMemoiaUser("first-user")).resolves.toBe("first-user");
    await expect(getMemoiaUser()).resolves.toBe("first-user");
    setAssertion(await assertion({ subject: "second-operator" }));
    await expect(getMemoiaUser()).rejects.toMatchObject({ code: "USER_NOT_INITIALIZED" });
  });
});
