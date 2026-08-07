import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { scanWorkspaceTasks } from '../src/workspace-scan.js';
import { writeCurrentTaskAtomic } from '../src/current-task.js';
import type { CurrentTask } from '../src/types.js';

let workspaceRoot: string;

function task(root: string, taskId: string): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId,
    workspace: 'cc-pane',
    projectPath: root,
    worktreeRoot: root,
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'synthetic scanned task'
  };
}

beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-workspace-'));
});

afterEach(async () => {
  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

describe('scanWorkspaceTasks', () => {
  test('returns an empty result for a workspace with no task selections', async () => {
    await fs.mkdir(path.join(workspaceRoot, 'plain-project'));
    const result = await scanWorkspaceTasks(workspaceRoot);
    expect(result.tasks).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('finds current-task.json files one level below workspace root', async () => {
    const alpha = path.join(workspaceRoot, 'alpha');
    const beta = path.join(workspaceRoot, 'beta');
    await writeCurrentTaskAtomic(alpha, task(alpha, 'task-alpha'));
    await writeCurrentTaskAtomic(beta, task(beta, 'task-beta'));

    const result = await scanWorkspaceTasks(workspaceRoot);

    expect(result.errors).toEqual([]);
    expect(result.tasks.map((item) => item.task.taskId).sort()).toEqual(['task-alpha', 'task-beta']);
    expect(result.tasks.map((item) => item.worktreeRoot).sort()).toEqual([alpha, beta].sort());
  });

  test('records invalid current-task files as scan errors and keeps valid candidates', async () => {
    const good = path.join(workspaceRoot, 'good');
    const bad = path.join(workspaceRoot, 'bad');
    await writeCurrentTaskAtomic(good, task(good, 'task-good'));
    await fs.mkdir(path.join(bad, '.ccpanes-task'), { recursive: true });
    await fs.writeFile(path.join(bad, '.ccpanes-task', 'current-task.json'), JSON.stringify({ schema: 'wrong' }), 'utf8');

    const result = await scanWorkspaceTasks(workspaceRoot);

    expect(result.tasks.map((item) => item.task.taskId)).toEqual(['task-good']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toContain('invalid current task: schema');
  });

  test('skips noisy infrastructure directories', async () => {
    const nodeModulesTask = path.join(workspaceRoot, 'node_modules');
    await writeCurrentTaskAtomic(nodeModulesTask, task(nodeModulesTask, 'task-noise'));

    const result = await scanWorkspaceTasks(workspaceRoot);

    expect(result.tasks).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});