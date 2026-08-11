import { describe, expect, test } from 'vitest';
import {
  runHookEventDryRun,
  runHookEventWithTaskBindingMismatch
} from '../src/hook-runner.js';
import type { CurrentTask, TaskBindingCheck } from '../src/types.js';

function task(phase: CurrentTask['phase'] = 'build'): CurrentTask {
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
    phase,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'hook-runner fixture task'
  };
}

function staleParentCheck(): TaskBindingCheck {
  return {
    schema: 'ccpanes.task-binding-check.v1',
    status: 'stale-parent-binding',
    reason: 'task_found_above_current_git_root',
    cwd: 'D:\\cc-pane\\project-alpha',
    gitRoot: 'D:\\cc-pane\\project-alpha',
    gitCommonDir: 'D:\\cc-pane\\project-alpha\\.git',
    canonicalProjectRoot: 'D:\\cc-pane\\project-alpha',
    taskPath: 'D:\\cc-pane\\.ccpanes-task\\current-task.json',
    taskFileRoot: 'D:\\cc-pane',
    declaredProjectPath: 'D:\\cc-pane',
    declaredWorktreeRoot: 'D:\\cc-pane',
    declaredMainRepoRoot: null,
    taskId: 'parent-task'
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

  test('blocks writes when task binding scope is mismatched', () => {
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'D:/cc-pane/project-alpha/src/a.ts' }
    }, 'project-root-mismatch');

    expect(result.allowed).toBe(false);
    expect(result.dryRun.decisions[0].reason)
      .toBe('task_binding_scope_mismatch:project-root-mismatch');
  });

  test('blocks unproven shell commands when task binding scope is mismatched', () => {
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/cc-pane/project-alpha',
      tool_name: 'Bash',
      tool_input: { command: 'npm run build' }
    }, 'stale-parent-binding');

    expect(result.allowed).toBe(false);
    expect(result.batch.calls[0]).toMatchObject({
      tool: 'shell',
      writes: true,
      command: 'npm run build'
    });
    expect(result.dryRun.decisions[0].reason)
      .toBe('task_binding_scope_mismatch:stale-parent-binding');
  });

  test('allows only exact write-current bootstrap shell command during stale-parent-binding', () => {
    const trustedCliPath = 'D:\\cc-pane\\project-alpha\\dist\\src\\cli.js';
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/cc-pane/project-alpha',
      tool_name: 'Bash',
      tool_input: {
        command: `node "${trustedCliPath}" write-current --root "D:\\cc-pane\\project-alpha" --task-id "task-alpha" --phase build --workspace "project-alpha" --notes "bootstrap"`
      }
    }, staleParentCheck(), {
      trustedCliPath,
      processExecPath: 'C:\\Program Files\\nodejs\\node.exe'
    });

    expect(result.allowed).toBe(true);
    expect(result.dryRun.decisions[0]).toMatchObject({
      action: 'allow',
      reason: 'task_binding_bootstrap_write',
      tool: 'shell',
      targetPath: 'D:/cc-pane/project-alpha'
    });
  });

  test.each([
    ['leading newline', '\n'],
    ['trailing newline', '']
  ])('rejects exact write-current bootstrap with %s before shell analyzer trimming', (_label, prefix) => {
    const trustedCliPath = 'D:\\cc-pane\\project-alpha\\dist\\src\\cli.js';
    const exactCommand = `node "${trustedCliPath}" write-current --root "D:\\cc-pane\\project-alpha" --task-id "task-alpha" --phase build`;
    const command = prefix ? `${prefix}${exactCommand}` : `${exactCommand}\n`;

    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/cc-pane/project-alpha',
      tool_name: 'Bash',
      tool_input: { command }
    }, staleParentCheck(), {
      trustedCliPath,
      processExecPath: 'C:\\Program Files\\nodejs\\node.exe'
    });

    expect(result.allowed).toBe(false);
    expect(result.dryRun.decisions[0].reason)
      .toBe('task_binding_scope_mismatch:stale-parent-binding');
  });

  test('keeps ordinary ApplyPatch writes blocked during stale-parent-binding', () => {
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: {
        patch: '*** Begin Patch\n*** Update File: D:/cc-pane/project-alpha/src/a.ts\n@@\n-old\n+new\n*** End Patch\n'
      }
    }, staleParentCheck(), {
      trustedCliPath: 'D:\\cc-pane\\project-alpha\\dist\\src\\cli.js',
      processExecPath: 'C:\\Program Files\\nodejs\\node.exe'
    });

    expect(result.allowed).toBe(false);
    expect(result.dryRun.decisions[0].reason)
      .toBe('task_binding_scope_mismatch:stale-parent-binding');
  });

  test('blocks redirected output from a read-only shell command when task binding scope is mismatched', () => {
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/cc-pane/project-alpha',
      tool_name: 'Bash',
      tool_input: { command: 'git status > status.txt' }
    }, 'stale-parent-binding');

    expect(result.allowed).toBe(false);
    expect(result.batch.calls[0]).toMatchObject({
      tool: 'shell',
      targetPath: 'D:/cc-pane/project-alpha/status.txt',
      writes: true
    });
    expect(result.dryRun.decisions[0].reason)
      .toBe('task_binding_scope_mismatch:stale-parent-binding');
  });

  test('blocks a compound shell command with a read-only prefix when task binding scope is mismatched', () => {
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PermissionRequest',
      cwd: 'D:/cc-pane/project-alpha',
      tool_name: 'Bash',
      tool_input: { command: 'npm test && npm install foo' }
    }, 'stale-parent-binding');

    expect(result.allowed).toBe(false);
    expect(result.batch.calls[0]).toMatchObject({
      tool: 'shell',
      targetPath: 'D:/cc-pane/project-alpha',
      writes: true
    });
    expect(result.dryRun.decisions[0].reason)
      .toBe('task_binding_scope_mismatch:stale-parent-binding');
  });

  test.each([
    ['PreToolUse', 'git diff --output=status.txt'],
    ['PermissionRequest', 'npm test -- --update']
  ])('blocks write-capable read-only prefix variants for %s', (hookEventName, command) => {
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: hookEventName,
      cwd: 'D:/cc-pane/project-alpha',
      tool_name: 'Bash',
      tool_input: { command }
    }, 'stale-parent-binding');

    expect(result.allowed).toBe(false);
    expect(result.batch.calls[0]).toMatchObject({
      tool: 'shell',
      targetPath: 'D:/cc-pane/project-alpha',
      writes: true
    });
    expect(result.dryRun.decisions[0].reason)
      .toBe('task_binding_scope_mismatch:stale-parent-binding');
  });

  test('keeps reads non-blocking when task binding scope is mismatched', () => {
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: 'D:/cc-pane/project-alpha/README.md' }
    }, 'stale-parent-binding');

    expect(result.allowed).toBe(true);
    expect(result.dryRun.decisions[0].reason).toBe('non_write_call');
  });
});
