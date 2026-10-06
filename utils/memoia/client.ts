"use server";

import { MemoiaClient, MemoiaError } from "@jianify/memoia";

import { cookies } from "next/headers";

const COOKIE_NAME = "MEMOBASE_INSPECTOR_LOCALE";
const USER_COOKIE_NAME = "MEMOBASE_INSPECTOR_USER";
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

/** 项目 Cookie 是凭据唯一 owner，读取和管理共用同一 SDK。 */
export async function memoiaClient() {
  const [baseUrl, apiKey] = await getLocale();
  if (!baseUrl || !apiKey) return null;
  return new MemoiaClient({ baseUrl, apiKey, maxAttempts: 2, readTimeoutMs: 10_000, writeTimeoutMs: 10_000 });
}

export async function getLocale() {
  const locale = (await cookies()).get(COOKIE_NAME)?.value || "";
  return locale.split("|");
}

export async function setLocale(url: string, key: string) {
  const val = `${url.trim()}|${key.trim()}`;
  const cookieStore = await cookies();
  const locale = cookieStore.get(COOKIE_NAME)?.value || "";
  if (locale === val) return;
  cookieStore.delete(USER_COOKIE_NAME);
  cookieStore.set(COOKIE_NAME, val, cookieOptions);
}

export async function clearLocale() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(USER_COOKIE_NAME);
}

export async function clearMemoiaUser() {
  (await cookies()).delete(USER_COOKIE_NAME);
}

/** 读取只使用已分配身份，禁止因刷新／未知结果而隐式创建其他用户。 */
export async function getMemoiaUser() {
  const cookieStore = await cookies();
  if (!cookieStore.get(COOKIE_NAME)?.value) {
    cookieStore.delete(USER_COOKIE_NAME);
    throw new MemoiaError("PROJECT_REQUIRED", 401, false);
  }
  const uid = cookieStore.get(USER_COOKIE_NAME)?.value;
  if (!uid) throw new MemoiaError("USER_NOT_INITIALIZED", 409, false);
  return uid;
}

/** 先把稳定身份交付浏览器，再允许另一请求发送供应商写入；响应丢失不会留下无身份创建。 */
export async function prepareMemoiaUser(proposedId: string) {
  const cookieStore = await cookies();
  if (!cookieStore.get(COOKIE_NAME)?.value) throw new MemoiaError("PROJECT_REQUIRED", 401, false);
  const existing = cookieStore.get(USER_COOKIE_NAME)?.value;
  if (existing) return existing;
  const uid = proposedId;
  cookieStore.set(USER_COOKIE_NAME, uid, cookieOptions);
  return uid;
}

/** 显式创建先查询稳定身份；未知结果只能读回核查，冲突也必须按同一身份确认。 */
export async function initializeMemoiaUser(expectedId: string) {
  const uid = await getMemoiaUser();
  if (uid !== expectedId) throw new MemoiaError("USER_CHANGED", 409, false);
  const client = await memoiaClient();
  if (!client) throw new MemoiaError("PROJECT_REQUIRED", 401, false);
  try {
    await client.getUser(uid);
    return uid;
  } catch (error) {
    if (!(error instanceof MemoiaError) || error.status !== 404) throw error;
  }
  try {
    await client.createUser({ id: uid });
  } catch (error) {
    if (!(error instanceof MemoiaError)) throw error;
    if (error.outcome !== "unknown" && error.code !== "user_exists") throw error;
    try {
      await client.getUser(uid);
    } catch {
      // 读不到并不证明未知写入回滚；错误及身份保持供下一次显式初始化核查。
      throw error;
    }
  }
  return uid;
}
