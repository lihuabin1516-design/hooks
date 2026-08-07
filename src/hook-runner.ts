import { adaptHookEventToBatch } from './hook-event-adapter.js';
import { runHookDryRunBatch, validateHookDryRunBatch, type HookDryRunBatchInput, type HookDryRunBatchResult } from './hook-batch.js';
import { applyProjectPolicyToCalls, ProjectPolicyError, projectPolicyPath, readProjectPolicy } from './project-policy.js';
import type { CurrentTask } from './types.js';

export interface HookRunnerResult {
  schema: 'ccpanes.hook-runner-result.v1';
  mode: 'dry-run';
  taskId: string;
  allowed: boolean;
  batch: HookDryRunBatchInput;
  dryRun: HookDryRunBatchResult;
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
