import { spawnSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ROOT, cancel, isCancelled, localEnv, run } from './test-push.ts';

const SHA = /^[a-f0-9]{40}$/;
type Scope = { business: boolean; tools: boolean; build: boolean };
export async function changedPaths(base?: string, root = ROOT): Promise<string[] | null> {
  if (!base || base === '0'.repeat(40)) return null;
  if (!SHA.test(base)) throw new Error('CI_BASE_INVALID');
  try {
    if (await run(['git', 'status', '--porcelain'], { cwd: root, env: localEnv(), capture: true, timeout: 30000 })) return null;
    await run(['git', 'merge-base', '--is-ancestor', base, 'HEAD'], { cwd: root, env: localEnv(), capture: true, timeout: 30000 });
    return (await run(['git', 'diff', '--name-only', '-z', base, 'HEAD'], { cwd: root, env: localEnv(), capture: true, raw: true, timeout: 30000 })).split('\0').filter(Boolean);
  } catch { return null; }
}
export function scopeForPaths(mode: string, changed: string[] | null): Scope {
  if (mode !== 'quick' && mode !== 'full') throw new Error('CI_MODE_INVALID');
  if (mode === 'quick') return { business: true, tools: false, build: false };
  if (changed === null) return { business: true, tools: true, build: true };
  const tools = changed.some(n => ['scripts/', 'deploy/', '.githooks/', '.github/'].some(p => n.startsWith(p)) || ['tests/deploy-inspector.test.sh', 'tests/workflow-contract.test.ts', 'Dockerfile', 'package.json', 'pnpm-lock.yaml', 'wrangler.jsonc', 'open-next.config.ts'].includes(n));
  const build = changed.some(n => n.startsWith('vendor/') || ['Dockerfile', '.dockerignore', '.npmrc', 'package.json', 'pnpm-lock.yaml', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json', 'wrangler.jsonc', 'open-next.config.ts'].includes(n) || n.startsWith('deploy/'));
  const business = build || changed.some(n => ['app/', 'components/', 'lib/', 'hooks/', 'i18n/', 'types/', 'public/', 'api/', 'utils/', 'messages/'].some(p => n.startsWith(p)) || (n.startsWith('tests/') && !['tests/deploy-inspector.test.sh', 'tests/workflow-contract.test.ts'].includes(n)) || ['scripts/check-memoia-sdk.ts', 'eslint.config.mjs', 'vitest.config.ts', 'next-env.d.ts', 'cloudflare-env.d.ts'].includes(n));
  return { business, tools, build };
}
export async function verificationScope(mode: string, base?: string, root = ROOT) { return scopeForPaths(mode, mode === 'quick' ? [] : await changedPaths(base, root)); }
export async function snapshot(destination: string, root = ROOT) {
  const files = await run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, env: localEnv(), capture: true, raw: true, timeout: 30000 });
  for (const name of new Set(files.split('\0').filter(Boolean))) {
    const parts = name.split('/');
    if (parts.some(part => (part.startsWith('.env') && !part.endsWith('.example')) || part === '.dev.vars' || part.startsWith('.dev.vars.'))) continue;
    if (parts.some(part => part === '..' || part === '')) throw new Error(`CI_SOURCE_SYMLINK_FORBIDDEN: ${name}`);
    let path = root;
    let absent = false;
    for (const part of parts) {
      path = join(path, part);
      try { if (lstatSync(path).isSymbolicLink()) throw new Error(`CI_SOURCE_SYMLINK_FORBIDDEN: ${name}`); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { absent = true; break; } throw error; }
    }
    if (absent) continue;
    const target = join(destination, name);
    mkdirSync(dirname(target), { recursive: true }); copyFileSync(path, target);
  }
}
export async function cleanupOwned(name: string, container: boolean, image: boolean, executor = run) {
  const resources: string[][][] = [];
  if (container) resources.push([['docker', 'container', 'ls', '-aq', '--filter', `name=^/${name}$`], ['docker', 'rm', '-f', '-v', name]]);
  if (image) resources.push([['docker', 'image', 'ls', '-q', '--filter', `reference=${name}`], ['docker', 'image', 'rm', name]]);
  const errors: string[] = [];
  for (const [inspect, remove] of resources) {
    try { if (await executor(inspect, { env: localEnv(), capture: true, timeout: 15000, cleanup: true })) await executor(remove, { env: localEnv(), timeout: 15000, cleanup: true }); }
    catch (error) { errors.push(String(error)); }
  }
  if (errors.length) throw new Error(`LOCAL_CI_CLEANUP_FAILED: ${errors.join('; ')}`);
}
type Step = (command: string[], cwd: string, capture?: boolean) => Promise<string>;
async function deploymentFixtures(step: Step, source: string, env: NodeJS.ProcessEnv, container: string) {
  const shellFiles = readdirSync(join(source, 'deploy')).filter(n => n.endsWith('.sh')).sort().map(n => join(source, 'deploy', n));
  await step(['shellcheck', ...shellFiles, 'tests/deploy-inspector.test.sh', '.githooks/pre-push'], source);
  env.INSPECTOR_IMAGE = `ghcr.io/jianify-llc/memoia-inspector@sha256:${'0'.repeat(64)}`;
  const fixture = mkdtempSync(join(tmpdir(), 'inspector-compose-fixture-'));
  try {
    copyFileSync(join(source, 'deploy/compose.yml'), join(fixture, 'compose.yml'));
    copyFileSync(join(source, 'deploy/runtime.env.example'), join(fixture, '.env'));
    for (const stage of ['test', 'online']) {
      const project = `memoia-inspector-${stage}`;
      const config = await step(['docker', 'compose', '-p', project, '-f', 'compose.yml', 'config', '--format', 'json'], fixture, true);
      if (JSON.parse(config).name !== project) throw new Error('COMPOSE_STAGE_MISMATCH');
    }
  } finally { rmSync(fixture, { recursive: true, force: true }); }
  await step(['docker', 'run', '--name', container, '--label', 'jianify.local-ci=true', '--network', 'none', '-v', `${source}:/work:ro`, '-w', '/work', 'node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c', 'bash', 'tests/deploy-inspector.test.sh'], source);
}
export async function verify(mode = 'full', base?: string) {
  const deadline = performance.now() + 1800000;
  const scope = await verificationScope(mode, base);
  if (!Object.values(scope).some(Boolean)) { console.log('差异不影响 Inspector 业务、构建或部署工具；无须运行检查。'); return; }
  const env = localEnv();
  const dockerEnv = { ...env };
  const commands = ['pnpm', 'node', ...(scope.tools ? ['shellcheck'] : []), ...(scope.build || scope.tools ? ['docker'] : [])];
  for (const command of commands) if (spawnSync('which', [command], { env, stdio: 'ignore' }).status !== 0) throw new Error(`LOCAL_CI_DEPENDENCY_MISSING: ${command}`);
  if (commands.includes('docker')) {
    const endpoint = await run(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { env, capture: true, timeout: 15000 });
    if (!endpoint.startsWith('unix://') && !endpoint.startsWith('npipe://')) throw new Error('LOCAL_DOCKER_REQUIRED');
  }
  const sourceSha = scope.build ? await run(['git', 'rev-parse', 'HEAD'], { env, capture: true, timeout: 30000 }) : '';
  if (scope.build && !SHA.test(sourceSha)) throw new Error('CI_SOURCE_SHA_INVALID');
  const name = `inspector-ci-${randomUUID().replaceAll('-', '')}`;
  let containerStarted = false, imageStarted = false, primary: unknown;
  const temporary = mkdtempSync(join(tmpdir(), 'inspector-local-ci-'));
  const source = join(temporary, 'source'); mkdirSync(source);
  const step: Step = async (command, cwd, capture = false) => {
    console.log(`本地 CI：${command.join(' ')}`);
    return run(command, { cwd, env: command[0] === 'docker' ? dockerEnv : env, timeout: deadline - performance.now(), capture });
  };
  try {
    await snapshot(source);
    env.NPM_CONFIG_USERCONFIG = '/dev/null'; env.NPM_CONFIG_GLOBALCONFIG = '/dev/null';
    await step(['pnpm', 'install', '--frozen-lockfile'], source);
    env.HOME = join(temporary, 'home'); mkdirSync(env.HOME);
    env.XDG_CONFIG_HOME = join(temporary, 'config'); mkdirSync(env.XDG_CONFIG_HOME);
    env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false'; env.WRANGLER_SEND_METRICS = 'false';
    if (scope.tools) await step(['pnpm', 'exec', 'vitest', 'run', 'scripts/tests'], source);
    if (scope.business) for (const command of ['check:sdk', 'typecheck', 'lint']) await step(['pnpm', command], source);
    const tests = ['pnpm', 'test'];
    if (!scope.business) tests.push('tests/workflow-contract.test.ts');
    else if (!scope.tools) tests.push('--exclude', 'tests/workflow-contract.test.ts', '--exclude', 'scripts/tests/**');
    else tests.push('--exclude', 'scripts/tests/**');
    if (mode === 'quick') { env.NODE_OPTIONS = `--experimental-strip-types --import=${join(source, 'scripts/offline-node.ts')}`; tests.push('--exclude', 'tests/mutation-http.test.ts'); }
    await step(tests, source); delete env.NODE_OPTIONS;
    if (scope.business && mode === 'full') await step(['pnpm', 'audit', '--prod', '--audit-level', 'high', '--registry=https://registry.npmjs.org'], source);
    if (scope.build) {
      const emptyEnv = join(temporary, 'empty.env'); writeFileSync(emptyEnv, '');
      await step(['pnpm', 'build:cloudflare', '--env', 'test'], source);
      await step(['node', 'node_modules/wrangler/bin/wrangler.js', 'versions', 'upload', '--env', 'test', '--dry-run', '--outdir', join(temporary, 'worker-package'), '--env-file', emptyEnv], source);
      await step(['node', '--experimental-strip-types', 'deploy/verify-worker.ts'], source);
    }
    if (scope.build) { imageStarted = true; await step(['docker', 'build', '--tag', name, '--build-arg', `SOURCE_REVISION=${sourceSha}`, '.'], source); }
    if (scope.tools) { containerStarted = true; await deploymentFixtures(step, source, dockerEnv, name); }
  } catch (error) { primary = error; }
  finally {
    try { await cleanupOwned(name, containerStarted, imageStarted); } catch (error) { if (primary) console.error(String(error)); else primary = error; }
    try { rmSync(temporary, { recursive: true, force: true }); } catch (error) { if (primary) console.error(String(error)); else primary = error; }
  }
  if (primary) throw primary;
  if (isCancelled()) throw new Error('LOCAL_CI_CANCELLED');
  console.log(`Inspector ${mode} CI 全部通过；未发布镜像或连接业务 API。`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('SIGTERM', cancel); process.on('SIGINT', cancel);
  try {
    const args = process.argv.slice(2); let mode = 'full', base: string | undefined;
    while (args.length) { const flag = args.shift(); if (flag === '--mode' && args.length) mode = args.shift()!; else if (flag === '--base' && args.length) base = args.shift(); else throw new Error('CI_ARGUMENT_INVALID'); }
    await verify(mode, base);
  } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
