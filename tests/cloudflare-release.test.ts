import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { preflight, release } from "../deploy/cloudflare-release";

const sha = "a".repeat(40);
const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const env = { ...process.env, GITHUB_SHA: sha, GITHUB_REF: "refs/heads/test", CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_API_TOKEN: "fixture", CF_TEST_ZONE_ID: "zone", CF_TEST_PUBLIC_ORIGIN: "https://inspector.example.com" };

function mockApi(options: { bypass?: boolean; relatedPath?: boolean; emptyPolicies?: boolean; accessStatus?: number; appInfo?: Record<string, number>; policyInfo?: Record<string, number>; serviceEnvironment?: string | null; service?: string; entrypoint?: string; origin?: string | null; duplicateService?: boolean; uploadedService?: string; uploadedOrigin?: string | null } = {}) {
  const bindings = (uploaded: boolean) => {
    const service = { name: "MEMOIA", type: "service", service: (uploaded ? options.uploadedService : options.service) ?? "luvel-memoia-test", ...(options.serviceEnvironment === null ? {} : { environment: options.serviceEnvironment ?? "production" }), ...(options.entrypoint ? { entrypoint: options.entrypoint } : {}) };
    const origin = uploaded ? options.uploadedOrigin : options.origin;
    return [
      service,
      ...(options.duplicateService ? [service] : []),
      ...(origin === null ? [] : [{ name: "MEMOIA_BINDING_ORIGIN", type: "plain_text", text: origin ?? "https://test-memoia.luvel.app" }]),
    ];
  };
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/client/v4/zones/zone/access/") && options.accessStatus) return Response.json({ success: false }, { status: options.accessStatus });
    let result: unknown;
    if (url.pathname.endsWith("/settings")) result = { bindings: bindings(false) };
    else if (url.pathname.endsWith(`/versions/${id}`)) result = { id, resources: { bindings: bindings(true) } };
    else if (url.pathname.endsWith("/subdomain")) result = { enabled: false, previews_enabled: false };
    else if (url.pathname === "/client/v4/zones/zone/access/apps/protected/policies") result = options.emptyPolicies ? [] : [{ decision: options.bypass ? "bypass" : "allow" }];
    else if (url.pathname === "/client/v4/zones/zone/access/apps") result = [
      { id: "protected", type: "self_hosted", domain: "inspector.example.com", destinations: [{ type: "public", uri: "inspector.example.com" }] },
      { id: "unrelated", type: "self_hosted", domain: "*.other.example", destinations: [{ type: "worker", worker_id: "f".repeat(32) }] },
      ...(options.relatedPath ? [{ id: "path", domain: "inspector.example.com/admin" }] : []),
    ];
    else throw new Error(`Unexpected API path ${url.pathname}`);
    const info = url.pathname.endsWith("/access/apps") ? options.appInfo ?? { total_pages: 1 } : options.policyInfo;
    return Response.json({ success: true, result, ...(info ? { result_info: info } : {}) });
  });
}

function fakeRunner(heads: string[], records: object[] = [{ type: "version-upload", worker_name: "luvel-memoia-inspector-test", version_id: id }]) {
  const commands: string[][] = [];
  let checks = 0;
  const run = (file: string, args: string[], childEnv: NodeJS.ProcessEnv) => {
    commands.push([file, ...args]);
    if (file === "git") return `${heads[Math.min(checks++, heads.length - 1)]}\trefs/heads/test\n`;
    if (args[1] === "upload") writeFileSync(childEnv.WRANGLER_OUTPUT_FILE_PATH!, records.map(x => JSON.stringify(x)).join("\n"));
    return "";
  };
  return { run, commands };
}

describe("Cloudflare Test release", () => {
  it("uses the actual manual workflow and delegates publication to the guarded helper", () => {
    const workflow = parse(readFileSync(".github/workflows/deploy-test.yml", "utf8"));
    expect(Object.keys(workflow.on)).toEqual(["workflow_dispatch"]);
    const steps = workflow.jobs.deploy.steps;
    expect(steps[0].with["persist-credentials"]).toBe(false);
    expect(steps[1].run).toContain("git ls-remote");
    expect(steps.at(-1).run).toBe("node --experimental-strip-types deploy/cloudflare-release.ts");
    for (const step of steps.filter((s: { uses?: string }) => s.uses)) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
  });
  it("checks the specified zone without account Access or zone metadata permissions", async () => {
    const transport = mockApi();
    await expect(preflight(env, transport)).resolves.toBeUndefined();
    expect(transport.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/client/v4/accounts/account/workers/scripts/luvel-memoia-inspector-test/settings",
      "/client/v4/accounts/account/workers/scripts/luvel-memoia-inspector-test/subdomain",
      "/client/v4/zones/zone/access/apps",
      "/client/v4/zones/zone/access/apps/protected/policies",
    ]);
  });
  it("rejects bypass policies and overlapping hostname rules", async () => {
    await expect(preflight(env, mockApi({ bypass: true }))).rejects.toThrow("authentication");
    await expect(preflight(env, mockApi({ relatedPath: true }))).rejects.toThrow("overlapping");
  });
  it("accepts only the Test Worker's default HTTP service environment", async () => {
    await expect(preflight(env, mockApi({ serviceEnvironment: null }))).resolves.toBeUndefined();
    await expect(preflight(env, mockApi({ serviceEnvironment: "staging" }))).rejects.toThrow("binding");
    await expect(preflight(env, mockApi({ service: "memoia-online" }))).rejects.toThrow("binding");
    await expect(preflight(env, mockApi({ entrypoint: "Admin" }))).rejects.toThrow("binding");
    await expect(preflight(env, mockApi({ duplicateService: true }))).rejects.toThrow("binding");
    await expect(preflight(env, mockApi({ origin: null }))).rejects.toThrow("Test origin");
    await expect(preflight(env, mockApi({ origin: "https://memoia.luvel.app" }))).rejects.toThrow("Test origin");
  });
  it("fails closed for missing protection, empty policies or unreadable and incomplete Access state", async () => {
    await expect(preflight({ ...env, CF_TEST_PUBLIC_ORIGIN: "https://other.example.com" }, mockApi())).rejects.toThrow("matching Access application");
    await expect(preflight(env, mockApi({ emptyPolicies: true }))).rejects.toThrow("authentication");
    await expect(preflight(env, mockApi({ accessStatus: 403 }))).rejects.toThrow("(403)");
    await expect(preflight(env, mockApi({ appInfo: { total_pages: 2 } }))).rejects.toThrow("incomplete");
  });
  it("rejects partial app and policy lists when total_pages is absent", async () => {
    await expect(preflight(env, mockApi({ appInfo: { page: 1, per_page: 2, total_count: 3 } }))).rejects.toThrow("incomplete");
    await expect(preflight(env, mockApi({ policyInfo: { page: 1, per_page: 1, total_count: 2 } }))).rejects.toThrow("incomplete");
    await expect(preflight(env, mockApi({ policyInfo: { page: 2, total_pages: 1 } }))).rejects.toThrow("incomplete");
    await expect(preflight(env, mockApi({ policyInfo: { per_page: 1 } }))).rejects.toThrow("incomplete");
    await expect(preflight(env, mockApi({ policyInfo: { page: 1, per_page: 1000 } }))).resolves.toBeUndefined();
  });
  it("uploads once and deploys the exact version from Wrangler output", async () => {
    const { run, commands } = fakeRunner([sha]);
    await release(env, mockApi(), run);
    const wrangler = commands.filter(c => c[0].endsWith("/wrangler"));
    expect(wrangler).toHaveLength(2);
    expect(wrangler[0].slice(1, 6)).toEqual(["versions", "upload", "--env", "test", "--no-x-provision"]);
    expect(wrangler[1].slice(1, 6)).toEqual(["versions", "deploy", `${id}@100`, "--env", "test"]);
    expect(wrangler[0]).toContain("--keep-vars");
    expect(wrangler.every(c => c.includes("--env-file"))).toBe(true);
  });
  it.each([{ uploadedService: "memoia-online" }, { uploadedOrigin: null }, { uploadedOrigin: "https://memoia.luvel.app" }])(
    "does not activate an uploaded version with a wrong or missing Memoia binding: %j",
    async options => {
      const { run, commands } = fakeRunner([sha]);
      await expect(release(env, mockApi(options), run)).rejects.toThrow("Uploaded version MEMOIA");
      expect(commands.filter(c => c[0].endsWith("/wrangler")).map(c => c[2])).toEqual(["upload"]);
    },
  );
  it("does not upload stale candidates or deploy if head changes", async () => {
    const stale = fakeRunner(["c".repeat(40)]);
    await expect(release(env, mockApi(), stale.run)).rejects.toThrow("stale");
    expect(stale.commands.filter(c => c[0].endsWith("/wrangler"))).toHaveLength(0);
    const changed = fakeRunner([sha, "c".repeat(40)]);
    await expect(release(env, mockApi(), changed.run)).rejects.toThrow("stale");
    expect(changed.commands.filter(c => c[0].endsWith("/wrangler"))).toHaveLength(1);
  });
  it("refuses ambiguous upload records", async () => {
    const record = { type: "version-upload", worker_name: "luvel-memoia-inspector-test", version_id: id };
    const { run, commands } = fakeRunner([sha], [record, record]);
    await expect(release(env, mockApi(), run)).rejects.toThrow("ambiguous");
    expect(commands.filter(c => c[0].endsWith("/wrangler"))).toHaveLength(1);
  });
});
