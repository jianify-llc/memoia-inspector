"use server";

import { MemoBaseClient } from "@memobase/memobase";

import { cookies } from "next/headers";

const COOKIE_NAME = "MEMOBASE_INSPECTOR_LOCALE";
const USER_COOKIE_NAME = "MEMOBASE_INSPECTOR_USER";
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export const memoBaseClient = async () => {
  const locale = await getLocale()
  return new MemoBaseClient(
    locale[0],
    locale[1]
  );
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

export async function clearMemobaseUser() {
  (await cookies()).delete(USER_COOKIE_NAME);
}

export async function getMemobaseUser() {
  const cookieStore = await cookies();
  if (!cookieStore.get(COOKIE_NAME)?.value) {
    cookieStore.delete(USER_COOKIE_NAME);
    throw new Error("Project credentials are required");
  }
  const client = await memoBaseClient();
  const uid = cookieStore.get(USER_COOKIE_NAME)?.value || "";

  if (!uid) {
    const newUid = await client.addUser();
    cookieStore.set(USER_COOKIE_NAME, newUid, cookieOptions);
    return newUid;
  }

  return uid;
}
