import { adaptHookEventToBatch } from './hook-event-adapter.js';
import { runHookDryRunBatch, validateHookDryRunBatch, type HookDryRunBatchInput, type HookDryRunBatchResult } from './hook-batch.js';
import { applyProjectPolicyToCalls, ProjectPolicyError, projectPolicyPath, readProjectPolicy } from './project-policy.js';
import { authorizeTaskBindingBootstrapWrite } from './task-binding-bootstrap.js';
import type { CurrentTask, HookCall, TaskBindingCheck, TaskBindingStatus } from './types.js';

export interface HookRunnerResult {
  schema: 'ccpanes.hook-runner-result.v1';
  mode: 'dry-run';
  taskId: string;
  allowed: boolean;
  batch: HookDryRunBatchInput;
  dryRun: HookDryRunBatchResult;
}

export interface TaskBindingMismatchOptions {
  trustedCliPath?: string | null;
  processExecPath?: string | null;
}

export function createTaskBindingMismatchGateTask(check: TaskBindingCheck): CurrentTask {
  const worktreeRoot = check.gitRoot ?? check.cwd;
  const projectPath = check.canonicalProjectRoot ?? worktreeRoot;
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'unresolved-task-binding',
    workspace: 'cc-pane',
    projectPath,
    worktreeRoot,
    mainRepoRoot: check.canonicalProjectRoot,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    source: 'manual-import',
    notes: 'ephemeral task binding mismatch gate context'
  };
}

export function runHookEventDryRun(task: CurrentTask, event: unknown): HookRunnerResult {
  const batch = validateHookDryRunBatch(adaptHookEventToBatch(task, event));
  const dryRun = runHookDryRunBatch(batch);
  return {
    schema: 'ccpanes.hook-runner-result.v1',
    mode: 'dry-run',
    taskId: task.taskId,
    allowed: dryRun.decisions.every((decision) => decision.action === 'allow'),
    batch,
    dryRun
  };
}

export function runHookEventWithTaskBindingMismatch(
  task: CurrentTask,
  event: unknown,
  mismatch: TaskBindingStatus | TaskBindingCheck,
  options: TaskBindingMismatchOptions = {}
): HookRunnerResult {
  const status = typeof mismatch === 'string' ? mismatch : mismatch.status;
  if (status === 'matched' || status === 'missing') {
    throw new Error(`invalid task binding mismatch status: ${status}`);
  }
  const batch = validateHookDryRunBatch(adaptHookEventToBatch(task, event));
  return resultFromBatch(task, validateHookDryRunBatch({
    ...batch,
    calls: batch.calls.map((call) => rewriteMismatchCall(call, mismatch, status, options))
  }));
}

function rewriteMismatchCall(
  call: HookCall,
  mismatch: TaskBindingStatus | TaskBindingCheck,
  status: TaskBindingStatus,
  options: TaskBindingMismatchOptions
): HookCall {
  if (!call.writes) return call;
  if (typeof mismatch !== 'string') {
    const bootstrap = authorizeTaskBindingBootstrapWrite({
      check: mismatch,
      call,
      trustedCliPath: options.trustedCliPath,
      processExecPath: options.processExecPath
    });
    if (bootstrap.allowed) {
      return {
        ...call,
        policyEffect: 'allow',
        policyReason: bootstrap.reason
      };
    }
  }
  return {
    ...call,
    policyEffect: undefined,
    policyReason: `task_binding_scope_mismatch:${status}`
  };
}

function resultFromBatch(task: CurrentTask, batch: HookDryRunBatchInput): HookRunnerResult {
  const dryRun = runHookDryRunBatch(batch);
  return {
    schema: 'ccpanes.hook-runner-result.v1',
    mode: 'dry-run',
    taskId: task.taskId,
    allowed: dryRun.decisions.every((decision) => decision.action === 'allow'),
    batch,
    dryRun
  };
}

export async function runHookEventDryRunWithProjectPolicy(task: CurrentTask, event: unknown): Promise<HookRunnerResult> {
  let policy;
  try {
    policy = await readProjectPolicy(task.worktreeRoot);
  } catch (error) {
    if (!(error instanceof ProjectPolicyError)) throw error;
    const policyPath = projectPolicyPath(task.worktreeRoot);
    const batch = validateHookDryRunBatch({
      schema: 'ccpanes.hook-dry-run-batch.v1',
      task,
      calls: [{
        tool: 'write',
        targetPath: policyPath,
        writes: true,
        policyEffect: 'block',
        policyReason: `${error.code}:${error.message}`
      }]
    });
    return resultFromBatch(task, batch);
  }

  const batch = validateHookDryRunBatch(adaptHookEventToBatch(task, event));
  const policyBatch = validateHookDryRunBatch({
    ...batch,
    calls: applyProjectPolicyToCalls(task, batch.calls, policy)
  });
  return resultFromBatch(task, policyBatch);
}
