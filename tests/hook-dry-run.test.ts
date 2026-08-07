import { describe, expect, test } from 'vitest';
import { decideHookDryRun } from '../src/hook-dry-run.js';
import { isPathInside, normalizeForComparison } from '../src/paths.js';
import type { CurrentTask, HookCall, TaskPhase } from '../src/types.js';

function task(phase: TaskPhase): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: 'D:/cc-pane/project-alpha',
    worktreeRoot: 'D:/cc-pane/project-alpha',
    mainRepoRoot: 'D:/cc-pane/main-project',
    branch: 'feature/task-alpha',
    head: 'abc123',
    owner: { leaderSessionId: 'leader-1', paneId: 'pane-1', layoutId: 'layout-1' },
    phase,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'leader',
    notes: 'fixture'
  };
}

describe('path helpers', () => {
  test('normalizes path separators for stable comparisons', () => {
    expect(normalizeForComparison('D:/cc-pane/tool')).toBe('d:/cc-pane/tool');
    expect(normalizeForComparison('D:\\cc-pane\\tool\\')).toBe('d:/cc-pane/tool');
  });

  test('detects paths inside a worktree without accepting sibling prefixes', () => {
    expect(isPathInside('D:/cc-pane/project', 'D:/cc-pane/project/src/a.ts')).toBe(true);
    expect(isPathInside('D:/cc-pane/project', 'D:/cc-pane/project-other/src/a.ts')).toBe(false);
    expect(isPathInside('D:/cc-pane/project', 'D:/cc-pane/project')).toBe(true);
  });
});

describe('task phase type', () => {
  test('accepts the four designed phases', () => {
    const phases: TaskPhase[] = ['shape', 'build', 'verify', 'archive'];
    expect(phases).toEqual(['shape', 'build', 'verify', 'archive']);
  });
});

describe('decideHookDryRun', () => {
  test('allows non-write calls regardless of phase', () => {
    const call: HookCall = { tool: 'read', targetPath: 'D:/cc-pane/project-alpha/src/a.ts', writes: false };
    expect(decideHookDryRun(task('archive'), call).action).toBe('allow');
  });

  test('allows build writes inside the task worktree', () => {
    const call: HookCall = { tool: 'write', targetPath: 'D:/cc-pane/project-alpha/src/a.ts', writes: true };
    const decision = decideHookDryRun(task('build'), call);
    expect(decision).toMatchObject({ action: 'allow', reason: 'build_write_inside_worktree', targetInsideWorktree: true });
  });

  test('blocks implementation writes during shape phase', () => {
    const call: HookCall = { tool: 'edit', targetPath: 'D:/cc-pane/project-alpha/src/a.ts', writes: true };
    const decision = decideHookDryRun(task('shape'), call);
    expect(decision).toMatchObject({ action: 'block', reason: 'phase_shape_blocks_implementation_write' });
  });

  test('blocks writes into the main repo when task worktree differs', () => {
    const call: HookCall = { tool: 'write', targetPath: 'D:/cc-pane/main-project/src/a.ts', writes: true };
    const decision = decideHookDryRun(task('build'), call);
    expect(decision).toMatchObject({ action: 'block', reason: 'target_outside_task_worktree' });
  });

  test('blocks writes into user config paths', () => {
    const call: HookCall = { tool: 'write', targetPath: 'C:/Users/AI001/.codex/config.toml', writes: true };
    const decision = decideHookDryRun(task('build'), call);
    expect(decision).toMatchObject({ action: 'block', reason: 'forbidden_user_config_path' });
  });

  test('blocks policy-denied shell commands before path scope checks', () => {
    const call: HookCall = {
      tool: 'shell',
      targetPath: 'D:/cc-pane/project-alpha',
      writes: true,
      policyReason: 'destructive_git_reset_hard'
    };
    const decision = decideHookDryRun(task('build'), call);
    expect(decision).toMatchObject({
      action: 'block',
      reason: 'destructive_git_reset_hard',
      targetInsideWorktree: true
    });
  });

  test('allows shell verification commands during shape because they are non-write calls', () => {
    const call: HookCall = { tool: 'shell', targetPath: 'D:/cc-pane/project-alpha', writes: false };
    const decision = decideHookDryRun(task('shape'), call);
    expect(decision).toMatchObject({ action: 'allow', reason: 'non_write_call' });
  });

  test('project block rules can deny otherwise allowed non-write calls', () => {
    const call: HookCall = {
      tool: 'shell',
      targetPath: 'D:/cc-pane/project-alpha',
      writes: false,
      policyEffect: 'block',
      policyReason: 'user_blocked_publish_probe'
    };
    const decision = decideHookDryRun(task('build'), call);
    expect(decision).toMatchObject({ action: 'block', reason: 'project_policy_block:user_blocked_publish_probe' });
  });

  test('project allow rules can open phase guarded writes inside the worktree', () => {
    const call: HookCall = {
      tool: 'write',
      targetPath: 'D:/cc-pane/project-alpha/docs/plan.md',
      writes: true,
      policyEffect: 'allow',
      policyReason: 'user_opened_docs_during_shape'
    };
    const decision = decideHookDryRun(task('shape'), call);
    expect(decision).toMatchObject({ action: 'allow', reason: 'project_policy_allow:user_opened_docs_during_shape' });
  });

  test('project allow rules do not override hard user config boundaries', () => {
    const call: HookCall = {
      tool: 'write',
      targetPath: 'C:/Users/AI001/.codex/config.toml',
      writes: true,
      policyEffect: 'allow',
      policyReason: 'user_opened_config'
    };
    const decision = decideHookDryRun(task('shape'), call);
    expect(decision).toMatchObject({ action: 'block', reason: 'forbidden_user_config_path' });
  });

  test('project block rules do not hide hard user config boundary reasons', () => {
    const call: HookCall = {
      tool: 'write',
      targetPath: 'C:/Users/AI001/.codex/config.toml',
      writes: true,
      policyEffect: 'block',
      policyReason: 'user_blocked_config'
    };
    const decision = decideHookDryRun(task('build'), call);
    expect(decision).toMatchObject({ action: 'block', reason: 'forbidden_user_config_path' });
  });
});
