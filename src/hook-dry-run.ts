import { isPathInside, normalizeForComparison } from './paths.js';
import type { CurrentTask, HookCall, HookDryRunDecision } from './types.js';

const forbiddenRoots = [
  'C:/Users/AI001/.codex',
  'C:/Users/AI001/.claude',
  'C:/Users/AI001/.cc-panes',
  'D:/cc-pane/tool/repos/comet',
  'D:/cc-pane/tool/repos/fastctx'
];

function isForbiddenPath(targetPath: string): boolean {
  return forbiddenRoots.some((root) => isPathInside(root, targetPath));
}

export function decideHookDryRun(task: CurrentTask, call: HookCall): HookDryRunDecision {
  const phase = task.phase;

  if (call.policyReason && !call.policyEffect) {
    return {
      action: 'block',
      reason: call.policyReason,
      targetInsideWorktree: call.targetPath ? isPathInside(task.worktreeRoot, call.targetPath) : false,
      phase
    };
  }

  if (!call.writes) {
    if (call.policyEffect === 'block') {
      return {
        action: 'block',
        reason: call.policyReason ? `project_policy_block:${call.policyReason}` : 'project_policy_block',
        targetInsideWorktree: call.targetPath ? isPathInside(task.worktreeRoot, call.targetPath) : false,
        phase
      };
    }
    return {
      action: 'allow',
      reason: call.policyEffect === 'allow' && call.policyReason ? `project_policy_allow:${call.policyReason}` : 'non_write_call',
      targetInsideWorktree: call.targetPath ? isPathInside(task.worktreeRoot, call.targetPath) : false,
      phase
    };
  }

  if (!call.targetPath) {
    return { action: 'block', reason: 'write_without_target_path', targetInsideWorktree: false, phase };
  }

  const targetPath = normalizeForComparison(call.targetPath);
  if (isForbiddenPath(targetPath)) {
    return { action: 'block', reason: 'forbidden_user_config_path', targetInsideWorktree: false, phase };
  }

  const targetInsideWorktree = isPathInside(task.worktreeRoot, targetPath);
  if (!targetInsideWorktree) {
    return { action: 'block', reason: 'target_outside_task_worktree', targetInsideWorktree: false, phase };
  }

  if (call.policyEffect === 'block') {
    return {
      action: 'block',
      reason: call.policyReason ? `project_policy_block:${call.policyReason}` : 'project_policy_block',
      targetInsideWorktree: true,
      phase
    };
  }

  if (phase === 'build') {
    return {
      action: 'allow',
      reason: call.policyEffect === 'allow' && call.policyReason ? `project_policy_allow:${call.policyReason}` : 'build_write_inside_worktree',
      targetInsideWorktree: true,
      phase
    };
  }

  if (phase === 'verify') {
    return {
      action: 'allow',
      reason: call.policyEffect === 'allow' && call.policyReason ? `project_policy_allow:${call.policyReason}` : 'verify_minimal_fix_inside_worktree',
      targetInsideWorktree: true,
      phase
    };
  }

  if (call.policyEffect === 'allow') {
    return {
      action: 'allow',
      reason: call.policyReason ? `project_policy_allow:${call.policyReason}` : 'project_policy_allow',
      targetInsideWorktree: true,
      phase
    };
  }

  return { action: 'block', reason: `phase_${phase}_blocks_implementation_write`, targetInsideWorktree: true, phase };
}
