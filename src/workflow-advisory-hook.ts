import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './paths.js';
import type { CurrentTask } from './types.js';
import { classifyWorkflowProfile } from './workflow-profile.js';

export const WORKFLOW_ADVISORY_CONTEXT_LIMIT = 1600;

export interface WorkflowAdvisoryHookEvent {
  cwd: string;
  prompt: string;
}

export interface WorkflowAdvisoryHookOutput {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit';
    additionalContext: string;
  };
}

export interface WorkflowAdvisoryAuditRecord {
  schema: 'ccpanes.workflow-advisory-audit.v1';
  taskId: string;
  workspace: string;
  worktreeRoot: string;
  cwd: string;
  promptSha256: string;
  promptLength: number;
  routeId: string;
  injected: boolean;
  reason: 'implementation_standard_available' | 'implementation_standard_not_applicable';
  contextLength: number;
  observedAt: string;
}

export interface WorkflowAdvisoryResult {
  output: WorkflowAdvisoryHookOutput | null;
  audit: WorkflowAdvisoryAuditRecord | null;
}

export interface CreateWorkflowAdvisoryInput {
  task: CurrentTask;
  event: unknown;
  now?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseWorkflowAdvisoryHookEvent(event: unknown): WorkflowAdvisoryHookEvent | null {
  const record = asRecord(event);
  if (!record) return null;
  if (record.hook_event_name !== undefined && record.hook_event_name !== 'UserPromptSubmit') return null;
  if (typeof record.cwd !== 'string' || record.cwd.trim().length === 0) return null;
  if (typeof record.prompt !== 'string' || record.prompt.trim().length === 0) return null;
  return {
    cwd: record.cwd,
    prompt: record.prompt.trim()
  };
}

function formatWorkflowAdvisoryContext(
  routeId: string,
  rigor: string,
  standard: NonNullable<ReturnType<typeof classifyWorkflowProfile>['implementationStandard']>
): string {
  const lines = [
    'ccpanes.workflow-advisory.v1',
    `route: ${routeId}`,
    `rigor: ${rigor}`,
    `implementationStandard: ${standard.schema}`,
    `level: ${standard.level}`,
    `optimizationTarget: ${standard.optimizationTarget}`,
    `principles: ${standard.principles.join('; ')}`,
    `nonNegotiables: ${standard.nonNegotiables.join('; ')}`,
    'authority: advisory only; current-task, project policy, hard hooks, production gates, and acceptance evidence retain authority.'
  ];
  const context = lines.join('\n');
  if (context.length > WORKFLOW_ADVISORY_CONTEXT_LIMIT) {
    throw new Error(`workflow advisory context exceeds ${WORKFLOW_ADVISORY_CONTEXT_LIMIT} characters`);
  }
  return context;
}

function promptSha256(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex').toUpperCase();
}

export function createWorkflowAdvisory(input: CreateWorkflowAdvisoryInput): WorkflowAdvisoryResult {
  const event = parseWorkflowAdvisoryHookEvent(input.event);
  if (!event || !isPathInside(input.task.worktreeRoot, event.cwd)) {
    return { output: null, audit: null };
  }

  const workflow = classifyWorkflowProfile({
    prompt: event.prompt,
    cwd: event.cwd
  });
  const standard = workflow.implementationStandard;
  const context = standard
    ? formatWorkflowAdvisoryContext(workflow.route.id, workflow.rigor, standard)
    : null;
  const injected = context !== null;
  const audit: WorkflowAdvisoryAuditRecord = {
    schema: 'ccpanes.workflow-advisory-audit.v1',
    taskId: input.task.taskId,
    workspace: input.task.workspace,
    worktreeRoot: input.task.worktreeRoot,
    cwd: event.cwd,
    promptSha256: promptSha256(event.prompt),
    promptLength: event.prompt.length,
    routeId: workflow.route.id,
    injected,
    reason: injected
      ? 'implementation_standard_available'
      : 'implementation_standard_not_applicable',
    contextLength: context?.length ?? 0,
    observedAt: input.now ?? new Date().toISOString()
  };

  return {
    output: context
      ? {
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: context
          }
        }
      : null,
    audit
  };
}

export async function appendWorkflowAdvisoryAudit(
  auditPath: string,
  record: WorkflowAdvisoryAuditRecord
): Promise<void> {
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.appendFile(auditPath, `${JSON.stringify(record)}\n`, 'utf8');
}
