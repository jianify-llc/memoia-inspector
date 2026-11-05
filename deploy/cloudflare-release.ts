import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const worker = "luvel-memoia-inspector-test";
type AccessApp = { id: string; domain?: string; self_hosted_domains?: string[]; type?: string; destinations?: Array<{ type?: string; uri?: string; worker_id?: string; overrides?: unknown[] }> };
type Env = NodeJS.ProcessEnv;
type Fetch = typeof fetch;

function hostMatches(pattern: string | undefined, host: string) {
  if (!pattern) return false;
  const hostname = pattern.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  const escaped = hostname.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(host.toLowerCase());
}

export async function preflight(env: Env, transport: Fetch = fetch) {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, CF_TEST_PUBLIC_ORIGIN: origin, CF_TEST_ZONE_ID: zone } = env;
  if (!account || !token || !origin || !zone) throw new Error("Missing Cloudflare preflight configuration");
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin) throw new Error("CF_TEST_PUBLIC_ORIGIN must be an HTTPS origin");
  const api = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}`;
  async function get(path: string, base = api): Promise<unknown> {
    const response = await transport(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Cloudflare preflight failed: ${path} (${response.status})`);
    const body = await response.json() as { success: boolean; result: unknown; result_info?: { total_pages?: number; total_count?: number; page?: number; per_page?: number } };
    if (!body.success || (body.result_info?.total_pages ?? 1) > 1) throw new Error(`Cloudflare preflight incomplete: ${path}`);
    if (Array.isArray(body.result)) {
      const info = body.result_info;
      if ((info?.page !== undefined && info.page !== 1)
        || (info?.total_count !== undefined && info.total_count !== body.result.length)
        || (info?.total_pages === undefined && info?.total_count === undefined && body.result.length >= (info?.per_page ?? 1000))) throw new Error(`Cloudflare preflight incomplete: ${path}`);
    }
    return body.result;
  }
  const settings = await get(`/workers/scripts/${worker}/settings`) as { bindings?: Array<{ name?: string; type?: string; service?: string; environment?: string; entrypoint?: string }> };
  // Cloudflare reports the named Worker's default service environment as production.
  if (!settings.bindings?.some(b => b.name === "MEMOIA" && b.type === "service" && b.service === "luvel-memoia-test" && (b.environment === undefined || b.environment === "production") && !b.entrypoint)) throw new Error("Existing MEMOIA binding does not match Test target");
  const subdomain = await get(`/workers/scripts/${worker}/subdomain`) as { enabled?: boolean; previews_enabled?: boolean };
  if (subdomain.enabled !== false || subdomain.previews_enabled !== false) throw new Error("workers.dev and preview URLs must already be disabled");
  const zoneApi = `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone)}`;
  const zoneApps = await get("/access/apps?per_page=1000", zoneApi) as AccessApp[];
  const relevant = zoneApps.filter(app => hostMatches(app.domain, url.host) || app.self_hosted_domains?.some(domain => hostMatches(domain, url.host)) || app.destinations?.some(d => hostMatches(d.uri, url.host)));
  if (relevant.length !== 1) throw new Error("Expected exactly one matching Access application; overlapping rules require manual review");
  const app = relevant[0];
  if (app.type !== "self_hosted" || app.domain !== url.host || app.self_hosted_domains?.some(domain => hostMatches(domain, url.host) && domain !== url.host) || app.destinations?.some(d => (hostMatches(d.uri, url.host) && (d.overrides?.length || d.uri !== url.host)))) throw new Error("Access must protect the whole hostname without overrides");
  const policies = await get(`/access/apps/${encodeURIComponent(app.id)}/policies?per_page=1000`, zoneApi) as Array<{ decision?: string }>;
  if (!policies.length || policies.some(p => p.decision !== "allow" && p.decision !== "deny")) throw new Error("Access policies must require authentication");
  console.log("Cloudflare Test preflight passed; full Access security remains a manual prerequisite");
}

type Runner = (file: string, args: string[], env: Env) => string;
const run: Runner = (file, args, env) => execFileSync(file, args, { env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
export async function release(env: Env, transport: Fetch = fetch, runner: Runner = run) {
  const sha = env.GITHUB_SHA;
  if (!sha || !/^[a-f0-9]{40}$/.test(sha) || env.GITHUB_REF !== "refs/heads/test") throw new Error("Expected a Test branch candidate SHA");
  const checkHead = () => {
    const head = runner("git", ["ls-remote", "origin", "refs/heads/test"], env).trim().split(/\s+/)[0];
    if (head !== sha) throw new Error("Test head changed; candidate is stale");
  };
  const dir = mkdtempSync(resolve(tmpdir(), "inspector-release-"));
  try {
    const emptyEnv = resolve(dir, "empty.env");
    const output = resolve(dir, "wrangler.jsonl");
    writeFileSync(emptyEnv, "", { flag: "wx" });
    const cli = resolve("node_modules/.bin/wrangler");
    const childEnv = { ...env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" };
    checkHead();
    await preflight(env, transport);
    runner(cli, ["versions", "upload", "--env", "test", "--no-x-provision", "--keep-vars", "--env-file", emptyEnv, "--message", sha], { ...childEnv, WRANGLER_OUTPUT_FILE_PATH: output });
    const records = readFileSync(output, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    const versions = records.filter(record => record.type === "version-upload" && record.worker_name === worker);
    if (versions.length !== 1 || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(versions[0].version_id)) throw new Error("Uploaded version identity missing or ambiguous");
    checkHead();
    await preflight(env, transport);
    checkHead();
    runner(cli, ["versions", "deploy", `${versions[0].version_id}@100`, "--env", "test", "--env-file", emptyEnv, "--yes", "--message", sha], childEnv);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await release(process.env);
}
