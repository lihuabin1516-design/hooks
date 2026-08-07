import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  clearProjectPolicyRules,
  readProjectPolicyOrEmpty,
  writeProjectPolicyAtomic,
  type ProjectPolicyRuleInput
} from './project-policy.js';
import { captureProjectPolicyInstruction, type ProjectPolicyCaptureResult } from './project-policy-capture.js';
import { appendProjectPolicyLedgerEntry } from './project-policy-ledger.js';
import type { HookCall, TaskPhase } from './types.js';

export type PlanPolicyCaptureKind = 'capture' | 'clear';

export interface PlanPolicyCaptureAction {
  kind: PlanPolicyCaptureKind;
  instruction: string;
  id: string;
  effect?: ProjectPolicyRuleInput['effect'];
  reason: string;
  match?: Partial<{
    tools: HookCall['tool'][];
    pathContains: string[];
    commandContains: string[];
    phases: TaskPhase[];
    reasons: string[];
  }>;
  notes: string;
}

export type PlanPolicyCaptureActionStatus = 'captured' | 'cleared' | 'skipped';

export interface PlanPolicyCaptureActionResult {
  status: PlanPolicyCaptureActionStatus;
  kind: PlanPolicyCaptureKind | 'none';
  instruction: string;
  id: string | null;
  effect?: ProjectPolicyRuleInput['effect'];
  reason: string;
  disabledRuleCount?: number;
  capture?: ProjectPolicyCaptureResult;
}

export interface PlanPolicyCaptureInput {
  projectRoot: string;
  text: string;
  now?: string | null;
}

export interface PlanPolicyCaptureResult {
  schema: 'ccpanes.plan-policy-capture-result.v1';
  projectRoot: string;
  changed: boolean;
  detectedCount: number;
  capturedCount: number;
  clearedCount: number;
  skippedCount: number;
  actions: PlanPolicyCaptureActionResult[];
}

const commandBlockPattern = /(?:禁止|不要|阻止|限制|block|forbid|deny).{0,16}(?:运行|执行|run|execute)\s+([^\s，。；;]+)/iu;
const commandAllowPattern = /(?:允许|开放|放开|allow|open).{0,16}(?:运行|执行|run|execute)\s+([^\s，。；;]+)/iu;
const pathBlockPattern = /(?:禁止|不要|阻止|限制|block|forbid|deny).{0,16}(?:修改|写入|编辑|改动|edit|write|modify)\s+([^\s，。；;]+)/iu;
const pathAllowPattern = /(?:允许|开放|放开|allow|open).{0,16}(?:修改|写入|编辑|改动|edit|write|modify)\s+([^\s，。；;]+)/iu;
const clearPattern = /(?:清除|清空|解除|clear|disable).{0,12}(?:所有|全部|all)?(?:限制|规则|项目规则|policy|policies|rules)/iu;

function normalizeInstructionText(text: string): string[] {
  return text
    .split(/\r?\n|[；;]/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function shortHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
}

function slug(value: string): string {
  const normalized = value
    .replace(/\\/g, '/')
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/[/_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized.length > 0 ? normalized.slice(0, 40) : 'rule';
}

function stableRuleId(kind: string, target: string): string {
  return `plan-${kind}-${slug(target)}-${shortHash(`${kind}:${target}`)}`;
}

function phasesFromInstruction(instruction: string): TaskPhase[] {
  const phases: TaskPhase[] = [];
  const lower = instruction.toLowerCase();
  if (/(?:shape|需求|规划|方案)\s*阶段/iu.test(lower)) phases.push('shape');
  if (/(?:build|implement|implementation|开发|实现|构建)\s*阶段/iu.test(lower)) phases.push('build');
  if (/(?:verify|verification|test|测试|验证|验收)\s*阶段/iu.test(lower)) phases.push('verify');
  if (/(?:archive|handoff|归档|交接)\s*阶段/iu.test(lower)) phases.push('archive');
  return phases;
}

function captureAction(
  instruction: string,
  kind: 'block-command' | 'allow-command' | 'block-path' | 'allow-path',
  target: string
): PlanPolicyCaptureAction {
  if (kind === 'block-command' || kind === 'allow-command') {
    const effect = kind === 'block-command' ? 'block' : 'allow';
    const reason = kind === 'block-command' ? 'plan_block_command' : 'plan_allow_command';
    return {
      kind: 'capture',
      instruction,
      id: stableRuleId(kind, target),
      effect,
      reason,
      match: { tools: ['shell'], commandContains: [target], phases: phasesFromInstruction(instruction) },
      notes: `policy-capture-plan; command=${target}`
    };
  }

  const effect = kind === 'block-path' ? 'block' : 'allow';
  const reason = kind === 'block-path' ? 'plan_block_path' : 'plan_allow_path';
  return {
    kind: 'capture',
    instruction,
    id: stableRuleId(kind, target),
    effect,
    reason,
    match: {
      tools: ['edit', 'write', 'apply_patch'],
      pathContains: [target],
      phases: phasesFromInstruction(instruction)
    },
    notes: `policy-capture-plan; path=${target}`
  };
}

function matchTarget(instruction: string, pattern: RegExp): string | null {
  const matched = instruction.match(pattern);
  return matched?.[1]?.trim() || null;
}

export function detectPlanPolicyInstructions(text: string): PlanPolicyCaptureAction[] {
  const actions: PlanPolicyCaptureAction[] = [];
  const seen = new Set<string>();

  for (const instruction of normalizeInstructionText(text)) {
    let action: PlanPolicyCaptureAction | null = null;
    if (clearPattern.test(instruction)) {
      action = {
        kind: 'clear',
        instruction,
        id: stableRuleId('clear-policy', instruction),
        reason: 'plan_cleared_policy',
        notes: 'policy-capture-plan; disable all executable project policy rules'
      };
    } else {
      const blockCommand = matchTarget(instruction, commandBlockPattern);
      const allowCommand = blockCommand ? null : matchTarget(instruction, commandAllowPattern);
      const blockPath = blockCommand || allowCommand ? null : matchTarget(instruction, pathBlockPattern);
      const allowPath = blockCommand || allowCommand || blockPath ? null : matchTarget(instruction, pathAllowPattern);

      if (blockCommand) action = captureAction(instruction, 'block-command', blockCommand);
      else if (allowCommand) action = captureAction(instruction, 'allow-command', allowCommand);
      else if (blockPath) action = captureAction(instruction, 'block-path', blockPath);
      else if (allowPath) action = captureAction(instruction, 'allow-path', allowPath);
    }

    if (!action || seen.has(action.id)) continue;
    seen.add(action.id);
    actions.push(action);
  }

  return actions;
}

async function applyClearAction(projectRoot: string, action: PlanPolicyCaptureAction, now: string): Promise<PlanPolicyCaptureActionResult> {
  const policy = await readProjectPolicyOrEmpty(projectRoot);
  const cleared = clearProjectPolicyRules(policy);
  await writeProjectPolicyAtomic(projectRoot, cleared);
  await appendProjectPolicyLedgerEntry(projectRoot, {
    time: now,
    instruction: action.instruction,
    effectiveAction: `clear:${action.reason}`,
    notes: `${action.notes}; disabledRules=${policy.rules.length}`
  });
  return {
    status: 'cleared',
    kind: 'clear',
    instruction: action.instruction,
    id: action.id,
    reason: action.reason,
    disabledRuleCount: policy.rules.length
  };
}

export async function capturePlanPolicyInstructions(input: PlanPolicyCaptureInput): Promise<PlanPolicyCaptureResult> {
  const actions = detectPlanPolicyInstructions(input.text);
  if (actions.length === 0) {
    return {
      schema: 'ccpanes.plan-policy-capture-result.v1',
      projectRoot: input.projectRoot,
      changed: false,
      detectedCount: 0,
      capturedCount: 0,
      clearedCount: 0,
      skippedCount: 1,
      actions: [{
        status: 'skipped',
        kind: 'none',
        instruction: input.text,
        id: null,
        reason: 'no_plan_policy_candidate'
      }]
    };
  }

  const now = input.now ?? new Date().toISOString();
  const results: PlanPolicyCaptureActionResult[] = [];
  for (const action of actions) {
    if (action.kind === 'clear') {
      results.push(await applyClearAction(input.projectRoot, action, now));
      continue;
    }
    if (!action.effect) throw new Error(`plan policy capture action missing effect: ${action.id}`);
    const capture = await captureProjectPolicyInstruction({
      projectRoot: input.projectRoot,
      id: action.id,
      instruction: action.instruction,
      effect: action.effect,
      reason: action.reason,
      match: action.match,
      replace: true,
      notes: action.notes,
      now
    });
    results.push({
      status: 'captured',
      kind: 'capture',
      instruction: action.instruction,
      id: action.id,
      effect: action.effect,
      reason: action.reason,
      capture
    });
  }

  const capturedCount = results.filter((result) => result.status === 'captured').length;
  const clearedCount = results.filter((result) => result.status === 'cleared').length;
  return {
    schema: 'ccpanes.plan-policy-capture-result.v1',
    projectRoot: input.projectRoot,
    changed: results.some((result) => result.status === 'captured' || result.status === 'cleared'),
    detectedCount: actions.length,
    capturedCount,
    clearedCount,
    skippedCount: results.filter((result) => result.status === 'skipped').length,
    actions: results
  };
}

export async function readPlanPolicyCaptureText(inputPath: string): Promise<string> {
  return readFile(inputPath, 'utf8');
}
