import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CodexContextAction,
  CodexContextPressure,
  CodexContextPressureResult
} from './codex-context-pressure.js';
import type { CurrentTask } from './types.js';
import type { WorkflowAdvisoryHookOutput } from './workflow-advisory-hook.js';

export const CODEX_CONTEXT_ADVISORY_CONTEXT_LIMIT = 700;
export const USER_PROMPT_SUBMIT_COMBINED_CONTEXT_LIMIT = 1800;

export type CodexContextAdvisoryReason =
  | 'actionable'
  | 'not-actionable'
  | 'unavailable'
  | 'stale';

export interface CodexContextAdvisoryAuditRecord {
  schema: 'ccpanes.codex-context-advisory-audit.v1';
  taskId: string;
  workspace: string;
  worktreeRoot: string;
  threadRef: string | null;
  rolloutRef: string | null;
  pressure: CodexContextPressure;
  action: CodexContextAction;
  freshness: CodexContextPressureResult['freshness'];
  contextTokens: number | null;
  modelContextWindow: number | null;
  remainingTokens: number | null;
  checkpointRequired: boolean;
  injected: boolean;
  reason: CodexContextAdvisoryReason;
  contextLength: number;
  observedAt: string;
}

export interface CodexContextAdvisoryResult {
  output: WorkflowAdvisoryHookOutput | null;
  audit: CodexContextAdvisoryAuditRecord;
}

export interface CreateCodexContextAdvisoryInput {
  task: CurrentTask;
  pressure: CodexContextPressureResult;
  now?: string;
}

function instructionFor(action: CodexContextAction): string | null {
  switch (action) {
    case 'update-context':
      return 'update context.md after the current atomic step; preserve task scope and unresolved gates';
    case 'rotate-context-and-checkpoint':
      return 'stop scope expansion; rotate context.md snapshots and create a verified checkpoint';
    case 'reconcile-after-compaction':
      return 'reconcile system summary + context.md + Git + Goal + Workflow/Session authority before continuing';
    default:
      return null;
  }
}

function advisoryReason(
  pressure: CodexContextPressureResult
): CodexContextAdvisoryReason {
  if (pressure.availability !== 'available') return 'unavailable';
  if (pressure.freshness === 'stale') return 'stale';
  return instructionFor(pressure.action) ? 'actionable' : 'not-actionable';
}

function formatContext(pressure: CodexContextPressureResult): string {
  const instruction = instructionFor(pressure.action);
  if (!instruction) throw new Error('context pressure action is not advisory');
  const tokenWindow = pressure.contextTokens !== null &&
    pressure.modelContextWindow !== null
    ? `${pressure.contextTokens}/${pressure.modelContextWindow}`
    : 'unknown';
  const remaining = pressure.remainingTokens ?? 'unknown';
  const thresholds = pressure.softThresholdTokens !== null &&
    pressure.hardThresholdTokens !== null
    ? `${pressure.softThresholdTokens}/${pressure.hardThresholdTokens}`
    : 'unknown';
  const context = [
    'hooks.codex-context-pressure-advisory/v1',
    `pressure: ${pressure.pressure}`,
    `action: ${pressure.action}`,
    `contextTokens: ${tokenWindow}`,
    `remainingTokens: ${remaining}`,
    `softHardThresholds: ${thresholds}`,
    `freshness: ${pressure.freshness}`,
    `checkpointRequired: ${pressure.checkpointRequired}`,
    `instruction: ${instruction}`,
    'authority: advisory only; verify Git, Goal, Workflow and Session state before claiming completion.'
  ].join('\n');
  if (context.length > CODEX_CONTEXT_ADVISORY_CONTEXT_LIMIT) {
    throw new Error(
      `Codex context advisory exceeds ${CODEX_CONTEXT_ADVISORY_CONTEXT_LIMIT} characters`
    );
  }
  return context;
}

export function createCodexContextAdvisory(
  input: CreateCodexContextAdvisoryInput
): CodexContextAdvisoryResult {
  const reason = advisoryReason(input.pressure);
  const context = reason === 'actionable'
    ? formatContext(input.pressure)
    : null;
  return {
    output: context
      ? {
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: context
          }
        }
      : null,
    audit: {
      schema: 'ccpanes.codex-context-advisory-audit.v1',
      taskId: input.task.taskId,
      workspace: input.task.workspace,
      worktreeRoot: input.task.worktreeRoot,
      threadRef: input.pressure.threadRef,
      rolloutRef: input.pressure.rolloutRef,
      pressure: input.pressure.pressure,
      action: input.pressure.action,
      freshness: input.pressure.freshness,
      contextTokens: input.pressure.contextTokens,
      modelContextWindow: input.pressure.modelContextWindow,
      remainingTokens: input.pressure.remainingTokens,
      checkpointRequired: input.pressure.checkpointRequired,
      injected: context !== null,
      reason,
      contextLength: context?.length ?? 0,
      observedAt: input.now ?? new Date().toISOString()
    }
  };
}

function compactWorkflowContext(context: string): string {
  const retainedPrefixes = [
    'ccpanes.workflow-advisory.',
    'route:',
    'rigor:',
    'implementationStandard:',
    'level:',
    'optimizationTarget:',
    'authority:'
  ];
  return context
    .split(/\r?\n/u)
    .filter((line) => retainedPrefixes.some((prefix) => line.startsWith(prefix)))
    .join('\n');
}

export function combineUserPromptSubmitAdvisories(
  workflow: WorkflowAdvisoryHookOutput | null,
  contextPressure: WorkflowAdvisoryHookOutput | null
): WorkflowAdvisoryHookOutput | null {
  if (!workflow) return contextPressure;
  if (!contextPressure) return workflow;
  const pressureContext =
    contextPressure.hookSpecificOutput.additionalContext;
  let workflowContext = workflow.hookSpecificOutput.additionalContext;
  let combined = `${workflowContext}\n\n${pressureContext}`;
  if (combined.length > USER_PROMPT_SUBMIT_COMBINED_CONTEXT_LIMIT) {
    workflowContext = compactWorkflowContext(workflowContext);
    combined = `${workflowContext}\n\n${pressureContext}`;
  }
  if (combined.length > USER_PROMPT_SUBMIT_COMBINED_CONTEXT_LIMIT) {
    return contextPressure;
  }
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: combined
    }
  };
}

export async function appendCodexContextAdvisoryAudit(
  auditPath: string,
  record: CodexContextAdvisoryAuditRecord
): Promise<void> {
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.appendFile(auditPath, `${JSON.stringify(record)}\n`, 'utf8');
}
