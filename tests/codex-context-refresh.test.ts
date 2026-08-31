import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from '../src/cli.js';

function task(root: string): Record<string, unknown> {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'refresh-task',
    workspace: 'cc-pane',
    projectPath: root,
    worktreeRoot: root,
    mainRepoRoot: null,
    branch: 'main',
    head: 'abcdef0123456789abcdef0123456789abcdef01',
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'verify',
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
    source: 'manual-import',
    notes: 'refresh context checkpoint'
  };
}

function projection(root: string, generation: number): Record<string, unknown> {
  return {
    schema: 'ccpanes.context-projection-input.v1',
    taskId: 'refresh-task',
    workspace: 'cc-pane',
    projectPath: root,
    worktreeRoot: root,
    generatedAt: '2026-08-31T12:00:00.000Z',
    goal: 'RUNNING',
    workflow: 'RUNNING',
    worker: 'RUNNING',
    session: 'present',
    git: null,
    acceptance: [],
    blockers: [],
    nextActions: ['continue'],
    completedMilestones: ['projection'],
    decisions: [],
    verificationEvidence: ['synthetic=pass'],
    snapshotGeneration: generation
  };
}

describe('codex-context-refresh', () => {
  test('initializes then rotates context snapshots through one command', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-context-refresh-'));
    try {
      const taskPath = path.join(root, 'current-task.json');
      const projectionPath = path.join(root, 'projection.json');
      await fs.writeFile(taskPath, JSON.stringify(task(root)), 'utf8');
      await fs.writeFile(projectionPath, JSON.stringify(projection(root, 1)), 'utf8');

      const first = JSON.parse(await runCli([
        'codex-context-refresh',
        '--projection', projectionPath,
        '--task-context', taskPath,
        '--root', root
      ]));
      expect(first.rotation).toMatchObject({
        status: 'initialized',
        retainedGenerations: 1
      });

      await fs.writeFile(projectionPath, JSON.stringify(projection(root, 2)), 'utf8');
      const second = JSON.parse(await runCli([
        'codex-context-refresh',
        '--projection', projectionPath,
        '--task-context', taskPath,
        '--root', root
      ]));
      expect(second.rotation).toMatchObject({
        status: 'completed',
        beforeGeneration: 1,
        afterGeneration: 2
      });
      expect(await fs.readFile(path.join(root, 'context.md'), 'utf8'))
        .toContain('snapshotGeneration: 2');
      expect(await fs.readFile(path.join(root, 'context.prev.md'), 'utf8'))
        .toContain('snapshotGeneration: 1');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('accepts a projection from stdin for coordinator-to-hooks piping', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-context-refresh-stdin-'));
    try {
      const taskPath = path.join(root, 'current-task.json');
      await fs.writeFile(taskPath, JSON.stringify(task(root)), 'utf8');

      const result = JSON.parse(await runCli([
        'codex-context-refresh',
        '--projection', '-',
        '--task-context', taskPath,
        '--root', root
      ], JSON.stringify(projection(root, 1))));

      expect(result.rotation).toMatchObject({
        status: 'initialized',
        retainedGenerations: 1
      });
      expect(await fs.readFile(path.join(root, 'context.md'), 'utf8'))
        .toContain('snapshotGeneration: 1');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
