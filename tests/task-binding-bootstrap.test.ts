import { describe, expect, test } from 'vitest';
import { authorizeTaskBindingBootstrapWrite } from '../src/task-binding-bootstrap.js';
import type { HookCall, TaskBindingCheck } from '../src/types.js';

const gitRoot = 'D:\\cc-pane\\.worktrees\\hooks-phase51-task-binding';
const trustedCliPath = 'D:\\cc-pane\\.worktrees\\hooks-phase51-task-binding\\dist\\src\\cli.js';

function check(status: TaskBindingCheck['status'] = 'stale-parent-binding'): TaskBindingCheck {
  return {
    schema: 'ccpanes.task-binding-check.v1',
    status,
    reason: status === 'stale-parent-binding'
      ? 'task_found_above_current_git_root'
      : 'declared_project_path_or_main_repo_root_does_not_match_git_topology',
    cwd: gitRoot,
    gitRoot,
    gitCommonDir: 'D:\\cc-pane\\tool\\repos\\hooks\\.git',
    canonicalProjectRoot: 'D:\\cc-pane\\tool\\repos\\hooks',
    taskPath: 'D:\\cc-pane\\.ccpanes-task\\current-task.json',
    taskFileRoot: 'D:\\cc-pane',
    declaredProjectPath: 'D:\\cc-pane',
    declaredWorktreeRoot: 'D:\\cc-pane',
    declaredMainRepoRoot: null,
    taskId: 'parent-task'
  };
}

function shellCall(command: string): HookCall {
  return {
    tool: 'shell',
    targetPath: gitRoot,
    writes: true,
    command
  };
}

describe('authorizeTaskBindingBootstrapWrite', () => {
  test('allows an exact stale-parent-binding write-current bootstrap command', () => {
    const result = authorizeTaskBindingBootstrapWrite({
      check: check(),
      call: shellCall(`node "${trustedCliPath}" write-current --root "${gitRoot}" --task-id "task-alpha" --phase build --workspace "hooks-phase51-task-binding" --notes "bootstrap stale parent"`),
      trustedCliPath,
      processExecPath: 'C:\\Program Files\\nodejs\\node.exe'
    });

    expect(result).toEqual({
      allowed: true,
      reason: 'task_binding_bootstrap_write'
    });
  });

  test('rejects a write-current bootstrap command with the wrong root', () => {
    const result = authorizeTaskBindingBootstrapWrite({
      check: check(),
      call: shellCall(`node "${trustedCliPath}" write-current --root "D:\\cc-pane\\other" --task-id "task-alpha" --phase build`),
      trustedCliPath,
      processExecPath: 'C:\\Program Files\\nodejs\\node.exe'
    });

    expect(result).toMatchObject({ allowed: false, reason: 'bootstrap_root_mismatch' });
  });

  test('rejects a write-current bootstrap command with the wrong CLI path', () => {
    const result = authorizeTaskBindingBootstrapWrite({
      check: check(),
      call: shellCall(`node "D:\\cc-pane\\tool\\repos\\hooks\\dist\\src\\cli.js" write-current --root "${gitRoot}" --task-id "task-alpha" --phase build`),
      trustedCliPath,
      processExecPath: 'C:\\Program Files\\nodejs\\node.exe'
    });

    expect(result).toMatchObject({ allowed: false, reason: 'bootstrap_cli_mismatch' });
  });

  test.each([
    `node "${trustedCliPath}" write-current --root "${gitRoot}" --task-id "task-alpha" --phase build; npm test`,
    `node "${trustedCliPath}" write-current --root "${gitRoot}" --task-id "task-alpha" --phase build && npm test`,
    `node "${trustedCliPath}" write-current --root "${gitRoot}" --task-id "task-alpha" --phase build > out.txt`,
    `node "${trustedCliPath}" write-current --root "${gitRoot}" --task-id "task-alpha" --phase build\nnpm test`,
    `node "${trustedCliPath}" write-current --root "${gitRoot}" --task-id "task-alpha" --phase build $(whoami)`,
    `node "${trustedCliPath}" write-current --root "${gitRoot}" --task-id "task-alpha" --phase build \`whoami\``
  ])('rejects compound or redirected command syntax: %s', (command) => {
    const result = authorizeTaskBindingBootstrapWrite({
      check: check(),
      call: shellCall(command),
      trustedCliPath,
      processExecPath: 'C:\\Program Files\\nodejs\\node.exe'
    });

    expect(result).toMatchObject({ allowed: false, reason: 'bootstrap_shell_syntax_rejected' });
  });

  test.each([
    [`node "${trustedCliPath}" write-current --root "${gitRoot}" --task-id "task-alpha" --phase build --extra value`, 'bootstrap_unknown_flag'],
    [`node "${trustedCliPath}" write-current --root "${gitRoot}" --task-id "task-alpha" --phase build --notes "one" --notes "two"`, 'bootstrap_duplicate_flag'],
    [`node "${trustedCliPath}" write-current --root "${gitRoot}" --task-id "task-alpha" --phase`, 'bootstrap_missing_flag_value']
  ])('rejects invalid flags: %s', (command, reason) => {
    const result = authorizeTaskBindingBootstrapWrite({
      check: check(),
      call: shellCall(command),
      trustedCliPath,
      processExecPath: 'C:\\Program Files\\nodejs\\node.exe'
    });

    expect(result).toMatchObject({ allowed: false, reason });
  });

  test('rejects the exact command outside stale-parent-binding', () => {
    const result = authorizeTaskBindingBootstrapWrite({
      check: check('project-root-mismatch'),
      call: shellCall(`node "${trustedCliPath}" write-current --root "${gitRoot}" --task-id "task-alpha" --phase build`),
      trustedCliPath,
      processExecPath: 'C:\\Program Files\\nodejs\\node.exe'
    });

    expect(result).toMatchObject({ allowed: false, reason: 'bootstrap_status_not_stale_parent_binding' });
  });
});
