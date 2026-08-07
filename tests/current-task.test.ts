import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { currentTaskPath, readCurrentTask, writeCurrentTaskAtomic } from '../src/current-task.js';
import type { CurrentTask } from '../src/types.js';

let tempRoot: string;

function validTask(root: string): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: root,
    worktreeRoot: root,
    mainRepoRoot: null,
    branch: 'feature/task-alpha',
    head: 'abc123',
    owner: { leaderSessionId: 'leader-1', paneId: 'pane-1', layoutId: 'layout-1' },
    phase: 'build',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'leader',
    notes: 'synthetic fixture task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-task-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('current-task persistence', () => {
  test('uses .ccpanes-task/current-task.json below the worktree root', () => {
    expect(currentTaskPath(tempRoot)).toBe(path.join(tempRoot, '.ccpanes-task', 'current-task.json'));
  });

  test('writes and reads a valid current task atomically', async () => {
    const task = validTask(tempRoot);
    await writeCurrentTaskAtomic(tempRoot, task);
    await expect(readCurrentTask(tempRoot)).resolves.toEqual(task);
  });

  test('returns null when current-task.json is absent', async () => {
    await expect(readCurrentTask(tempRoot)).resolves.toBeNull();
  });

  test('rejects oversized current-task.json files', async () => {
    await fs.mkdir(path.join(tempRoot, '.ccpanes-task'), { recursive: true });
    await fs.writeFile(currentTaskPath(tempRoot), 'x'.repeat(17 * 1024), 'utf8');
    await expect(readCurrentTask(tempRoot)).rejects.toThrow('current-task.json exceeds 16384 bytes');
  });

  test('rejects invalid schema values', async () => {
    await fs.mkdir(path.join(tempRoot, '.ccpanes-task'), { recursive: true });
    await fs.writeFile(currentTaskPath(tempRoot), JSON.stringify({ schema: 'wrong' }), 'utf8');
    await expect(readCurrentTask(tempRoot)).rejects.toThrow('invalid current task: schema');
  });
});