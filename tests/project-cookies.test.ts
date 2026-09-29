import { beforeEach, describe, expect, it, vi } from "vitest";
import { cookies } from "next/headers";
import { clearLocale, getMemobaseUser, setLocale } from "@/utils/memobase/client";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@memobase/memobase", () => ({ MemoBaseClient: vi.fn() }));

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
    await expect(getMemobaseUser()).rejects.toThrow("Project credentials are required");
    expect(values.has("MEMOBASE_INSPECTOR_USER")).toBe(false);
  });

  it("clears both cookies when clearing the project", async () => {
    values.set("MEMOBASE_INSPECTOR_LOCALE", "https://one.example|token-one");
    values.set("MEMOBASE_INSPECTOR_USER", "old-user");
    await clearLocale();
    expect(values.size).toBe(0);
  });
});
