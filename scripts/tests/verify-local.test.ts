import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupOwned, scopeForPaths, snapshot, verificationScope } from '../verify-local';

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'inspector-snapshot-')); directories.push(root);
  const repo = join(root, 'repo'), copy = join(root, 'copy'); mkdirSync(repo); mkdirSync(copy);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  return { root, repo, copy, git };
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
describe('isolated local verification', () => {
  it('copies sources and templates without secrets or git metadata', async () => {
    const { repo, copy, git } = fixture();
    for (const name of ['.env.local', '.env.example', '.dev.vars', '.dev.vars.test', '.dev.vars.example', 'source.ts']) writeFileSync(join(repo, name), 'fixture');
    mkdirSync(join(repo, 'nested')); writeFileSync(join(repo, 'nested/.dev.vars.test'), 'secret');
    git('add', '-f', '.'); await snapshot(copy, repo);
    expect(existsSync(join(copy, '.env.local'))).toBe(false);
    expect(existsSync(join(copy, '.dev.vars'))).toBe(false);
    expect(existsSync(join(copy, '.dev.vars.test'))).toBe(false);
    expect(existsSync(join(copy, '.dev.vars.example'))).toBe(false);
    expect(existsSync(join(copy, 'nested/.dev.vars.test'))).toBe(false);
    expect(readFileSync(join(copy, '.env.example'), 'utf8')).toBe('fixture');
    expect(existsSync(join(copy, 'source.ts'))).toBe(true);
    expect(existsSync(join(copy, '.git'))).toBe(false);
  });
  it('rejects symlinks including dangling links', async () => {
    const { root, repo, copy, git } = fixture();
    symlinkSync(join(root, 'missing'), join(repo, 'outside')); git('add', 'outside');
    await expect(snapshot(copy, repo)).rejects.toThrow('CI_SOURCE_SYMLINK_FORBIDDEN');
  });
  it('rejects a symlinked parent even when its target exists', async () => {
    const { root, repo, copy } = fixture();
    const external = join(root, 'external'); mkdirSync(external); writeFileSync(join(external, 'secret'), 'private');
    symlinkSync(external, join(repo, 'link'));
    await expect(snapshot(copy, repo)).rejects.toThrow('CI_SOURCE_SYMLINK_FORBIDDEN');
  });
  it('selects affected areas and defaults to full on uncertain baselines', async () => {
    const all = { business: true, tools: true, build: true };
    expect(scopeForPaths('quick', null)).toEqual({ business: true, tools: false, build: false });
    expect(scopeForPaths('full', null)).toEqual(all);
    expect(scopeForPaths('full', ['README.md'])).toEqual({ business: false, tools: false, build: false });
    expect(scopeForPaths('full', ['app/page.tsx'])).toEqual({ business: true, tools: false, build: false });
    for (const path of ['Dockerfile', 'wrangler.jsonc', 'open-next.config.ts', 'deploy/compose.yml']) expect(scopeForPaths('full', [path]).build).toBe(true);
    const { repo, git } = fixture(); writeFileSync(join(repo, 'file'), 'base'); git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    expect(await verificationScope('full', base, repo)).toEqual({ business: false, tools: false, build: false });
    writeFileSync(join(repo, 'file'), 'dirty'); expect(await verificationScope('full', base, repo)).toEqual(all);
    await expect(verificationScope('full', 'HEAD^', repo)).rejects.toThrow('CI_BASE_INVALID');
  });
  it('expands all checks for a non-ancestor baseline', async () => {
    const { repo, git } = fixture();
    writeFileSync(join(repo, 'file'), 'base'); git('add', '.'); git('commit', '-qm', 'base');
    const ancestor = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'candidate'); writeFileSync(join(repo, 'file'), 'candidate'); git('commit', '-qam', 'candidate');
    git('checkout', '-qb', 'diverged', ancestor); writeFileSync(join(repo, 'file'), 'diverged'); git('commit', '-qam', 'diverged');
    const base = git('rev-parse', 'HEAD'); git('checkout', '-q', 'candidate');
    expect(await verificationScope('full', base, repo)).toEqual({ business: true, tools: true, build: true });
  });
  it('treats inspect and removal failures as cleanup failures', async () => {
    const fail = async () => { throw new Error('failure'); };
    await expect(cleanupOwned('owned', true, false, fail)).rejects.toThrow('LOCAL_CI_CLEANUP_FAILED');
    let calls = 0;
    await expect(cleanupOwned('owned', true, false, async () => { if (++calls === 1) return 'id'; throw new Error('failure'); })).rejects.toThrow('LOCAL_CI_CLEANUP_FAILED');
    expect(calls).toBe(2);
  });
});

describe('actual selected commands', () => {
  function runFixture(change: string, failCleanup = false) {
    const { root, repo, git } = fixture();
    const bin = join(root, 'bin'), log = join(root, 'commands'); mkdirSync(bin);
    mkdirSync(join(repo, 'scripts')); mkdirSync(join(repo, 'deploy')); mkdirSync(join(repo, '.githooks'));
    for (const name of ['verify-local.ts', 'test-push.ts']) {
      writeFileSync(join(repo, 'scripts', name), readFileSync(join(process.cwd(), 'scripts', name)));
    }
    writeFileSync(join(repo, 'deploy/compose.yml'), 'fixture'); writeFileSync(join(repo, 'deploy/runtime.env.example'), 'fixture');
    writeFileSync(join(repo, '.githooks/pre-push'), '#!/bin/sh\n');
    git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    mkdirSync(join(repo, ...change.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(repo, change), 'changed'); git('add', '.'); git('commit', '-qm', 'change');
    const shell = (name: string, body: string) => {
      const path = join(bin, name); writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' '${name} '"$*" >> '${log}'\n${body}\n`, { mode: 0o755 });
    };
    shell('pnpm', 'exit 0'); shell('shellcheck', 'exit 0');
    writeFileSync(join(bin, 'node'), `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(log + '.node')}, JSON.stringify(process.argv.slice(2)) + '\\n');\nif (process.argv[2] === 'node_modules/wrangler/bin/wrangler.js' && (process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV !== 'false' || !fs.existsSync(process.argv[11]) || fs.statSync(process.argv[11]).size !== 0)) process.exit(1);\n`, { mode: 0o755 });
    shell('docker', `case "$*" in\n  'context inspect'*) echo unix:///fixture ;;\n  'compose '*test*) echo '{"name":"memoia-inspector-test"}' ;;\n  'compose '*online*) echo '{"name":"memoia-inspector-online"}' ;;\n  'build '*) ${failCleanup ? 'exit 42' : 'exit 0'} ;;\n  'image ls '*) ${failCleanup ? 'exit 43' : 'exit 0'} ;;\nesac\nexit 0`);
    const result = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/verify-local.ts', '--mode', 'full', '--base', base], {
      cwd: repo, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8', timeout: 30000,
    });
    const commands = existsSync(log) ? readFileSync(log, 'utf8') : '';
    const nodeCalls = existsSync(log + '.node') ? readFileSync(log + '.node', 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]) : [];
    return { result, commands, nodeCalls };
  }
  it('runs business, tool and build commands only for their selected scopes', () => {
    const business = runFixture('app/page.tsx');
    expect(business.result.status, business.result.stderr).toBe(0);
    expect(business.commands).toContain('pnpm typecheck'); expect(business.commands).toContain('pnpm audit ');
    expect(business.commands).not.toContain('docker build'); expect(business.commands).not.toContain('pnpm exec vitest');
    const tools = runFixture('scripts/changed.ts');
    expect(tools.result.status, tools.result.stderr).toBe(0);
    expect(tools.commands).toContain('pnpm exec vitest run scripts/tests'); expect(tools.commands).toContain('pnpm test tests/workflow-contract.test.ts');
    expect(tools.commands).not.toContain('pnpm typecheck'); expect(tools.commands).not.toContain('docker build');
    const build = runFixture('Dockerfile');
    expect(build.result.status, build.result.stderr).toBe(0);
    expect(build.commands).toContain('pnpm build:cloudflare --env test');
    const wrangler = build.nodeCalls.find(args => args[0] === 'node_modules/wrangler/bin/wrangler.js');
    expect(wrangler).toBeDefined();
    expect(wrangler!.slice(0, 7)).toEqual(['node_modules/wrangler/bin/wrangler.js', 'versions', 'upload', '--env', 'test', '--dry-run', '--outdir']);
    expect(wrangler![8]).toBe('--env-file');
    expect(wrangler![7]).toMatch(/\/worker-package$/);
    expect(wrangler![9]).toBe(join(wrangler![7], '..', 'empty.env'));
    expect(wrangler).toHaveLength(10);
    expect(build.commands).toContain('docker build'); expect(build.commands).toContain('pnpm typecheck');
  }, 30000);
  it('passes the dry-run arguments through the installed Wrangler CLI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wrangler-help-')); directories.push(dir);
    const envFile = join(dir, 'empty.env'); writeFileSync(envFile, '');
    const result = spawnSync(process.execPath, [join(process.cwd(), 'node_modules/wrangler/bin/wrangler.js'), 'versions', 'upload', '--env', 'test', '--dry-run', '--outdir', join(dir, 'worker-package'), '--env-file', envFile, '--help'], {
      env: { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: dir, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_SEND_METRICS: 'false' } as unknown as NodeJS.ProcessEnv,
      encoding: 'utf8', timeout: 10000,
    });
    expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('--env-file');
  });
  it('reports the primary failure even when owned resource cleanup also fails', () => {
    const { result } = runFixture('Dockerfile', true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('LOCAL_CI_CLEANUP_FAILED');
    expect(result.stderr).toContain('COMMAND_FAILED: docker (43)');
    expect(result.stderr.trim().endsWith('COMMAND_FAILED: docker (42)')).toBe(true);
  }, 30000);
});
