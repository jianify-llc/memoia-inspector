import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ofetch } from "ofetch";
import { NodeNextRequest } from "next/dist/server/base-http/node";
import { NextRequestAdapter } from "next/dist/server/web/spec-extension/adapters/next-request";
import { addRequestMeta } from "next/dist/server/request-meta";

const sdk = vi.hoisted(() => ({
  forgetUser: vi.fn(), deleteProfile: vi.fn(), deleteEvent: vi.fn(), updateConfig: vi.fn(),
  revokeKey: vi.fn(), clearUser: vi.fn(),
}));
vi.mock("@/utils/memoia/client", () => ({ memoiaClient: async () => sdk, getMemoiaUser: async () => "playground", clearMemoiaUser: sdk.clearUser }));
import { DELETE as deleteUser } from "@/app/api/memobase/user/[uid]/route";
import { DELETE as deletePlaygroundUser } from "@/app/api/memobase/user/route";
import { DELETE as deleteProfile } from "@/app/api/memobase/profile/[profile_id]/route";
import { DELETE as deleteEvent } from "@/app/api/memobase/event/[event_id]/route";
import { DELETE as revokeKey } from "@/app/api/memoia/projects/[project_id]/keys/[key_id]/route";
import { PUT as updateConfig } from "@/app/api/memobase/config/route";

let server: Server;
let origin: string;
const observations: { hasStream: boolean; contentType: string | null }[] = [];
beforeAll(async () => {
  server = createServer(async (incoming, outgoing) => {
    try {
      addRequestMeta(incoming, "initURL", `${origin}${incoming.url}`);
      const request = NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(incoming), new AbortController().signal);
      observations.push({ hasStream: request.body !== null, contentType: request.headers.get("content-type") });
      const path = new URL(request.url).pathname;
      const params = { params: Promise.resolve({ uid: "user", profile_id: "profile", event_id: "event", project_id: "project", key_id: "key" }) };
      const response = path === "/user" ? await deleteUser(request, params) :
        path === "/playground" ? await deletePlaygroundUser(request) :
        path === "/profile" ? await deleteProfile(request, params) :
        path === "/event" ? await deleteEvent(request, params) :
        path === "/key" ? await revokeKey(request, params) :
        await updateConfig(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch {
      outgoing.writeHead(500).end("HTTP fixture failed");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
beforeEach(() => {
  vi.resetAllMocks();
  observations.length = 0;
  sdk.forgetUser.mockResolvedValue({ user_id: "user", forgotten: true });
  sdk.updateConfig.mockResolvedValue(undefined);
});
const send = (path: string, method: "DELETE" | "POST" | "PUT", options: { body?: string | Record<string, unknown>; headers?: Record<string, string> } = {}) =>
  ofetch.raw(`${origin}${path}`, { method, retry: 0, ignoreResponseError: true, ...options,
    headers: { origin, "sec-fetch-site": "same-origin", ...options.headers } });

describe("real Node → Next request → management route", () => {
  it.each(["/user", "/playground", "/profile", "/event", "/key"])("accepts same-origin bodyless DELETE %s without inventing JSON", async (path) => {
    const response = await send(path, "DELETE");
    expect(response.status).toBe(200);
    expect(response._data.code).toBe(0);
    expect(observations).toEqual([{ hasStream: true, contentType: null }]);
    const method = path === "/profile" ? sdk.deleteProfile : path === "/event" ? sdk.deleteEvent : path === "/key" ? sdk.revokeKey : sdk.forgetUser;
    expect(method).toHaveBeenCalledOnce();
  });
  it.each(["/user", "/playground", "/profile", "/event", "/key"])("rejects cross-origin %s before any write", async (path) => {
    expect((await send(path, "DELETE", { headers: { origin: "https://other.example" } })).status).toBe(403);
    for (const call of [sdk.forgetUser, sdk.deleteProfile, sdk.deleteEvent, sdk.revokeKey, sdk.clearUser]) expect(call).not.toHaveBeenCalled();
  });
  it.each([
    [undefined, undefined, 415], ["{}", "text/plain", 415], ["{", "application/json", 400],
    ["null", "application/json", 400], ["[]", "application/json", 400],
  ])("rejects invalid JSON contract %s / %s before config write", async (body, contentType, status) => {
    const response = await send("/config", "PUT", { body, headers: contentType ? { "content-type": contentType } : {} });
    expect(response.status).toBe(status);
    expect(sdk.updateConfig).not.toHaveBeenCalled();
  });
  it("accepts a real same-origin JSON config update", async () => {
    expect((await send("/config", "PUT", { body: { config: "language: en" } })).status).toBe(200);
    expect(sdk.updateConfig).toHaveBeenCalledWith({ profile_config: "language: en" });
  });
  it("retains SDK failures after transport validation succeeds", async () => {
    sdk.forgetUser.mockRejectedValue(new Error("rejected"));
    expect((await send("/user", "DELETE")).status).toBe(502);
    sdk.updateConfig.mockRejectedValue(new Error("rejected"));
    expect((await send("/config", "PUT", { body: { config: "language: en" } })).status).toBe(502);
  });
});
