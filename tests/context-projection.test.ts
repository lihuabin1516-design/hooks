import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  checkpointFromProjection,
  projectionDigest,
  readContextProjection,
  validateContextProjection
} from '../src/context-projection.js';
import type { CurrentTask } from '../src/types.js';

function task(root: string): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'projection-task',
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
    notes: 'projection contract test'
  };
}

function projection(root: string): Record<string, unknown> {
  return {
    schema: 'ccpanes.context-projection-input.v1',
    taskId: 'projection-task',
    workspace: 'cc-pane',
    projectPath: root,
    worktreeRoot: root,
    generatedAt: '2026-08-31T12:00:00.000Z',
    goal: 'RUNNING',
    workflow: 'RUNNING',
    worker: 'DISPATCH_UNKNOWN',
    session: 'present-but-redacted',
    git: {
      root,
      branch: 'feature/projection',
      head: 'abcdef0123456789abcdef0123456789abcdef01',
      dirty: false,
      statusShort: ''
    },
    acceptance: ['synthetic canary=pass'],
    blockers: ['real session evidence pending'],
    nextActions: ['reconcile official Session'],
    completedMilestones: ['projection contract defined'],
    decisions: ['Coordinator remains state authority'],
    verificationEvidence: ['npm test=pass'],
    snapshotGeneration: 3
  };
}

describe('context projection contract', () => {
  test('validates and renders a task-bound Coordinator projection', () => {
    const root = 'D:/synthetic/projection';
    const validated = validateContextProjection(projection(root));
    const result = checkpointFromProjection(validated, task(root));
    expect(result.snapshotGeneration).toBe(3);
    expect(result.content).toContain('Goal: RUNNING');
    expect(result.content).toContain('Worker: DISPATCH_UNKNOWN');
    expect(result.content).toContain('real session evidence pending');
    expect(projectionDigest(validated)).toMatch(/^[A-F0-9]{64}$/u);
  });

  test('rejects unknown fields and mismatched task binding', () => {
    const root = 'D:/synthetic/projection';
    expect(() => validateContextProjection({
      ...projection(root),
      unexpected: 'field'
    })).toThrow('unknown field');
    expect(() => checkpointFromProjection(
      validateContextProjection(projection(root)),
      task('D:/synthetic/other')
    )).toThrow('does not match current task binding');
  });

  test('reads a bounded projection file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-projection-'));
    try {
      const file = path.join(root, 'projection.json');
      await fs.writeFile(file, JSON.stringify(projection(root)), 'utf8');
      const result = await readContextProjection(file);
      expect(result.schema).toBe('ccpanes.context-projection-input.v1');
      expect(result.taskId).toBe('projection-task');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
