import { describe, expect, test } from 'vitest';
import { runHookEventDryRun } from '../src/hook-runner.js';
import type { CurrentTask } from '../src/types.js';

function task(phase: CurrentTask['phase'] = 'build'): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: 'D:/cc-pane/project-alpha',
    worktreeRoot: 'D:/cc-pane/project-alpha',
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'hook-runner fixture task'
  };
}

describe('runHookEventDryRun', () => {
  test('adapts a hook event and returns dry-run decisions without mutating inputs', () => {
    const result = runHookEventDryRun(task(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'D:/cc-pane/project-alpha/src/a.ts' }
    });

    expect(result.schema).toBe('ccpanes.hook-runner-result.v1');
    expect(result.mode).toBe('dry-run');
    expect(result.taskId).toBe('task-alpha');
    expect(result.allowed).toBe(true);
    expect(result.batch.calls).toEqual([
      { tool: 'edit', targetPath: 'D:/cc-pane/project-alpha/src/a.ts', writes: true }
    ]);
    expect(result.dryRun.decisions[0].action).toBe('allow');
    expect(result.dryRun.decisions[0].reason).toBe('build_write_inside_worktree');
  });

  test('sets allowed=false when any dry-run decision blocks', () => {
    const result = runHookEventDryRun(task(), {
      event: 'tool_call',
      tool: 'write',
      arguments: { path: 'C:/Users/AI001/.codex/config.toml' }
    });

    expect(result.allowed).toBe(false);
    expect(result.dryRun.decisions[0].action).toBe('block');
    expect(result.dryRun.decisions[0].reason).toBe('forbidden_user_config_path');
  });
});
