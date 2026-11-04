import { spawn, spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ZERO = '0'.repeat(40);
const PROOF = 'JIANIFY_TEST_LOCAL_CI_PROOF';
const SHA = /^[a-f0-9]{40}$/;

export function localEnv(input: Record<string, string | undefined> = process.env): NodeJS.ProcessEnv {
  const result = { CI: 'true', NEXT_TELEMETRY_DISABLED: '1' } as unknown as NodeJS.ProcessEnv;
  for (const name of ['PATH', 'HOME', 'PNPM_HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'LANG', 'LC_ALL', 'NO_PROXY', 'no_proxy']) {
    if (input[name] !== undefined) result[name] = input[name];
  }
  for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    const value = input[name];
    if (!value) continue;
    let proxy: URL;
    try { proxy = new URL(value); } catch { throw new Error('LOCAL_PROXY_AUTH_FORBIDDEN'); }
    if (!proxy.hostname || proxy.username || proxy.password || proxy.search || proxy.hash) throw new Error('LOCAL_PROXY_AUTH_FORBIDDEN');
    result[name] = value;
  }
  return result;
}

let cancelled = false;
let active: ReturnType<typeof spawn> | undefined;
function killGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid) return;
  try { process.kill(-pid, signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}
export function cancel() { cancelled = true; if (active) killGroup(active.pid, 'SIGTERM'); }
export function isCancelled() { return cancelled; }
export async function run(command: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; capture?: boolean; raw?: boolean; grace?: number; cleanup?: boolean } = {}): Promise<string> {
  const { cwd = ROOT, env = process.env, timeout = 1200000, capture = false, raw = false, grace = 5000, cleanup = false } = options;
  if (timeout <= 0) throw new Error('COMMAND_TIMEOUT');
  if (cancelled && !cleanup) throw new Error('LOCAL_CI_CANCELLED');
  const child = spawn(command[0], command.slice(1), { cwd, env, detached: true, stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
  active = child;
  let output = '';
  child.stdout?.on('data', chunk => { output += chunk.toString(); });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; killGroup(child.pid, 'SIGTERM'); }, timeout);
  let force: ReturnType<typeof setTimeout> | undefined;
  const forceAfterTerm = () => { force ??= setTimeout(() => killGroup(child.pid, 'SIGKILL'), grace); };
  const watch = setInterval(() => { if (timedOut || (cancelled && !cleanup)) forceAfterTerm(); }, 50);
  try {
    const code = await new Promise<number | null>((resolvePromise, reject) => {
      child.on('error', reject);
      child.on('close', resolvePromise);
    });
    if (timedOut) throw new Error('COMMAND_TIMEOUT');
    if (cancelled && !cleanup) throw new Error('LOCAL_CI_CANCELLED');
    if (code !== 0) throw new Error(`COMMAND_FAILED: ${command[0]} (${code})`);
    return raw ? output : output.trim();
  } finally {
    clearTimeout(timer); clearInterval(watch); if (force) clearTimeout(force);
    killGroup(child.pid, 'SIGTERM'); killGroup(child.pid, 'SIGKILL');
    if (active === child) active = undefined;
  }
}
const git = (...args: string[]) => run(['git', ...args], { timeout: 30000, capture: true });
export async function cleanHead() {
  if (await git('status', '--porcelain')) throw new Error('TEST_PUSH_DIRTY_WORKTREE');
  return git('rev-parse', 'HEAD');
}
export async function check(input: string) {
  for (const line of input.split(/\r?\n/).filter(Boolean)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) throw new Error('PUSH_REF_INPUT_INVALID');
    const [, sha, destination, base] = fields;
    if (destination !== 'refs/heads/test') continue;
    if (!SHA.test(sha) || !SHA.test(base)) throw new Error('PUSH_REF_INPUT_INVALID');
    if (sha === ZERO) throw new Error('TEST_BRANCH_DELETION_FORBIDDEN');
    if (await cleanHead() !== sha) throw new Error('TEST_PUSH_HEAD_MISMATCH');
    if (process.env[PROOF] !== `${sha}:${base}`) throw new Error('TEST_PUSH_REQUIRES_LOCAL_CI');
    if (base !== ZERO) await git('merge-base', '--is-ancestor', base, sha);
    console.log(`本次本地 CI 已通过，允许推送 Test：${sha}`);
  }
}
export async function install() {
  const configured = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  if (configured.status !== 0 && configured.status !== 1) throw new Error('HOOK_CONFIG_READ_FAILED');
  const value = configured.stdout.trim();
  if (value && value !== '.githooks') throw new Error('EXISTING_HOOK_MANAGER');
  if (!value) {
    const hooks = resolve(ROOT, await git('rev-parse', '--git-path', 'hooks'));
    try { if (readdirSync(hooks, { withFileTypes: true }).some(entry => (entry.isFile() || entry.isSymbolicLink()) && !entry.name.endsWith('.sample'))) throw new Error('EXISTING_HOOKS'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  chmodSync(resolve(ROOT, '.githooks/pre-push'), 0o755);
  await git('config', '--local', 'core.hooksPath', '.githooks');
}
export async function push() {
  if (await git('config', '--get', 'core.hooksPath') !== '.githooks') throw new Error('HOOK_NOT_INSTALLED');
  accessSync(resolve(ROOT, '.githooks/pre-push'), constants.X_OK);
  const sha = await cleanHead();
  const remote = await git('ls-remote', 'origin', 'refs/heads/test');
  const base = remote ? remote.split(/\s+/)[0] : ZERO;
  if (!SHA.test(base)) throw new Error('TEST_PUSH_BASE_INVALID');
  if (base !== ZERO) { await git('fetch', '--no-tags', 'origin', 'test'); await git('merge-base', '--is-ancestor', base, sha); }
  await run([process.execPath, '--experimental-strip-types', 'scripts/verify-local.ts', '--mode', 'full', '--base', base], { env: localEnv(), timeout: 1830000, grace: 60000 });
  if (await cleanHead() !== sha) throw new Error('TEST_PUSH_SOURCE_CHANGED');
  await run(['git', 'push', 'origin', 'HEAD:refs/heads/test'], { env: { ...process.env, [PROOF]: `${sha}:${base}` }, timeout: 60000 });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('SIGTERM', cancel); process.on('SIGINT', cancel);
  try {
    if (process.argv[2] === 'check' && process.argv.length === 3) { let input = ''; for await (const chunk of process.stdin) input += chunk; await check(input); }
    else if (process.argv[2] === 'install' && process.argv.length === 3) await install();
    else if (process.argv[2] === 'push' && process.argv.length === 3) await push();
    else throw new Error('Usage: node --experimental-strip-types scripts/test-push.ts install|push|check');
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
