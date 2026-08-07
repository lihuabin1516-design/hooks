import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { detectPlanPolicyInstructions, type PlanPolicyCaptureAction } from './plan-policy-capture.js';
import { classifyWorkflowProfile, type WorkflowProfileResult } from './workflow-profile.js';

export type PlanIntakePolicyPreviewStatus = 'would_capture' | 'would_clear' | 'skipped';

export const PLAN_LIFECYCLE_EVENT_SCHEMA = 'ccpanes.plan-lifecycle-event.v1' as const;

export interface PlanIntakePolicyPreviewAction {
  status: PlanIntakePolicyPreviewStatus;
  kind: PlanPolicyCaptureAction['kind'] | 'none';
  instruction: string;
  id: string | null;
  effect?: PlanPolicyCaptureAction['effect'];
  reason: string;
  match?: PlanPolicyCaptureAction['match'];
  notes?: string;
}

export interface PlanIntakePolicyPreview {
  detectedCount: number;
  wouldCaptureCount: number;
  wouldClearCount: number;
  skippedCount: number;
  wouldChangeProjectPolicy: boolean;
  actions: PlanIntakePolicyPreviewAction[];
}

export interface PlanIntakeInput {
  projectRoot: string;
  text: string;
  prompt?: string | null;
  changedPaths?: string[] | null;
  now?: string | null;
}

export interface PlanIntakeResult {
  schema: 'ccpanes.plan-intake.v1';
  mode: 'dry-run';
  projectRoot: string;
  changed: false;
  prompt: string;
  textLength: number;
  workflow: WorkflowProfileResult;
  policyPreview: PlanIntakePolicyPreview;
  recommendedNextCommands: string[];
  gates: string[];
  recordedAt: string;
}

export interface NormalizePlanLifecycleEventInput {
  event: unknown;
  fallbackCwd?: string | null;
  fallbackPrompt?: string | null;
  fallbackText?: string | null;
  fallbackChangedPaths?: string[] | null;
}

export interface NormalizedPlanLifecycleEvent {
  schema: typeof PLAN_LIFECYCLE_EVENT_SCHEMA;
  cwd: string | null;
  prompt: string | null;
  text: string;
  changedPaths: string[];
  source: string | null;
}

function planLifecycleEventRecord(event: unknown): Record<string, unknown> {
  if (event === null || event === undefined) return {};
  if (typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('invalid plan lifecycle event: object');
  }
  return event as Record<string, unknown>;
}

function optionalEventString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`invalid plan lifecycle event: ${field}`);
  return value;
}

function optionalEventStringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`invalid plan lifecycle event: ${field}`);
  }
  return value;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function previewAction(action: PlanPolicyCaptureAction): PlanIntakePolicyPreviewAction {
  return {
    status: action.kind === 'clear' ? 'would_clear' : 'would_capture',
    kind: action.kind,
    instruction: action.instruction,
    id: action.id,
    effect: action.effect,
    reason: action.reason,
    match: action.match,
    notes: action.notes
  };
}

function createPolicyPreview(text: string): PlanIntakePolicyPreview {
  const actions = detectPlanPolicyInstructions(text);
  if (actions.length === 0) {
    return {
      detectedCount: 0,
      wouldCaptureCount: 0,
      wouldClearCount: 0,
      skippedCount: 1,
      wouldChangeProjectPolicy: false,
      actions: [{
        status: 'skipped',
        kind: 'none',
        instruction: text,
        id: null,
        reason: 'no_plan_policy_candidate'
      }]
    };
  }

  const previewActions = actions.map((action) => previewAction(action));
  const wouldCaptureCount = previewActions.filter((action) => action.status === 'would_capture').length;
  const wouldClearCount = previewActions.filter((action) => action.status === 'would_clear').length;
  return {
    detectedCount: actions.length,
    wouldCaptureCount,
    wouldClearCount,
    skippedCount: 0,
    wouldChangeProjectPolicy: wouldCaptureCount > 0 || wouldClearCount > 0,
    actions: previewActions
  };
}

function profilePrompt(input: PlanIntakeInput): string {
  const prompt = input.prompt?.trim();
  const lines = prompt && prompt.length > 0 ? [prompt, ...nonEmptyLines(input.text)] : nonEmptyLines(input.text);
  return lines.join('\n');
}

function nextCommands(projectRoot: string, text: string, policyPreview: PlanIntakePolicyPreview): string[] {
  const commands = [
    `node dist/src/cli.js classify-workflow --prompt "<plan text>" --cwd "${projectRoot}"`
  ];
  if (policyPreview.wouldChangeProjectPolicy) {
    commands.push(`node dist/src/cli.js policy-capture-plan --root "${projectRoot}" --utterance "${text.replace(/"/g, '\\"')}"`);
  }
  return commands;
}

export function normalizePlanLifecycleEvent(input: NormalizePlanLifecycleEventInput): NormalizedPlanLifecycleEvent {
  const record = planLifecycleEventRecord(input.event);
  const schema = optionalEventString(record, 'schema');
  if (schema !== null && schema !== PLAN_LIFECYCLE_EVENT_SCHEMA) {
    throw new Error('invalid plan lifecycle event: schema');
  }

  return {
    schema: PLAN_LIFECYCLE_EVENT_SCHEMA,
    cwd: firstNonEmpty(optionalEventString(record, 'cwd'), input.fallbackCwd),
    prompt: firstNonEmpty(input.fallbackPrompt, optionalEventString(record, 'prompt')),
    text: firstNonEmpty(
      optionalEventString(record, 'planText'),
      optionalEventString(record, 'utterance'),
      optionalEventString(record, 'text'),
      input.fallbackText
    ) ?? '',
    changedPaths: uniqueNonEmpty([
      ...optionalEventStringArray(record, 'changedPaths'),
      ...(input.fallbackChangedPaths ?? [])
    ]),
    source: firstNonEmpty(optionalEventString(record, 'source'))
  };
}

export function createPlanIntake(input: PlanIntakeInput): PlanIntakeResult {
  const prompt = profilePrompt(input);
  const policyPreview = createPolicyPreview(input.text);
  const workflow = classifyWorkflowProfile({
    prompt,
    cwd: input.projectRoot,
    changedPaths: input.changedPaths
  });
  return {
    schema: 'ccpanes.plan-intake.v1',
    mode: 'dry-run',
    projectRoot: input.projectRoot,
    changed: false,
    prompt,
    textLength: input.text.length,
    workflow,
    policyPreview,
    recommendedNextCommands: nextCommands(input.projectRoot, input.text, policyPreview),
    gates: [
      'plan-intake is dry-run only; it does not write policy.md or policy.json',
      'policy-capture-plan remains the only plan-stage command that mutates project policy files',
      'classify-workflow remains advisory; hard write boundaries stay in hook-enforce and permission-enforce'
    ],
    recordedAt: input.now ?? new Date().toISOString()
  };
}

export async function writePlanIntakeAuditAtomic(outPath: string, result: PlanIntakeResult): Promise<void> {
  const resolvedOut = path.resolve(outPath);
  await mkdir(path.dirname(resolvedOut), { recursive: true });
  const tempPath = path.join(path.dirname(resolvedOut), `${path.basename(resolvedOut)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await rename(tempPath, resolvedOut);
}

export function planIntakeAuditPathFromRoot(auditRoot: string, taskId: string): string {
  return path.join(auditRoot, Buffer.from(taskId, 'utf8').toString('base64url'), 'plan-intake-audit.json');
}
