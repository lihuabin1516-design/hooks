import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { CurrentTask } from './types.js';

export type AcceptanceCheckResult = 'pass' | 'fail' | 'blocked' | 'not-run';
export type AcceptanceTruthState = AcceptanceCheckResult | 'not-applicable';
export type AcceptanceTruthLayerName =
  | 'task-scope'
  | 'artifact-hashes'
  | 'repo-gates'
  | 'live-gates'
  | 'reference-repos'
  | 'user-config'
  | 'completion';

export interface AcceptanceCheck {
  name: string;
  command: string;
  result: AcceptanceCheckResult;
  evidence: string;
}

export interface ArtifactHash {
  path: string;
  sha256: string;
}

export interface AcceptanceTruthLayer {
  name: AcceptanceTruthLayerName;
  state: AcceptanceTruthState;
  required: boolean;
  evidence: string;
  reason: string;
}

export interface AcceptanceSummary {
  passed: boolean;
  completionAllowed: boolean;
  requiredLayerCount: number;
  failingLayerCount: number;
  blockedLayerCount: number;
  notRunLayerCount: number;
}

export interface AcceptanceEvidence {
  schema: 'ccpanes.acceptance.v1';
  taskId: string;
  worktreeRoot: string;
  branch: string | null;
  head: string | null;
  artifactHashes: ArtifactHash[];
  checks: AcceptanceCheck[];
  truthLayers: AcceptanceTruthLayer[];
  summary: AcceptanceSummary;
  recordedAt: string;
}

export interface AcceptanceTruthLayerInput {
  name: AcceptanceTruthLayerName;
  state: string;
  required?: boolean;
  evidence: string;
  reason?: string;
}

export interface CreateAcceptanceEvidenceInput {
  task: CurrentTask;
  artifacts: string[];
  checks: Array<{ name: string; command: string; result: string; evidence: string }>;
  truthLayers?: AcceptanceTruthLayerInput[];
  recordedAt?: string;
}

const validResults = new Set<AcceptanceCheckResult>(['pass', 'fail', 'blocked', 'not-run']);
const validTruthStates = new Set<AcceptanceTruthState>(['pass', 'fail', 'blocked', 'not-run', 'not-applicable']);
const truthLayerOrder: AcceptanceTruthLayerName[] = [
  'task-scope',
  'artifact-hashes',
  'repo-gates',
  'live-gates',
  'reference-repos',
  'user-config',
  'completion'
];
const validTruthLayerNames = new Set<AcceptanceTruthLayerName>(truthLayerOrder);

function validateCheck(check: { name: string; command: string; result: string; evidence: string }): AcceptanceCheck {
  if (!validResults.has(check.result as AcceptanceCheckResult)) {
    throw new Error(`invalid acceptance check result: ${check.result}`);
  }
  return { ...check, result: check.result as AcceptanceCheckResult };
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/\s+/g, ' ').toLowerCase();
}

function checkText(check: AcceptanceCheck): string {
  return normalize(`${check.name} ${check.command}`);
}

function truthLayer(name: AcceptanceTruthLayerName, state: AcceptanceTruthState, required: boolean, evidence: string, reason: string): AcceptanceTruthLayer {
  return { name, state, required, evidence, reason };
}

function validateTruthLayer(input: AcceptanceTruthLayerInput): AcceptanceTruthLayer {
  if (!validTruthLayerNames.has(input.name)) {
    throw new Error(`invalid acceptance truth layer: ${input.name}`);
  }
  if (!validTruthStates.has(input.state as AcceptanceTruthState)) {
    throw new Error(`invalid acceptance truth state: ${input.state}`);
  }
  return truthLayer(
    input.name,
    input.state as AcceptanceTruthState,
    input.required ?? true,
    input.evidence,
    input.reason ?? 'explicit_acceptance_truth'
  );
}

function stateFromChecks(checks: AcceptanceCheck[]): AcceptanceTruthState {
  if (checks.length === 0) return 'not-run';
  if (checks.some((check) => check.result === 'fail')) return 'fail';
  if (checks.some((check) => check.result === 'blocked')) return 'blocked';
  if (checks.some((check) => check.result === 'not-run')) return 'not-run';
  return 'pass';
}

function evidenceFromChecks(checks: AcceptanceCheck[]): string {
  if (checks.length === 0) return 'no checks recorded';
  return checks.map((check) => `${check.name}:${check.result}`).join(', ');
}

function matchesAny(check: AcceptanceCheck, patterns: RegExp[]): boolean {
  const text = checkText(check);
  return patterns.some((pattern) => pattern.test(text));
}

function isLiveCheck(check: AcceptanceCheck): boolean {
  return matchesAny(check, [/live/, /installed-hooks/, /verify-installed-hooks/]);
}

function isReferenceRepoCheck(check: AcceptanceCheck): boolean {
  return matchesAny(check, [/reference/, /comet/, /fastctx/]);
}

function isUserConfigCheck(check: AcceptanceCheck): boolean {
  return matchesAny(check, [/user-config/, /config snapshot/, /\.codex/, /\.cc-panes/, /hooks\.json/, /config\.toml/]);
}

export interface BuildAcceptanceTruthLayersInput {
  taskId: string;
  worktreeRoot: string;
  artifactCount: number;
  checks: AcceptanceCheck[];
  artifactHashState?: AcceptanceTruthState;
  artifactHashEvidence?: string;
  explicitTruthLayers?: AcceptanceTruthLayerInput[];
}

export function summarizeAcceptanceTruthLayers(truthLayers: AcceptanceTruthLayer[]): AcceptanceSummary {
  const requiredLayers = truthLayers.filter((layer) => layer.required);
  const failingLayerCount = requiredLayers.filter((layer) => layer.state === 'fail').length;
  const blockedLayerCount = requiredLayers.filter((layer) => layer.state === 'blocked').length;
  const notRunLayerCount = requiredLayers.filter((layer) => layer.state === 'not-run').length;
  const completionLayer = truthLayers.find((layer) => layer.name === 'completion');
  const completionAllowed = completionLayer?.state === 'pass';
  return {
    passed: completionAllowed,
    completionAllowed,
    requiredLayerCount: requiredLayers.length,
    failingLayerCount,
    blockedLayerCount,
    notRunLayerCount
  };
}

export function buildAcceptanceTruthLayers(input: BuildAcceptanceTruthLayersInput): AcceptanceTruthLayer[] {
  const explicitLayers = (input.explicitTruthLayers ?? []).map((layer) => validateTruthLayer(layer));
  const layerMap = new Map<AcceptanceTruthLayerName, AcceptanceTruthLayer>();
  const localChecks = input.checks.filter((check) => !isLiveCheck(check) && !isReferenceRepoCheck(check) && !isUserConfigCheck(check));
  const liveChecks = input.checks.filter((check) => isLiveCheck(check));
  const referenceChecks = input.checks.filter((check) => isReferenceRepoCheck(check));
  const userConfigChecks = input.checks.filter((check) => isUserConfigCheck(check));

  layerMap.set('task-scope', truthLayer(
    'task-scope',
    input.taskId && input.worktreeRoot ? 'pass' : 'fail',
    true,
    `taskId=${input.taskId}; worktreeRoot=${input.worktreeRoot}`,
    'binds acceptance evidence to the current task scope'
  ));
  layerMap.set('artifact-hashes', truthLayer(
    'artifact-hashes',
    input.artifactHashState ?? (input.artifactCount > 0 ? 'pass' : 'not-applicable'),
    input.artifactCount > 0,
    input.artifactHashEvidence ?? `artifactCount=${input.artifactCount}`,
    'binds declared artifacts by SHA-256'
  ));
  layerMap.set('repo-gates', truthLayer(
    'repo-gates',
    stateFromChecks(localChecks),
    true,
    evidenceFromChecks(localChecks),
    'records local checks that support the engineering claim'
  ));
  layerMap.set('live-gates', truthLayer(
    'live-gates',
    liveChecks.length > 0 ? stateFromChecks(liveChecks) : 'not-applicable',
    liveChecks.length > 0,
    evidenceFromChecks(liveChecks),
    'records live or installed hook verification when that surface is touched'
  ));
  layerMap.set('reference-repos', truthLayer(
    'reference-repos',
    referenceChecks.length > 0 ? stateFromChecks(referenceChecks) : 'not-applicable',
    referenceChecks.length > 0,
    evidenceFromChecks(referenceChecks),
    'records reference repository status evidence when required'
  ));
  layerMap.set('user-config', truthLayer(
    'user-config',
    userConfigChecks.length > 0 ? stateFromChecks(userConfigChecks) : 'not-applicable',
    userConfigChecks.length > 0,
    evidenceFromChecks(userConfigChecks),
    'records user configuration hash or snapshot evidence when required'
  ));

  for (const explicitLayer of explicitLayers) {
    if (explicitLayer.name !== 'live-gates' && explicitLayer.name !== 'reference-repos' && explicitLayer.name !== 'user-config') {
      throw new Error(`acceptance truth layer is derived from task/check/artifact evidence: ${explicitLayer.name}`);
    }
    layerMap.set(explicitLayer.name, explicitLayer);
  }

  const requiredBeforeCompletion = [...layerMap.values()].filter((layer) => layer.required);
  let completionState: AcceptanceTruthState = 'pass';
  if (requiredBeforeCompletion.some((layer) => layer.state === 'fail')) completionState = 'fail';
  else if (requiredBeforeCompletion.some((layer) => layer.state === 'blocked')) completionState = 'blocked';
  else if (requiredBeforeCompletion.some((layer) => layer.state === 'not-run')) completionState = 'not-run';

  layerMap.set('completion', truthLayer(
    'completion',
    completionState,
    true,
    requiredBeforeCompletion.map((layer) => `${layer.name}:${layer.state}`).join(', '),
    'completion language is allowed only when all required truth layers pass'
  ));

  return truthLayerOrder.map((name) => layerMap.get(name)).filter((layer): layer is AcceptanceTruthLayer => layer !== undefined);
}

async function hashFile(filePath: string): Promise<ArtifactHash> {
  const bytes = await fs.readFile(filePath);
  return {
    path: filePath,
    sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase()
  };
}

export async function createAcceptanceEvidence(input: CreateAcceptanceEvidenceInput): Promise<AcceptanceEvidence> {
  const artifactHashes = await Promise.all(input.artifacts.map((artifact) => hashFile(artifact)));
  const checks = input.checks.map((check) => validateCheck(check));
  const truthLayers = buildAcceptanceTruthLayers({
    taskId: input.task.taskId,
    worktreeRoot: input.task.worktreeRoot,
    artifactCount: artifactHashes.length,
    checks,
    explicitTruthLayers: input.truthLayers
  });
  return {
    schema: 'ccpanes.acceptance.v1',
    taskId: input.task.taskId,
    worktreeRoot: input.task.worktreeRoot,
    branch: input.task.branch,
    head: input.task.head,
    artifactHashes,
    checks,
    truthLayers,
    summary: summarizeAcceptanceTruthLayers(truthLayers),
    recordedAt: input.recordedAt ?? new Date().toISOString()
  };
}
