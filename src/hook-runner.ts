import { adaptHookEventToBatch } from './hook-event-adapter.js';
import { runHookDryRunBatch, validateHookDryRunBatch, type HookDryRunBatchInput, type HookDryRunBatchResult } from './hook-batch.js';
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
