import { MemoiaClient, MemoiaError } from "@jianify/memoia";

import { cookies } from "next/headers";
import { memoiaConnection, memoiaEndpoint, memoiaTransport } from "@/lib/memoia-transport";

import { COOKIE_NAME, WORKER_COOKIE_NAME, hasManagedProject, projectCredentials } from "./project-credentials";

const USER_COOKIE_NAME = "MEMOBASE_INSPECTOR_USER";
const MANAGED_USER_COOKIE_NAME = "MEMOIA_INSPECTOR_MANAGED_USER";
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

function clientForCredentials({ endpoint, key: apiKey }: { endpoint: string; key: string }, connection: ReturnType<typeof memoiaConnection>) {
  const options = { apiKey, maxAttempts: 2, readTimeoutMs: 10_000 };
  if (endpoint === "worker") {
    if (!connection.binding) return null;
    return new MemoiaClient({ ...options, binding: connection.binding });
  }
  return new MemoiaClient({ ...options, baseUrl: endpoint, fetch: memoiaTransport(endpoint, connection) });
}

export async function memoiaClient(expected?: { endpoint: string; projectId: string }) {
  const connection = memoiaConnection();
  const credentials = await projectCredentials(undefined, connection);
  if (!credentials) return null;
  if (expected && credentials.endpoint !== expected.endpoint) throw new MemoiaError("PROJECT_CHANGED", 409, false);
  const client = clientForCredentials(credentials, connection);
  if (!client) return null;
  if (expected && (await client.getProjectIdentity()).project_id !== expected.projectId) {
    throw new MemoiaError("PROJECT_CHANGED", 409, false);
  }
  return client;
}

export async function getProjectContext() {
  const connection = memoiaConnection();
  const credentials = await projectCredentials(undefined, connection);
  if (!credentials) return null;
  const client = clientForCredentials(credentials, connection);
  if (!client) return null;
  const { project_id } = await client.getProjectIdentity();
  return { endpoint: credentials.endpoint, token: credentials.subject ? "" : credentials.key, projectId: project_id };
}

export async function setLocale(url: string, key: string) {
  if (hasManagedProject()) throw new MemoiaError("MANAGED_PROJECT_CONFIGURED", 409, false);
  const connection = memoiaConnection();
  const endpoint = memoiaEndpoint(url.trim(), connection);
  const apiKey = key.trim();
  if (!endpoint || !apiKey || endpoint.includes("|") || apiKey.includes("|")) {
    throw new MemoiaError("INVALID_INPUT", 400, false);
  }
  const val = `${endpoint}|${apiKey}`;
  const cookieStore = await cookies();
  const name = connection.managed ? WORKER_COOKIE_NAME : COOKIE_NAME;
  const locale = cookieStore.get(name)?.value;
  if (locale === val) return;
  cookieStore.delete(USER_COOKIE_NAME);
  cookieStore.set(name, val, cookieOptions);
}

export async function clearLocale() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  cookieStore.delete(WORKER_COOKIE_NAME);
  cookieStore.delete(USER_COOKIE_NAME);
  cookieStore.delete(MANAGED_USER_COOKIE_NAME);
}

export async function clearMemoiaUser() {
  (await cookies()).delete(hasManagedProject() ? MANAGED_USER_COOKIE_NAME : USER_COOKIE_NAME);
}

function playgroundUserCookie(subject?: string) {
  return subject ? { name: MANAGED_USER_COOKIE_NAME, prefix: subject + ":" } : { name: USER_COOKIE_NAME, prefix: "" };
}

/** 读取只使用已分配身份，禁止因刷新／未知结果而隐式创建其他用户。 */
export async function getMemoiaUser() {
  const cookieStore = await cookies();
  const credentials = await projectCredentials(cookieStore);
  if (!credentials) {
    cookieStore.delete(USER_COOKIE_NAME);
    throw new MemoiaError("PROJECT_REQUIRED", 401, false);
  }
  const { name, prefix } = playgroundUserCookie(credentials.subject);
  const value = cookieStore.get(name)?.value;
  if (!value?.startsWith(prefix) || value.length === prefix.length) throw new MemoiaError("USER_NOT_INITIALIZED", 409, false);
  return value.slice(prefix.length);
}

/** 先交付稳定身份，响应丢失后仍能按同一身份确认写入。 */
export async function prepareMemoiaUser(proposedId: string) {
  const cookieStore = await cookies();
  const credentials = await projectCredentials(cookieStore);
  if (!credentials) throw new MemoiaError("PROJECT_REQUIRED", 401, false);
  const { name, prefix } = playgroundUserCookie(credentials.subject);
  const existing = cookieStore.get(name)?.value;
  if (existing?.startsWith(prefix) && existing.length > prefix.length) return existing.slice(prefix.length);
  cookieStore.set(name, prefix + proposedId, cookieOptions);
  return proposedId;
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
