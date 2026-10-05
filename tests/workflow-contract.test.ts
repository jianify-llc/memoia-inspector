import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

type Job = { if?: string; environment?: { name?: string } | string; needs?: string[] | string; uses?: string; 'runs-on'?: string; 'timeout-minutes'?: number; strategy?: { matrix: { include: { arch: string; runner: string }[] } }; steps?: { id?: string; run?: string; uses?: string; with?: Record<string, unknown> }[] };
type Workflow = {
  on: {
    push?: { branches?: string[]; tags?: string[] };
    pull_request?: { branches?: string[] };
    workflow_call?: unknown;
    workflow_dispatch?: unknown;
    merge_group?: unknown;
  };
  jobs: Record<string, Job>;
};

function workflow(name: string): Workflow {
  const path = resolve(__dirname, '../.github/workflows', name);
  return YAML.parse(readFileSync(path, 'utf8')) as Workflow;
}

describe('Test and Online release boundaries', () => {
  const verifyWorkflow = workflow('verify.yml');
  const testWorkflow = workflow('deploy-test.yml');
  const onlineWorkflow = workflow('deploy-online.yml');

  it('bounds every actual runner and rejects wrong manual refs before registry writes', () => {
    for (const file of [verifyWorkflow, testWorkflow, onlineWorkflow]) {
      for (const job of Object.values(file.jobs)) {
        if (!job['runs-on']) continue;
        expect(job['timeout-minutes']).toBeGreaterThan(0);
        expect(job['timeout-minutes']).toBeLessThanOrEqual(75);
      }
    }
    const directory = mkdtempSync(resolve(tmpdir(), 'inspector-selector-'));
    try {
      const git = resolve(directory, 'git');
      writeFileSync(git, '#!/bin/sh\nprintf "%s\\trefs/heads/test\\n" "$FIXTURE_HEAD"\n');
      chmodSync(git, 0o755);
      const sha = 'd'.repeat(40);
      const steps = testWorkflow.jobs['publish-test'].steps!;
      const guard = steps.findIndex(step => step.run?.includes('Select the Test branch explicitly'));
      expect(guard).toBe(1);
      const script = steps[guard].run!;
      for (const [ref, head, accepted] of [
        ['refs/heads/test', sha, true], ['refs/heads/main', sha, false], ['refs/heads/test', 'a'.repeat(40), false],
      ] as const) {
        const result = spawnSync('bash', ['-c', script], {
          env: { NODE_ENV: "test", PATH: `${directory}:/usr/bin:/bin`, SELECTED_REF: ref, FIXTURE_HEAD: head, GITHUB_SHA: sha },
          encoding: 'utf8', timeout: 5000,
        });
        expect(result.status === 0).toBe(accepted);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('cloud workflows only build and deliver while local verification owns checks', () => {
    expect(verifyWorkflow.on.push).toBeUndefined();
    expect(verifyWorkflow.on.pull_request).toEqual({ branches: ['main'] });
    expect(verifyWorkflow.on).toHaveProperty('merge_group');
    expect(verifyWorkflow.on.workflow_call).toBeUndefined();
    expect(verifyWorkflow.jobs.verify.environment).toBeUndefined();
    const build = verifyWorkflow.jobs.verify.steps!.find(step => step.uses?.includes('docker/build-push-action'))!;
    expect(build.with?.push).toBe(false);
    expect(build.with?.platforms).toBe('linux/amd64');
    const checkout = verifyWorkflow.jobs.verify.steps![0];
    expect(checkout.with?.ref).toBe('${{ github.sha }}');
    for (const file of ['verify.yml', 'deploy-test.yml', 'deploy-online.yml']) {
      const source = readFileSync(resolve(__dirname, '../.github/workflows', file), 'utf8');
      expect(source).not.toMatch(/verify_local|pnpm (?:test|lint|typecheck|audit|check:sdk|build)|setup-node|pnpm\/action-setup/);
    }
    const local = readFileSync(resolve(__dirname, '../scripts/verify_local.py'), 'utf8');
    for (const check of ['typecheck', 'lint', 'docker', 'audit', 'tests/deploy-inspector.test.sh']) expect(local).toContain(check);
    expect(local).not.toContain('15.5.26');
  });

  it('publishes Test only from test, not from release tags', () => {
    expect(testWorkflow.on).toEqual({ workflow_dispatch: null });
    expect(Object.keys(testWorkflow.jobs)).toEqual(['publish-test', 'deploy-test']);
    expect(testWorkflow.on.push?.tags).toBeUndefined();
    expect(testWorkflow.jobs['publish-test'].needs).toBeUndefined();
    expect(testWorkflow.jobs['deploy-test'].environment).toMatchObject({ name: 'test' });
    expect(testWorkflow.jobs['deploy-test'].needs).toContain('publish-test');
    expect(readFileSync(resolve(__dirname, '../.github/workflows/deploy-test.yml'), 'utf8')).toContain('INSPECTOR_STAGE=test bash');
  });

  it('builds only a release-HEAD tag and deploys its validated digest after approval', () => {
    expect(onlineWorkflow.on).toEqual({ push: { tags: ['v*'] } });
    expect(onlineWorkflow.jobs.verify).toBeUndefined();
    expect(onlineWorkflow.jobs['build-platforms'].needs).toBe('validate-tag');
    expect(onlineWorkflow.jobs['build-online'].needs).toBe('build-platforms');
    expect(onlineWorkflow.jobs['deploy-online'].needs).toBe('build-online');
    expect(onlineWorkflow.jobs['deploy-online'].environment).toMatchObject({ name: 'online' });
    const source = readFileSync(resolve(__dirname, '../.github/workflows/deploy-online.yml'), 'utf8');
    expect(source).toContain('git ls-remote origin refs/heads/release');
    expect(source).toContain('version="$IMAGE:$GITHUB_REF_NAME"');
    expect(source).toContain('docker buildx imagetools create --tag "$version"');
    expect(source).toContain("DIGEST: ${{ needs.build-online.outputs.digest }}");
    expect(source).toContain('INSPECTOR_STAGE=online bash');
    for (const [name, job] of Object.entries(onlineWorkflow.jobs)) {
      if (name !== 'deploy-online') expect(job.environment).toBeUndefined();
    }
  });

  it('builds Test only on AMD64 and Online independently on native runners', () => {
    const build = testWorkflow.jobs['publish-test'].steps!.find(step => step.uses?.includes('docker/build-push-action'))!;
    expect(build.with?.platforms).toBe('linux/amd64');
    expect(build.with?.['cache-to']).toBe('type=gha,scope=test-amd64,mode=min');
    expect(onlineWorkflow.jobs['build-platforms'].strategy?.matrix.include).toEqual([
      { arch: 'amd64', runner: 'ubuntu-24.04' }, { arch: 'arm64', runner: 'ubuntu-24.04-arm' },
    ]);
    const native = onlineWorkflow.jobs['build-platforms'].steps!.find(step => step.uses?.includes('docker/build-push-action'))!;
    expect(native.with?.outputs).toContain('push-by-digest=true');
    expect(native.with?.['cache-from']).toBe('type=gha,scope=online-${{ matrix.arch }}');
    expect(native.with?.['cache-to']).toBe('type=gha,scope=online-${{ matrix.arch }},mode=max');
    for (const name of ['deploy-test.yml', 'deploy-online.yml', 'verify.yml']) {
      const source = readFileSync(resolve(__dirname, '../.github/workflows', name), 'utf8');
      expect(source).not.toContain('setup-qemu');
      expect(source).not.toContain('15.5.26');
      for (const job of Object.values(workflow(name).jobs)) {
        for (const step of job.steps ?? []) {
          if (step.uses && !step.uses.startsWith('./')) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
          if (step.uses?.includes('actions/checkout')) expect(step.with?.['persist-credentials']).toBe(false);
        }
      }
    }
    const upload = onlineWorkflow.jobs['build-platforms'].steps!.find(step => step.uses?.includes('actions/upload-artifact'))!;
    expect(upload.with?.overwrite).toBe(true);
    const source = readFileSync(resolve(__dirname, '../.github/workflows/deploy-online.yml'), 'utf8');
    expect(source).not.toContain('.schema');
    expect(source).not.toContain('schema=');
    expect(source).not.toContain('|| true');
  });

  it('executes manifest assembly and rejects unknown registry state or identity mismatch', () => {
    const script = onlineWorkflow.jobs['build-online'].steps!.find(step => step.id === 'identity')!.run!;
    for (const scenario of ['new', 'existing', 'attested', 'registry_error', 'wrong_sha', 'wrong_manifest', 'missing_arch']) {
      const directory = mkdtempSync(resolve(tmpdir(), 'inspector-manifest-'));
      try {
        const platforms = resolve(directory, 'platforms');
        // 每个夹具只写本次临时目录，所有 Docker 操作由精确命令 mock。
        mkdirSync(platforms);
        for (const [arch, digit] of [['amd64', 'a'], ['arm64', 'b']]) {
          writeFileSync(resolve(platforms, arch + '.json'), JSON.stringify({
            arch, digest: 'sha256:' + digit.repeat(64), source_commit: scenario === 'wrong_sha' && arch === 'arm64' ? 'f'.repeat(40) : 'd'.repeat(40),
          }));
        }
        const docker = resolve(directory, 'docker');
        writeFileSync(docker, '#!' + process.execPath + '\n' + `
const fs = require('node:fs'), path = require('node:path');
const root = process.env.RUNNER_TEMP, scenario = process.env.SCENARIO, args = process.argv.slice(2);
const image = 'ghcr.io/fixture/inspector', version = image + ':v1.2.3', created = path.join(root, 'created');
function manifests(digits) {
  return { manifests: digits.map(([arch, digit]) => ({ platform: { os: 'linux', architecture: arch }, digest: 'sha256:' + digit.repeat(64) })) };
}
if (args[2] === 'create') {
  const expected = ['buildx','imagetools','create','--tag',version,image+'@sha256:'+'a'.repeat(64),image+'@sha256:'+'b'.repeat(64)];
  if (JSON.stringify(args) !== JSON.stringify(expected)) process.exit(1);
  fs.writeFileSync(created, '');
} else if (args.includes('--format')) console.log(JSON.stringify({digest:'sha256:'+'c'.repeat(64)}));
else if (args.includes('--raw')) {
  if (args[3] === image+'@sha256:'+'c'.repeat(64)) {
    const digits = [['amd64',scenario === 'attested' ? 'd' : 'a'],['arm64','b']];
    if (scenario === 'wrong_manifest') digits[0][1] = 'f';
    if (scenario === 'missing_arch') digits.pop();
    console.log(JSON.stringify(manifests(digits)));
  } else if (scenario === 'attested' && args[3] === image+'@sha256:'+'a'.repeat(64)) console.log(JSON.stringify(manifests([['amd64','d']])));
  else process.exit(1);
} else if (args[2] === 'inspect' && args[3] === version) {
  if (scenario === 'registry_error') { console.error('ERROR: registry connection timed out'); process.exit(1); }
  if (scenario !== 'existing' && !fs.existsSync(created)) { console.error('ERROR: '+version+': not found'); process.exit(1); }
} else process.exit(1);
`);
        chmodSync(docker, 0o755);
        const result = spawnSync('bash', ['-c', script], {
          env: { NODE_ENV: 'test', PATH: directory + ':' + process.env.PATH, RUNNER_TEMP: directory, IMAGE: 'ghcr.io/fixture/inspector', GITHUB_REF_NAME: 'v1.2.3',
            GITHUB_SHA: 'd'.repeat(40), GITHUB_OUTPUT: resolve(directory, 'output'), GITHUB_STEP_SUMMARY: resolve(directory, 'summary'), SCENARIO: scenario },
          encoding: 'utf8', timeout: 10000,
        });
        expect(result.status === 0, result.stderr).toBe(['new', 'existing', 'attested'].includes(scenario));
        if (result.status === 0) expect(readFileSync(resolve(directory, 'output'), 'utf8')).toContain('digest=sha256:' + 'c'.repeat(64));
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });
});
