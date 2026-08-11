import { describe, expect, test } from 'vitest';
import { runHookDryRunBatch } from '../src/hook-batch.js';
import type { CurrentTask } from '../src/types.js';

function task(): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: 'D:\\cc-pane\\project-alpha',
    worktreeRoot: 'D:\\cc-pane\\project-alpha',
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'synthetic batch task'
  };
}

describe('runHookDryRunBatch', () => {
  test('evaluates multiple calls and preserves call indexes', () => {
    const result = runHookDryRunBatch({
      schema: 'ccpanes.hook-dry-run-batch.v1',
      task: task(),
      calls: [
        { tool: 'read', targetPath: 'D:/cc-pane/project-alpha/src/a.ts', writes: false },
        { tool: 'write', targetPath: 'D:/cc-pane/project-alpha/src/a.ts', writes: true },
        { tool: 'write', targetPath: 'C:/Users/AI001/.codex/config.toml', writes: true }
      ]
    });

    expect(result.schema).toBe('ccpanes.hook-dry-run-batch-result.v1');
    expect(result.taskId).toBe('task-alpha');
    expect(result.decisions.map((item) => item.index)).toEqual([0, 1, 2]);
    expect(result.decisions.map((item) => item.action)).toEqual(['allow', 'allow', 'block']);
    expect(result.decisions[2]?.reason).toBe('forbidden_user_config_path');
  });

  test('uses task phase when deciding every call', () => {
    const shapeTask = { ...task(), phase: 'shape' as const };
    const result = runHookDryRunBatch({
      schema: 'ccpanes.hook-dry-run-batch.v1',
      task: shapeTask,
      calls: [
        { tool: 'write', targetPath: 'D:/cc-pane/project-alpha/src/a.ts', writes: true }
      ]
    });

    expect(result.decisions[0]).toMatchObject({
      action: 'block',
      reason: 'phase_shape_blocks_implementation_write',
      phase: 'shape'
    });
  });

  test('rejects invalid batch schema', () => {
    expect(() => runHookDryRunBatch({ schema: 'wrong', task: task(), calls: [] })).toThrow('invalid hook batch: schema');
  });

  test('rejects non-array calls', () => {
    expect(() => runHookDryRunBatch({ schema: 'ccpanes.hook-dry-run-batch.v1', task: task(), calls: 'bad' })).toThrow('invalid hook batch: calls');
  });
});
