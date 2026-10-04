import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

type Job = { if?: string; environment?: { name?: string } | string; needs?: string[] | string; uses?: string; 'runs-on'?: string; 'timeout-minutes'?: number; steps?: { run?: string }[] };
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

  it('bounds every actual runner and rejects wrong manual refs before Verify', () => {
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
      const steps = testWorkflow.jobs['validate-test'].steps!;
      const script = steps[steps.length - 1].run!;
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

  it('runs the same code checks for main, Test and Online without building Docker', () => {
    expect(verifyWorkflow.on.push).toBeUndefined();
    expect(verifyWorkflow.on.pull_request).toEqual({ branches: ['main'] });
    expect(verifyWorkflow.on).toHaveProperty('workflow_call');
    expect(verifyWorkflow.on).toHaveProperty('merge_group');
    expect(testWorkflow.jobs.verify.uses).toBe('./.github/workflows/verify.yml');
    expect(onlineWorkflow.jobs.verify.uses).toBe('./.github/workflows/verify.yml');
    expect(verifyWorkflow.jobs.verify.environment).toBeUndefined();
    const source = readFileSync(resolve(__dirname, '../.github/workflows/verify.yml'), 'utf8');
    expect(source).toContain('python3 scripts/verify_local.py');
    const local = readFileSync(resolve(__dirname, '../scripts/verify_local.py'), 'utf8');
    for (const check of ['check:sdk', 'typecheck', 'lint', 'build', 'audit', 'tests/deploy-inspector.test.sh']) {
      expect(local).toContain(check);
    }
    expect(source).not.toContain('docker/build-push-action');
    expect(source).not.toContain('secrets.');
  });

  it('publishes Test only from test, not from release tags', () => {
    expect(testWorkflow.on).toEqual({ workflow_dispatch: null });
    expect(testWorkflow.jobs.verify.needs).toBe('validate-test');
    expect(testWorkflow.on.push?.tags).toBeUndefined();
    expect(testWorkflow.jobs['publish-test'].needs).toContain('verify');
    expect(testWorkflow.jobs['deploy-test'].environment).toMatchObject({ name: 'test' });
    expect(testWorkflow.jobs['deploy-test'].needs).toContain('publish-test');
    expect(readFileSync(resolve(__dirname, '../.github/workflows/deploy-test.yml'), 'utf8')).toContain('INSPECTOR_STAGE=test bash');
  });

  it('builds only a release-HEAD tag and deploys its validated digest after approval', () => {
    expect(onlineWorkflow.on).toEqual({ push: { tags: ['v*'] } });
    expect(onlineWorkflow.jobs.verify.needs).toBe('validate-tag');
    expect(onlineWorkflow.jobs['build-online'].needs).toBe('verify');
    expect(onlineWorkflow.jobs['deploy-online'].needs).toBe('build-online');
    expect(onlineWorkflow.jobs['deploy-online'].environment).toMatchObject({ name: 'online' });
    const source = readFileSync(resolve(__dirname, '../.github/workflows/deploy-online.yml'), 'utf8');
    expect(source).toContain('git ls-remote origin refs/heads/release');
    expect(source).toContain('ghcr.io/${{ github.repository }}:${{ github.ref_name }}');
    expect(source).toContain("DIGEST: ${{ needs.build-online.outputs.digest }}");
    expect(source).toContain('INSPECTOR_STAGE=online bash');
    for (const [name, job] of Object.entries(onlineWorkflow.jobs)) {
      if (name !== 'deploy-online') expect(job.environment).toBeUndefined();
    }
  });
});
