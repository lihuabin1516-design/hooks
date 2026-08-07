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

  if (call.policyReason) {
    return {
      action: 'block',
      reason: call.policyReason,
      targetInsideWorktree: call.targetPath ? isPathInside(task.worktreeRoot, call.targetPath) : false,
      phase
    };
  }

  if (!call.writes) {
    return { action: 'allow', reason: 'non_write_call', targetInsideWorktree: false, phase };
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

  if (phase === 'build') {
    return { action: 'allow', reason: 'build_write_inside_worktree', targetInsideWorktree: true, phase };
  }

  if (phase === 'verify') {
    return { action: 'allow', reason: 'verify_minimal_fix_inside_worktree', targetInsideWorktree: true, phase };
  }

  return { action: 'block', reason: `phase_${phase}_blocks_implementation_write`, targetInsideWorktree: true, phase };
}
