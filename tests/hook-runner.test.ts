import { describe, expect, test } from 'vitest';
import {
  runHookEventDryRun,
  runHookEventDryRunWithProjectPolicy,
  runHookEventWithTaskBindingMismatch
} from '../src/hook-runner.js';
import type { CurrentTask, TaskBindingCheck } from '../src/types.js';

function task(phase: CurrentTask['phase'] = 'build'): CurrentTask {
  return {
    schema: 'paneforge.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'paneforge',
    projectPath: 'D:\\paneforge\\project-alpha',
    worktreeRoot: 'D:\\paneforge\\project-alpha',
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
    schema: 'paneforge.task-binding-check.v1',
    status: 'stale-parent-binding',
    reason: 'task_found_above_current_git_root',
    cwd: 'D:\\paneforge\\project-alpha',
    gitRoot: 'D:\\paneforge\\project-alpha',
    gitCommonDir: 'D:\\paneforge\\project-alpha\\.git',
    canonicalProjectRoot: 'D:\\paneforge\\project-alpha',
    taskPath: 'D:\\paneforge\\.paneforge-task\\current-task.json',
    taskFileRoot: 'D:\\paneforge',
    declaredProjectPath: 'D:\\paneforge',
    declaredWorktreeRoot: 'D:\\paneforge',
    declaredMainRepoRoot: null,
    taskId: 'parent-task'
  };
}

describe('runHookEventDryRun', () => {
  const trustedCliPath = 'D:\\paneforge\\project-alpha\\dist\\src\\cli.js';
  const trustedOptions = {
    trustedCliPath,
    processExecPath: 'C:\\Program Files\\nodejs\\node.exe'
  };

  test('allows trusted acceptance verification during archive as a non-write call', async () => {
    const result = await runHookEventDryRunWithProjectPolicy(task('archive'), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/paneforge/project-alpha',
      tool_name: 'Bash',
      tool_input: {
        command: `node "${trustedCliPath}" verify-acceptance --input "D:\\paneforge\\project-alpha\\.paneforge-task\\acceptance.json"`
      }
    }, trustedOptions);

    expect(result.allowed).toBe(true);
    expect(result.batch.calls[0]).toMatchObject({
      writes: false,
      policyReason: 'trusted_task_lifecycle_verify_acceptance'
    });
    expect(result.dryRun.decisions[0].reason)
      .toBe('project_policy_allow:trusted_task_lifecycle_verify_acceptance');
  });

  test('resolves a relative trusted CLI entrypoint from the task worktree', async () => {
    const result = await runHookEventDryRunWithProjectPolicy(task('archive'), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/paneforge/project-alpha',
      tool_name: 'Bash',
      tool_input: {
        command: 'node dist/src/cli.js verify-acceptance --input .paneforge-task/acceptance.json'
      }
    }, trustedOptions);

    expect(result.allowed).toBe(true);
    expect(result.batch.calls[0]).toMatchObject({ writes: false });
  });

  test('allows trusted acceptance recording to the current task artifact during archive', async () => {
    const result = await runHookEventDryRunWithProjectPolicy(task('archive'), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/paneforge/project-alpha',
      tool_name: 'Bash',
      tool_input: {
        command: `node "${trustedCliPath}" record-acceptance --task "D:\\paneforge\\project-alpha\\.paneforge-task\\current-task.json" --artifact "src/a.ts" --check "npm test=pass=ok; 1 test passed" --truth "live-gates=pass=ok" > "D:\\paneforge\\project-alpha\\.paneforge-task\\acceptance.json"`
      }
    }, trustedOptions);

    expect(result.allowed).toBe(true);
    expect(result.dryRun.decisions[0].reason)
      .toBe('project_policy_allow:trusted_task_lifecycle_record_acceptance');
  });

  test('allows a trusted same-task archive to verify transition', async () => {
    const result = await runHookEventDryRunWithProjectPolicy(task('archive'), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/paneforge/project-alpha',
      tool_name: 'Bash',
      tool_input: {
        command: `node "${trustedCliPath}" write-current --root "D:\\paneforge\\project-alpha" --task-id "task-alpha" --phase verify --workspace "paneforge" --notes "refresh acceptance"`
      }
    }, trustedOptions);

    expect(result.allowed).toBe(true);
    expect(result.dryRun.decisions[0].reason)
      .toBe('project_policy_allow:trusted_task_lifecycle_phase_transition');
  });

  test.each([
    ['untrusted CLI', 'node "D:\\paneforge\\project-alpha\\evil-cli.js" verify-acceptance --input "D:\\paneforge\\project-alpha\\.paneforge-task\\acceptance.json"'],
    ['wrong acceptance output', `node "${trustedCliPath}" record-acceptance --task "D:\\paneforge\\project-alpha\\.paneforge-task\\current-task.json" --artifact "src/a.ts" > "D:\\paneforge\\project-alpha\\result.json"`],
    ['artifact outside worktree', `node "${trustedCliPath}" record-acceptance --task "D:\\paneforge\\project-alpha\\.paneforge-task\\current-task.json" --artifact "D:\\paneforge\\other\\secret.txt" > "D:\\paneforge\\project-alpha\\.paneforge-task\\acceptance.json"`],
    ['compound acceptance command', `node "${trustedCliPath}" record-acceptance --task "D:\\paneforge\\project-alpha\\.paneforge-task\\current-task.json" --artifact "src/a.ts" > "D:\\paneforge\\project-alpha\\.paneforge-task\\acceptance.json"; npm install bad`],
    ['append acceptance redirect', `node "${trustedCliPath}" record-acceptance --task "D:\\paneforge\\project-alpha\\.paneforge-task\\current-task.json" --artifact "src/a.ts" >> "D:\\paneforge\\project-alpha\\.paneforge-task\\acceptance.json"`],
    ['archive to build transition', `node "${trustedCliPath}" write-current --root "D:\\paneforge\\project-alpha" --task-id "task-alpha" --phase build`],
    ['different task transition', `node "${trustedCliPath}" write-current --root "D:\\paneforge\\project-alpha" --task-id "other-task" --phase verify`]
  ])('keeps unsafe archive lifecycle command blocked: %s', async (_label, command) => {
    const result = await runHookEventDryRunWithProjectPolicy(task('archive'), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/paneforge/project-alpha',
      tool_name: 'Bash',
      tool_input: { command }
    }, trustedOptions);

    expect(result.allowed).toBe(false);
    expect(result.dryRun.decisions[0].reason)
      .toBe('phase_archive_blocks_implementation_write');
  });

  test('adapts a hook event and returns dry-run decisions without mutating inputs', () => {
    const result = runHookEventDryRun(task(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'D:/paneforge/project-alpha/src/a.ts' }
    });

    expect(result.schema).toBe('paneforge.hook-runner-result.v1');
    expect(result.mode).toBe('dry-run');
    expect(result.taskId).toBe('task-alpha');
    expect(result.allowed).toBe(true);
    expect(result.batch.calls).toEqual([
      { tool: 'edit', targetPath: 'D:/paneforge/project-alpha/src/a.ts', writes: true }
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
      tool_input: { file_path: 'D:/paneforge/project-alpha/src/a.ts' }
    }, 'project-root-mismatch');

    expect(result.allowed).toBe(false);
    expect(result.dryRun.decisions[0].reason)
      .toBe('task_binding_scope_mismatch:project-root-mismatch');
  });

  test('blocks unproven shell commands when task binding scope is mismatched', () => {
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/paneforge/project-alpha',
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
    const trustedCliPath = 'D:\\paneforge\\project-alpha\\dist\\src\\cli.js';
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/paneforge/project-alpha',
      tool_name: 'Bash',
      tool_input: {
        command: `node "${trustedCliPath}" write-current --root "D:\\paneforge\\project-alpha" --task-id "task-alpha" --phase build --workspace "project-alpha" --notes "bootstrap"`
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
      targetPath: 'D:/paneforge/project-alpha'
    });
  });

  test.each([
    ['leading newline', '\n'],
    ['trailing newline', '']
  ])('rejects exact write-current bootstrap with %s before shell analyzer trimming', (_label, prefix) => {
    const trustedCliPath = 'D:\\paneforge\\project-alpha\\dist\\src\\cli.js';
    const exactCommand = `node "${trustedCliPath}" write-current --root "D:\\paneforge\\project-alpha" --task-id "task-alpha" --phase build`;
    const command = prefix ? `${prefix}${exactCommand}` : `${exactCommand}\n`;

    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/paneforge/project-alpha',
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
        patch: '*** Begin Patch\n*** Update File: D:/paneforge/project-alpha/src/a.ts\n@@\n-old\n+new\n*** End Patch\n'
      }
    }, staleParentCheck(), {
      trustedCliPath: 'D:\\paneforge\\project-alpha\\dist\\src\\cli.js',
      processExecPath: 'C:\\Program Files\\nodejs\\node.exe'
    });

    expect(result.allowed).toBe(false);
    expect(result.dryRun.decisions[0].reason)
      .toBe('task_binding_scope_mismatch:stale-parent-binding');
  });

  test('blocks redirected output from a read-only shell command when task binding scope is mismatched', () => {
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/paneforge/project-alpha',
      tool_name: 'Bash',
      tool_input: { command: 'git status > status.txt' }
    }, 'stale-parent-binding');

    expect(result.allowed).toBe(false);
    expect(result.batch.calls[0]).toMatchObject({
      tool: 'shell',
      targetPath: 'D:/paneforge/project-alpha/status.txt',
      writes: true
    });
    expect(result.dryRun.decisions[0].reason)
      .toBe('task_binding_scope_mismatch:stale-parent-binding');
  });

  test('blocks a compound shell command with a read-only prefix when task binding scope is mismatched', () => {
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PermissionRequest',
      cwd: 'D:/paneforge/project-alpha',
      tool_name: 'Bash',
      tool_input: { command: 'npm test && npm install foo' }
    }, 'stale-parent-binding');

    expect(result.allowed).toBe(false);
    expect(result.batch.calls[0]).toMatchObject({
      tool: 'shell',
      targetPath: 'D:/paneforge/project-alpha',
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
      cwd: 'D:/paneforge/project-alpha',
      tool_name: 'Bash',
      tool_input: { command }
    }, 'stale-parent-binding');

    expect(result.allowed).toBe(false);
    expect(result.batch.calls[0]).toMatchObject({
      tool: 'shell',
      targetPath: 'D:/paneforge/project-alpha',
      writes: true
    });
    expect(result.dryRun.decisions[0].reason)
      .toBe('task_binding_scope_mismatch:stale-parent-binding');
  });

  test('keeps reads non-blocking when task binding scope is mismatched', () => {
    const result = runHookEventWithTaskBindingMismatch(task(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: 'D:/paneforge/project-alpha/README.md' }
    }, 'stale-parent-binding');

    expect(result.allowed).toBe(true);
    expect(result.dryRun.decisions[0].reason).toBe('non_write_call');
  });
});
