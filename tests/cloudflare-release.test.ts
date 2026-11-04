import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";
import { preflight, release } from "../deploy/cloudflare-release";

const sha = "a".repeat(40);
const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const env = { ...process.env, GITHUB_SHA: sha, GITHUB_REF: "refs/heads/test", CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_API_TOKEN: "fixture", CF_TEST_ZONE_ID: "zone", CF_TEST_PUBLIC_ORIGIN: "https://inspector.example.com" };

function mockApi(options: { bypass?: boolean; relatedPath?: boolean } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    let result: unknown;
    if (url.pathname.endsWith("/settings")) result = { bindings: [{ name: "MEMOIA", type: "service", service: "luvel-memoia-test" }] };
    else if (url.pathname.endsWith("/subdomain")) result = { enabled: false, previews_enabled: false };
    else if (url.pathname === "/client/v4/zones/zone") result = { name: "example.com", account: { id: "account" } };
    else if (url.pathname.endsWith("/policies")) result = [{ decision: options.bypass ? "bypass" : "allow" }];
    else if (url.pathname.endsWith("/access/apps")) result = [
      { id: "protected", type: "self_hosted", domain: "inspector.example.com", destinations: [{ type: "public", uri: "inspector.example.com" }] },
      { id: "unrelated", type: "self_hosted", domain: "*.other.example", destinations: [{ type: "worker", worker_id: "other" }] },
      ...(options.relatedPath ? [{ id: "path", domain: "inspector.example.com/admin" }] : []),
    ];
    else throw new Error(`Unexpected API path ${url.pathname}`);
    return Response.json({ success: true, result });
  }) as unknown as typeof fetch;
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
  it("deduplicates identical Access apps and ignores unrelated wildcard rules", async () => {
    await expect(preflight(env, mockApi())).resolves.toBeUndefined();
    await expect(preflight(env, mockApi({ bypass: true }))).rejects.toThrow("authentication");
    await expect(preflight(env, mockApi({ relatedPath: true }))).rejects.toThrow("overlapping");
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
