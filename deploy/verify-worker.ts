import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const directory = mkdtempSync(resolve(tmpdir(), "inspector-workerd-"));
let child: ChildProcess | undefined;
let fixture: Server | undefined;
let cancelled = false;
const startupLogs: Buffer[] = [];
let capturedBytes = 0;
let workerExited = false;
let childDone: Promise<void> | undefined;
const signalGroup = (signal: NodeJS.Signals) => {
  if (!child?.pid) return;
  try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); } catch { /* already exited */ }
};
const cancel = () => { cancelled = true; signalGroup("SIGTERM"); };
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);

async function listen(server: Server): Promise<number> {
  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", () => { server.off("error", fail); ok(); }); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to reserve local port");
  return address.port;
}
async function close(server: Server) {
  await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok()));
}
async function request(url: string, options: RequestInit = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
}

try {
  const emptyEnv = resolve(directory, "empty.env");
  writeFileSync(emptyEnv, "", { flag: "wx" });
  const source = JSON.parse(readFileSync("wrangler.jsonc", "utf8")) as {
    name: string; main: string; compatibility_date: string; compatibility_flags: string[];
    assets: { directory: string; binding: string };
  };
  const localConfig = resolve(directory, "wrangler.json");
  writeFileSync(localConfig, JSON.stringify({
    name: source.name, main: resolve(source.main), compatibility_date: source.compatibility_date,
    compatibility_flags: source.compatibility_flags,
    assets: { ...source.assets, directory: resolve(source.assets.directory) },
    workers_dev: false, preview_urls: false,
  }), { flag: "wx" });
  const data = { usages: [{ date: "2026-10-09", total_input_token: 10, total_output_token: 5, total_insert: 0, total_success_insert: 0, usage_complete: false }] };
  let fixtureRequests = 0;
  let fixtureValid = true;
  fixture = createServer((req, res) => {
    fixtureRequests++;
    if (req.method !== "GET" || req.url !== "/api/project/usage?last_days=1" || req.headers.authorization !== "Bearer fixture-only") fixtureValid = false;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  });
  const fixturePort = await listen(fixture);
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const origin = `http://127.0.0.1:${port}`;
  const fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
  // Pass only process essentials; no credentials, model configuration, or proxy variables.
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: directory, XDG_CONFIG_HOME: directory, TMPDIR: directory,
    NODE_ENV: "production", NEXTJS_ENV: "production", CI: "true",
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", WRANGLER_SEND_METRICS: "false", WRANGLER_HIDE_BANNER: "true",
  };
  child = spawn(resolve("node_modules/.bin/wrangler"), ["dev", "--local", "--config", localConfig, "--ip", "127.0.0.1", "--port", String(port), "--env-file", emptyEnv, "--persist-to", resolve(directory, "state"), "--show-interactive-dev-session=false", "--log-level", "error"], {
    env: childEnv, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  childDone = new Promise<void>(ok => {
    child!.once("exit", () => { workerExited = true; ok(); });
    child!.once("error", () => { workerExited = true; ok(); });
  });
  // Only retain bounded startup output; later request logs may contain user data.
  let capturingStartup = true;
  for (const stream of [child.stdout, child.stderr]) stream?.on("data", (chunk: Buffer) => {
    if (!capturingStartup || capturedBytes >= 4096) return;
    const part = chunk.subarray(0, 4096 - capturedBytes);
    startupLogs.push(part);
    capturedBytes += part.length;
  });
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline && !workerExited && !cancelled) {
    try { const response = await request(`${origin}/api/chat`); if (response.ok) { ready = true; break; } } catch { /* starting */ }
    await delay(250);
  }
  capturingStartup = false;
  if (!ready) {
    const safeLog = Buffer.concat(startupLogs).toString("utf8")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/(authorization|cookie|token|secret|password|api[_-]?key)([\s"':=]+)[^\s,;]+/gi, "$1$2[redacted]")
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/https?:\/\/[^\s"']+/gi, "[url]");
    throw new Error(`Local Worker did not become ready; startup diagnostics:\n${safeLog || "(no output)"}`);
  }
  assert.equal((await request(`${origin}/settings`)).status, 200, "settings page");
  assert.equal((await request(`${origin}/`)).status, 200, "root page");
  assert.equal((await request(`${origin}/api/memobase/usage`)).status, 401, "unauthenticated usage");
  assert.equal((await request(`${origin}/api/chat`, { method: "POST", headers: { origin: "https://other.invalid" } })).status, 403, "cross-origin mutation");
  assert.equal((await request(`${origin}/api/chat`, { method: "POST", headers: { origin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: "{}" })).status, 503, "unconfigured model");
  const chat = await request(`${origin}/api/chat`);
  assert.equal((await chat.json() as { enabled?: boolean }).enabled, false);
  assert.match(chat.headers.get("cache-control") ?? "", /no-store/i);
  const cookie = `MEMOBASE_INSPECTOR_LOCALE=${encodeURIComponent(`${fixtureOrigin}|fixture-only`)}`;
  const usage = await request(`${origin}/api/memobase/usage?last_days=1`, { headers: { cookie } });
  assert.equal(usage.status, 200, "fixture usage status");
  assert.deepEqual((await usage.json() as { data: unknown }).data, data);
  assert.equal(fixtureRequests, 1, "one fixture read");
  assert.equal(fixtureValid, true, "fixture path and Bearer credential");
  const prepare = await request(`${origin}/api/memobase/user`, { method: "POST", headers: { origin, cookie, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body: JSON.stringify({ action: "prepare", id: "11111111-1111-4111-8111-111111111111" }) });
  assert.equal(prepare.status, 200, "prepare identity");
  const setCookie = prepare.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /MEMOBASE_INSPECTOR_USER=/i);
  assert.match(setCookie, /httponly/i);
  assert.match(setCookie, /samesite=lax/i);
  assert.match(setCookie, /secure/i);
  assert.equal(fixtureRequests, 1, "prepare does not write Memoia");
  if (cancelled) throw new Error("Local Worker verification cancelled");
  console.log("Local Worker smoke passed, including the Memoia SDK fixture.");
} finally {
  let cleanupError: Error | undefined;
  signalGroup("SIGTERM");
  if (childDone && !workerExited) await Promise.race([childDone, delay(2000)]);
  signalGroup("SIGKILL");
  if (childDone && !workerExited) {
    await Promise.race([childDone, delay(2000)]);
    if (!workerExited) cleanupError = new Error("Worker process did not exit after termination");
  }
  if (child?.pid && process.platform !== "win32") {
    const group = -child.pid;
    const deadline = Date.now() + 2000;
    let present = true;
    while (present && Date.now() < deadline) {
      try { process.kill(group, 0); await delay(50); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") present = false; else { cleanupError ??= new Error("Could not inspect Worker process group"); break; } }
    }
    if (present) cleanupError ??= new Error("Worker process group did not exit after termination");
  }
  if (fixture?.listening) {
    fixture.closeAllConnections();
    try { await Promise.race([close(fixture), delay(2000).then(() => { throw new Error("Fixture server did not close"); })]); }
    catch { cleanupError ??= new Error("Fixture server did not close"); }
  }
  rmSync(directory, { recursive: true, force: true });
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
  if (cleanupError) throw cleanupError;
}
