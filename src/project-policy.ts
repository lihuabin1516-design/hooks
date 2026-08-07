import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isPathInside } from './paths.js';
import type { CurrentTask, HookCall, TaskPhase } from './types.js';

export interface ProjectPolicyRuleMatch {
  tools: HookCall['tool'][];
  pathContains: string[];
  commandContains: string[];
  phases: TaskPhase[];
  reasons: string[];
}

export interface ProjectPolicyRule {
  id: string;
  enabled: boolean;
  effect: 'allow' | 'block';
  reason: string;
  match: ProjectPolicyRuleMatch;
}

export interface ProjectPolicy {
  schema: 'ccpanes.project-policy.v1';
  rules: ProjectPolicyRule[];
}

export class ProjectPolicyError extends Error {
  readonly code = 'project_policy_invalid';
}

const tools: HookCall['tool'][] = ['read', 'grep', 'glob', 'edit', 'write', 'apply_patch', 'shell'];
const phases: TaskPhase[] = ['shape', 'build', 'verify', 'archive'];

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectPolicyError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function normalizeStringList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new ProjectPolicyError(`${label} must be a string or string array`);
  }
  return value;
}

function normalizeToolList(value: unknown, label: string): HookCall['tool'][] {
  const items = normalizeStringList(value, label);
  for (const item of items) {
    if (!tools.includes(item as HookCall['tool'])) throw new ProjectPolicyError(`${label} contains invalid tool: ${item}`);
  }
  return items as HookCall['tool'][];
}

function normalizePhaseList(value: unknown, label: string): TaskPhase[] {
  const items = normalizeStringList(value, label);
  for (const item of items) {
    if (!phases.includes(item as TaskPhase)) throw new ProjectPolicyError(`${label} contains invalid phase: ${item}`);
  }
  return items as TaskPhase[];
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function validateRule(value: unknown, index: number): ProjectPolicyRule {
  const record = asRecord(value, `rules[${index}]`);
  if (typeof record.id !== 'string' || record.id.trim().length === 0) throw new ProjectPolicyError(`rules[${index}].id must be a non-empty string`);
  if (!(record.effect === 'allow' || record.effect === 'block')) throw new ProjectPolicyError(`rules[${index}].effect must be allow or block`);
  if (typeof record.reason !== 'string' || record.reason.trim().length === 0) throw new ProjectPolicyError(`rules[${index}].reason must be a non-empty string`);
  if (!(record.enabled === undefined || typeof record.enabled === 'boolean')) throw new ProjectPolicyError(`rules[${index}].enabled must be boolean`);
  const match = record.match === undefined ? {} : asRecord(record.match, `rules[${index}].match`);
  return {
    id: record.id,
    enabled: record.enabled !== false,
    effect: record.effect,
    reason: record.reason,
    match: {
      tools: normalizeToolList(firstDefined(match, ['tools', 'tool']), `rules[${index}].match.tools`),
      pathContains: normalizeStringList(match.pathContains, `rules[${index}].match.pathContains`),
      commandContains: normalizeStringList(match.commandContains, `rules[${index}].match.commandContains`),
      phases: normalizePhaseList(firstDefined(match, ['phases', 'phase']), `rules[${index}].match.phases`),
      reasons: normalizeStringList(firstDefined(match, ['reasons', 'reason']), `rules[${index}].match.reasons`)
    }
  };
}

export function validateProjectPolicy(value: unknown): ProjectPolicy {
  const record = asRecord(value, 'project policy');
  if (record.schema !== 'ccpanes.project-policy.v1') throw new ProjectPolicyError('schema must be ccpanes.project-policy.v1');
  if (!Array.isArray(record.rules)) throw new ProjectPolicyError('rules must be an array');
  return {
    schema: 'ccpanes.project-policy.v1',
    rules: record.rules.map((rule, index) => validateRule(rule, index))
  };
}

export function projectPolicyPath(worktreeRoot: string): string {
  return path.join(worktreeRoot, '.ccpanes-task', 'policy.json');
}

export async function readProjectPolicy(worktreeRoot: string): Promise<ProjectPolicy | null> {
  const policyPath = projectPolicyPath(worktreeRoot);
  if (!isPathInside(worktreeRoot, policyPath)) {
    throw new ProjectPolicyError('policy path must stay inside worktree root');
  }
  let text: string;
  try {
    text = await readFile(policyPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    return validateProjectPolicy(JSON.parse(text));
  } catch (error) {
    if (error instanceof ProjectPolicyError) throw error;
    throw new ProjectPolicyError(error instanceof Error ? error.message : String(error));
  }
}

function includesAny(haystack: string | null | undefined, needles: string[], normalize: (value: string) => string): boolean {
  if (needles.length === 0) return true;
  if (!haystack) return false;
  const normalizedHaystack = normalize(haystack);
  return needles.some((needle) => normalizedHaystack.includes(normalize(needle)));
}

function normalizeContainsFragment(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function ruleMatches(task: CurrentTask, call: HookCall, rule: ProjectPolicyRule): boolean {
  const match = rule.match;
  if (!rule.enabled) return false;
  if (match.tools.length > 0 && !match.tools.includes(call.tool)) return false;
  if (match.phases.length > 0 && !match.phases.includes(task.phase)) return false;
  if (!includesAny(call.targetPath, match.pathContains, normalizeContainsFragment)) return false;
  if (!includesAny(call.command, match.commandContains, (value) => value.toLowerCase())) return false;
  if (!includesAny(call.policyReason, match.reasons, (value) => value.toLowerCase())) return false;
  return true;
}

export function applyProjectPolicyToCall(task: CurrentTask, call: HookCall, policy: ProjectPolicy | null): HookCall {
  if (!policy) return call;
  let effect: HookCall['policyEffect'];
  let reason: string | undefined;
  for (const rule of policy.rules) {
    if (!ruleMatches(task, call, rule)) continue;
    effect = rule.effect;
    reason = rule.reason;
  }
  if (!effect) return call;
  return {
    ...call,
    policyEffect: effect,
    policyReason: reason
  };
}

export function applyProjectPolicyToCalls(task: CurrentTask, calls: HookCall[], policy: ProjectPolicy | null): HookCall[] {
  return calls.map((call) => applyProjectPolicyToCall(task, call, policy));
}
