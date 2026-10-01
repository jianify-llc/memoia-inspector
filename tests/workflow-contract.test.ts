import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

type Job = { if?: string; environment?: { name?: string } | string; needs?: string[]; uses?: string };
type Workflow = {
  on: {
    push?: { branches?: string[]; tags?: string[] };
    pull_request?: { branches?: string[] };
    workflow_call?: unknown;
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

  it('runs the same code checks for main, Test and Online without building Docker', () => {
    expect(verifyWorkflow.on.push).toEqual({ branches: ['main'] });
    expect(verifyWorkflow.on.pull_request).toEqual({ branches: ['main', 'test', 'release'] });
    expect(verifyWorkflow.on).toHaveProperty('workflow_call');
    expect(verifyWorkflow.on).toHaveProperty('merge_group');
    expect(testWorkflow.jobs.verify.uses).toBe('./.github/workflows/verify.yml');
    expect(onlineWorkflow.jobs.verify.uses).toBe('./.github/workflows/verify.yml');
    expect(verifyWorkflow.jobs.verify.environment).toBeUndefined();
    const source = readFileSync(resolve(__dirname, '../.github/workflows/verify.yml'), 'utf8');
    for (const check of ['pnpm test', 'pnpm typecheck', 'pnpm lint', 'pnpm build', 'pnpm audit', 'tests/deploy-inspector.test.sh']) {
      expect(source).toContain(check);
    }
    expect(source).not.toContain('docker/build-push-action');
    expect(source).not.toContain('secrets.');
  });

  it('publishes Test only from test, not from release tags', () => {
    expect(testWorkflow.on).toEqual({ push: { branches: ['test'] } });
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
