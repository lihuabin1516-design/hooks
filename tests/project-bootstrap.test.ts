import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { bootstrapProject } from '../src/project-bootstrap.js';

let tempRoot: string;

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

async function initGitRepo(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  git(['init'], root);
  git(['config', 'user.name', 'Phase51 Fixture'], root);
  git(['config', 'user.email', 'phase51@example.invalid'], root);
  await fs.writeFile(path.join(root, 'README.md'), '# fixture\n', 'utf8');
  git(['add', 'README.md'], root);
  git(['commit', '-m', 'fixture'], root);
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-project-bootstrap-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('bootstrapProject', () => {
  test('creates the complete project hook state bundle', async () => {
    const result = await bootstrapProject({
      projectRoot: tempRoot,
      taskId: 'task-alpha',
      phase: 'shape',
      now: '2026-08-07T00:00:00.000Z'
    });
    const task = JSON.parse(await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'current-task.json'), 'utf8'));
    const agents = await fs.readFile(path.join(tempRoot, 'AGENTS.md'), 'utf8');
    const policy = JSON.parse(await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.json'), 'utf8'));
    const report = JSON.parse(await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'bootstrap-report.json'), 'utf8'));

    expect(result.schema).toBe('ccpanes.project-bootstrap-result.v1');
    expect(result.taskId).toBe('task-alpha');
    expect(task.phase).toBe('shape');
    expect(agents).toContain('<!-- ccpanes-hooks:begin -->');
    expect(await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.md'), 'utf8')).toContain('CC-Panes Project Policy Ledger');
    expect(policy).toEqual({ schema: 'ccpanes.project-policy.v1', rules: [] });
    expect(report.reportPath).toBe(result.reportPath);
    expect(report.agentsValidation.valid).toBe(true);
  });

  test('preserves existing AGENTS and policy ledger while refreshing task/report state', async () => {
    await fs.mkdir(path.join(tempRoot, '.ccpanes-task'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'AGENTS.md'), '# Existing\n\nKeep project rules.\n', 'utf8');
    await fs.writeFile(path.join(tempRoot, '.ccpanes-task', 'policy.md'), '# Existing Policy\n', 'utf8');

    const result = await bootstrapProject({
      projectRoot: tempRoot,
      taskId: 'task-beta',
      phase: 'build',
      now: '2026-08-07T00:00:00.000Z'
    });
    const agents = await fs.readFile(path.join(tempRoot, 'AGENTS.md'), 'utf8');
    const policyLedger = await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.md'), 'utf8');

    expect(result.policyLedger.changed).toBe(false);
    expect(agents).toContain('Keep project rules.');
    expect(agents).toContain('<!-- ccpanes-hooks:begin -->');
    expect(policyLedger).toBe('# Existing Policy\n');
  });

  test('bootstraps linked-worktree task metadata from Git topology', async () => {
    const mainRoot = path.join(tempRoot, 'hooks-main');
    const linkedRoot = path.join(tempRoot, 'hooks-linked');
    await initGitRepo(mainRoot);
    git(['worktree', 'add', '-b', 'phase51-linked', linkedRoot], mainRoot);

    await bootstrapProject({
      projectRoot: linkedRoot,
      taskId: 'task-linked',
      phase: 'shape',
      now: '2026-08-10T00:00:00.000Z'
    });
    const written = JSON.parse(
      await fs.readFile(path.join(linkedRoot, '.ccpanes-task', 'current-task.json'), 'utf8')
    );

    expect(written.projectPath).toBe(mainRoot);
    expect(written.mainRepoRoot).toBe(mainRoot);
    expect(written.worktreeRoot).toBe(linkedRoot);
    expect(written.branch).toBe('phase51-linked');
    expect(written.head).toBe(git(['rev-parse', 'HEAD'], linkedRoot));
    expect(written.notes).toBe('project bootstrapped by CC-Panes hooks');
  });
});
