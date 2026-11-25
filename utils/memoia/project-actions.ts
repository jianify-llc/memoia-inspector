"use server";

import { clearLocale, getProjectContext, setLocale } from "./client";

export async function readProject() {
  return getProjectContext();
}

export async function saveProject(endpoint: string, key: string) {
  await setLocale(endpoint, key);
}

export async function clearProject() {
  await clearLocale();
}
