import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

type Job = { if?: string; environment?: { name?: string } | string; needs?: string[] };
type Workflow = {
  on: { push?: { branches?: string[]; tags?: string[] }; pull_request?: { branches?: string[] } };
  jobs: Record<string, Job>;
};

function workflow(name: string): Workflow {
  const path = resolve(__dirname, '../.github/workflows', name);
  return YAML.parse(readFileSync(path, 'utf8')) as Workflow;
}

describe('Test and Online release boundaries', () => {
  const testWorkflow = workflow('publish.yml');
  const onlineWorkflow = workflow('deploy-online.yml');

  it('publishes Test only from test, not from release tags', () => {
    expect(testWorkflow.on.push?.branches).toContain('test');
    expect(testWorkflow.on.push?.tags).toBeUndefined();
    expect(testWorkflow.jobs['publish-test'].needs).toContain('verify');
    expect(testWorkflow.jobs['deploy-test'].environment).toMatchObject({ name: 'test' });
    expect(testWorkflow.jobs['deploy-test'].needs).toContain('publish-test');
    expect(readFileSync(resolve(__dirname, '../.github/workflows/publish.yml'), 'utf8')).toContain('INSPECTOR_STAGE=test bash');
  });

  it('prepares a Release candidate before tag promotion and approval', () => {
    expect(onlineWorkflow.on.push).toEqual({ branches: ['release'], tags: ['v*'] });
    expect(onlineWorkflow.jobs['publish-candidate'].if).toContain("github.ref == 'refs/heads/release'");
    expect(onlineWorkflow.jobs['promote-tag'].if).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(onlineWorkflow.jobs['deploy-online'].needs).toContain('promote-tag');
    expect(onlineWorkflow.jobs['deploy-online'].environment).toMatchObject({ name: 'online' });
    expect(onlineWorkflow.jobs['deploy-online'].if).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(readFileSync(resolve(__dirname, '../.github/workflows/deploy-online.yml'), 'utf8')).toContain('INSPECTOR_STAGE=online bash');
    for (const [name, job] of Object.entries(onlineWorkflow.jobs)) {
      if (name !== 'deploy-online') expect(job.environment).toBeUndefined();
    }
  });
});
