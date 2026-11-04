import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, ZERO, localEnv, run } from '../test-push';

const dirs: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'inspector-push-')); dirs.push(root);
  const repo = join(root, 'repo'), remote = join(root, 'remote.git'); mkdirSync(repo);
  const env = { ...localEnv(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => { const result = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8', timeout: 15000 }); if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim(); };
  const helper = (operation: string) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/test-push.ts', operation], { cwd: repo, env, encoding: 'utf8', timeout: 20000 });
  git('init', '-q', '--bare', remote); git('init', '-q', '-b', 'feature/fixture'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('remote', 'add', 'origin', remote);
  mkdirSync(join(repo, 'scripts')); mkdirSync(join(repo, '.githooks'));
  copyFileSync(join(ROOT, 'scripts/test-push.ts'), join(repo, 'scripts/test-push.ts')); copyFileSync(join(ROOT, '.githooks/pre-push'), join(repo, '.githooks/pre-push'));
  const marker = join(root, 'checks');
  const ci = (outcome: string) => writeFileSync(join(repo, 'scripts/verify-local.ts'), `import { appendFileSync, writeFileSync } from 'node:fs';\nif (process.argv[2] !== '--mode' || process.argv[3] !== 'full' || process.argv[4] !== '--base' || process.argv[5].length !== 40) process.exit(2);\nappendFileSync(${JSON.stringify(marker)}, 'check\\n');\n${outcome === 'fail' ? 'process.exit(1);' : outcome === 'change' ? "writeFileSync('changed', 'dirty');" : ''}\n`);
  ci('pass'); git('add', '.'); git('commit', '-qm', 'base'); expect(helper('install').status).toBe(0);
  return { root, repo, git, helper, ci, marker, env };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('Test push gate', () => {
  it('allows ordinary pushes, rejects direct Test push and checks once for authorized push', () => {
    const { repo, git, helper, marker, env } = fixture();
    git('push', 'origin', 'HEAD:refs/heads/feature/fixture');
    expect(spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/test'], { cwd: repo, env }).status).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(helper('push').status).toBe(0); expect(readFileSync(marker, 'utf8')).toBe('check\n');
    expect(git('ls-remote', 'origin', 'refs/heads/test').split(/\s+/)[0]).toBe(git('rev-parse', 'HEAD'));
    expect(spawnSync('git', ['push', 'origin', ':refs/heads/test'], { cwd: repo, env }).status).not.toBe(0);
  });
  it.each(['fail', 'change'])('does not push when validation %s', outcome => {
    const { git, helper, ci } = fixture(); ci(outcome); git('add', '.'); git('commit', '-qm', 'change');
    expect(helper('push').status).not.toBe(0); expect(git('ls-remote', 'origin', 'refs/heads/test')).toBe('');
  });
  it('rejects dirty source and preserves another hook manager', () => {
    const { repo, git, helper, marker } = fixture(); writeFileSync(join(repo, 'dirty'), 'x'); expect(helper('push').status).not.toBe(0); expect(existsSync(marker)).toBe(false);
    git('config', 'core.hooksPath', '/fixture/hooks'); expect(helper('install').status).not.toBe(0); expect(git('config', '--get', 'core.hooksPath')).toBe('/fixture/hooks');
  });
  it('does not hide an existing symlinked hook', () => {
    const { repo, git, helper } = fixture();
    git('config', '--unset', 'core.hooksPath');
    symlinkSync('/fixture/existing-hook', join(repo, '.git/hooks/pre-push'));
    expect(helper('install').status).not.toBe(0);
    expect(spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repo }).status).toBe(1);
  });
  it('rejects stale proof and force push', () => {
    const { repo, git, helper, env } = fixture(); expect(helper('push').status).toBe(0); const old = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'new'), 'x'); git('add', '.'); git('commit', '-qm', 'new'); const head = git('rev-parse', 'HEAD');
    expect(spawnSync('git', ['push', 'origin', 'HEAD:refs/heads/test'], { cwd: repo, env: { ...env, JIANIFY_TEST_LOCAL_CI_PROOF: `${head}:${ZERO}` } }).status).not.toBe(0);
    expect(helper('push').status).toBe(0); git('reset', '--hard', old);
    expect(spawnSync('git', ['push', '--force', 'origin', 'HEAD:refs/heads/test'], { cwd: repo, env: { ...env, JIANIFY_TEST_LOCAL_CI_PROOF: `${old}:${head}` } }).status).not.toBe(0);
  });
});
describe('safe process execution', () => {
  it('excludes credentials and rejects authenticated proxies', () => {
    expect(localEnv({ PATH: '/bin', OPENAI_API_KEY: 'secret', HTTPS_PROXY: 'http://localhost:7890' })).toEqual({ PATH: '/bin', HTTPS_PROXY: 'http://localhost:7890', CI: 'true', NEXT_TELEMETRY_DISABLED: '1' });
    expect(() => localEnv({ HTTPS_PROXY: 'http://user:pass@localhost:7890' })).toThrow('LOCAL_PROXY_AUTH_FORBIDDEN');
  });
  it('fails expired, failing and uncooperative commands', async () => {
    await expect(run([process.execPath, '-e', 'process.exit(0)'], { timeout: 0 })).rejects.toThrow('COMMAND_TIMEOUT');
    await expect(run([process.execPath, '-e', 'process.exit(3)'], { timeout: 1000 })).rejects.toThrow('COMMAND_FAILED');
    await expect(run([process.execPath, '-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { timeout: 200, grace: 100 })).rejects.toThrow('COMMAND_TIMEOUT');
  });
});

describe('process tree cleanup', () => {
  it('kills descendants that ignore termination after a timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inspector-child-')); dirs.push(dir);
    const marker = join(dir, 'survived');
    const descendant = `process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'alive'),1200);setInterval(()=>{},1000)`;
    const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
    await expect(run([process.execPath, '-e', parent], { timeout: 350, grace: 100 })).rejects.toThrow('COMMAND_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(existsSync(marker)).toBe(false);
  }, 5000);
  it('kills descendants and fails when the runner is cancelled', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inspector-cancel-')); dirs.push(dir);
    const ready = join(dir, 'ready'), marker = join(dir, 'survived'), script = join(dir, 'runner.mts');
    const descendant = `require('fs').writeFileSync(${JSON.stringify(ready)},'ready');process.on('SIGTERM',()=>{});setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'alive'),1500);setInterval(()=>{},1000)`;
    const parent = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});setInterval(()=>{},1000)`;
    writeFileSync(script, `import {run,cancel} from ${JSON.stringify(`file://${join(ROOT, 'scripts/test-push.ts')}`)};\nprocess.on('SIGTERM',cancel);\ntry { await run([process.execPath,'-e',${JSON.stringify(parent)}],{grace:100}); } catch { process.exitCode=1; }\n`);
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['--experimental-strip-types', script], { stdio: 'ignore' });
    try {
      for (let i = 0; i < 100 && !existsSync(ready); i++) await new Promise(resolve => setTimeout(resolve, 20));
      expect(existsSync(ready)).toBe(true);
      const closed = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      child.kill('SIGTERM');
      expect(await closed).toBe(1);
      await new Promise(resolve => setTimeout(resolve, 1700));
      expect(existsSync(marker)).toBe(false);
    } finally { if (child.exitCode === null) child.kill('SIGKILL'); }
  }, 7000);
});

describe('quick and package store isolation', () => {
  it('fails quick mode even if application code catches a network error', () => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--import', join(ROOT, 'scripts/offline-node.ts'), '-e', "try { require('node:net').connect(1, '127.0.0.1'); } catch {}"], { timeout: 5000 });
    expect(result.status).toBe(1);
  });
  it('preserves PNPM_HOME and the package store used by Actions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inspector-pnpm-')); dirs.push(dir);
    const home = join(dir, 'home'), pnpmHome = join(dir, 'setup-pnpm/node_modules/.bin');
    mkdirSync(home); mkdirSync(pnpmHome, { recursive: true });
    const input = { PATH: process.env.PATH, HOME: home, PNPM_HOME: pnpmHome };
    const invoke = (env: NodeJS.ProcessEnv) => spawnSync('pnpm', ['store', 'path', '--silent'], { cwd: dir, env, encoding: 'utf8', timeout: 30000 });
    const expected = invoke(input as unknown as NodeJS.ProcessEnv), actual = invoke(localEnv(input));
    expect(expected.status).toBe(0); expect(actual.status).toBe(0);
    expect(actual.stdout.trim()).toBe(expected.stdout.trim()); expect(actual.stdout.trim().startsWith(`${pnpmHome}/`)).toBe(true);
  }, 30000);
});
