import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { detectPlanPolicyInstructions, type PlanPolicyCaptureAction } from './plan-policy-capture.js';
import { classifyWorkflowProfile, type WorkflowProfileResult } from './workflow-profile.js';

export type PlanIntakePolicyPreviewStatus = 'would_capture' | 'would_clear' | 'skipped';

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
