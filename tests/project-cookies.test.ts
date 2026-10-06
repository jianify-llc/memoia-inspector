import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { POST } from "@/app/api/memobase/user/route";
import { clearLocale, getMemoiaUser, setLocale, prepareMemoiaUser, initializeMemoiaUser } from "@/utils/memoia/client";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

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
  vi.mocked(cookies).mockResolvedValue(cookieStore as never);
});

afterEach(() => vi.unstubAllGlobals());

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
