import { validateCurrentTask } from './current-task.js';
import { decideHookDryRun } from './hook-dry-run.js';
import type { CurrentTask, HookCall, HookDryRunDecision } from './types.js';

export interface HookDryRunBatchInput {
  schema: 'ccpanes.hook-dry-run-batch.v1';
  task: CurrentTask;
  calls: HookCall[];
}

export interface HookDryRunBatchDecision extends HookDryRunDecision {
  index: number;
  tool: HookCall['tool'];
  targetPath: string | null;
}

export interface HookDryRunBatchResult {
  schema: 'ccpanes.hook-dry-run-batch-result.v1';
  taskId: string;
  decisions: HookDryRunBatchDecision[];
}

const tools: HookCall['tool'][] = ['read', 'grep', 'glob', 'edit', 'write', 'apply_patch', 'shell'];

function validateHookCall(value: unknown, index: number): HookCall {
  if (!value || typeof value !== 'object') throw new Error(`invalid hook batch: calls[${index}]`);
  const record = value as Record<string, unknown>;
  if (!tools.includes(record.tool as HookCall['tool'])) throw new Error(`invalid hook batch: calls[${index}].tool`);
  if (!(typeof record.targetPath === 'string' || record.targetPath === null)) throw new Error(`invalid hook batch: calls[${index}].targetPath`);
  if (typeof record.writes !== 'boolean') throw new Error(`invalid hook batch: calls[${index}].writes`);
  if (!(typeof record.command === 'string' || record.command === undefined)) throw new Error(`invalid hook batch: calls[${index}].command`);
  if (!(record.policyEffect === 'allow' || record.policyEffect === 'block' || record.policyEffect === undefined)) throw new Error(`invalid hook batch: calls[${index}].policyEffect`);
  if (!(typeof record.policyReason === 'string' || record.policyReason === undefined)) throw new Error(`invalid hook batch: calls[${index}].policyReason`);
  return record as unknown as HookCall;
}

export function validateHookDryRunBatch(value: unknown): HookDryRunBatchInput {
  if (!value || typeof value !== 'object') throw new Error('invalid hook batch: object');
  const record = value as Record<string, unknown>;
  if (record.schema !== 'ccpanes.hook-dry-run-batch.v1') throw new Error('invalid hook batch: schema');
  const task = validateCurrentTask(record.task);
  if (!Array.isArray(record.calls)) throw new Error('invalid hook batch: calls');
  const calls = record.calls.map((call, index) => validateHookCall(call, index));
  return { schema: 'ccpanes.hook-dry-run-batch.v1', task, calls };
}

export function runHookDryRunBatch(value: unknown): HookDryRunBatchResult {
  const batch = validateHookDryRunBatch(value);
  const decisions = batch.calls.map((call, index) => ({
    index,
    tool: call.tool,
    targetPath: call.targetPath,
    ...decideHookDryRun(batch.task, call)
  }));
  return {
    schema: 'ccpanes.hook-dry-run-batch-result.v1',
    taskId: batch.task.taskId,
    decisions
  };
}
