import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CurrentTask, GitState } from './types.js';
import { generateContextCheckpoint, type ContextCheckpointResult } from './codex-context-checkpoint.js';

export const CONTEXT_PROJECTION_SCHEMA = 'ccpanes.context-projection-input.v1';
const MAX_PROJECTION_BYTES = 64 * 1024;
const MAX_STRING = 512;
const MAX_LIST = 32;

export interface ContextProjectionInput {
  schema: typeof CONTEXT_PROJECTION_SCHEMA;
  taskId: string;
  workspace: string;
  projectPath: string;
  worktreeRoot: string;
  generatedAt: string;
  goal: string | null;
  workflow: string | null;
  worker: string | null;
  session: string | null;
  git: GitState | null;
  acceptance: string[];
  blockers: string[];
  nextActions: string[];
  completedMilestones: string[];
  decisions: string[];
  verificationEvidence: string[];
  snapshotGeneration?: number;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_STRING) {
    throw new Error(`invalid context projection: ${field}`);
  }
  return value.trim();
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return requiredString(value, field);
}

function boundedList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_LIST) {
    throw new Error(`invalid context projection: ${field}`);
  }
  return value.map((item, index) => requiredString(item, `${field}[${index}]`));
}

function gitProjection(value: unknown): GitState | null {
  if (value === null || value === undefined) return null;
  const item = record(value);
  const root = nullableString(item.root, 'git.root');
  const branch = nullableString(item.branch, 'git.branch');
  const head = nullableString(item.head, 'git.head');
  if (typeof item.dirty !== 'boolean' || typeof item.statusShort !== 'string' || item.statusShort.length > MAX_STRING) {
    throw new Error('invalid context projection: git');
  }
  return { root, branch, head, dirty: item.dirty, statusShort: item.statusShort };
}

function assertNoUnknownFields(value: Record<string, unknown>): void {
  const allowed = new Set([
    'schema', 'taskId', 'workspace', 'projectPath', 'worktreeRoot',
    'generatedAt', 'goal', 'workflow', 'worker', 'session', 'git',
    'acceptance', 'blockers', 'nextActions', 'completedMilestones',
    'decisions', 'verificationEvidence', 'snapshotGeneration'
  ]);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`invalid context projection: unknown field ${unknown}`);
}

export function validateContextProjection(value: unknown): ContextProjectionInput {
  const item = record(value);
  assertNoUnknownFields(item);
  if (item.schema !== CONTEXT_PROJECTION_SCHEMA) {
    throw new Error(`invalid context projection: schema must be ${CONTEXT_PROJECTION_SCHEMA}`);
  }
  const generation = item.snapshotGeneration;
  if (
    generation !== undefined &&
    (typeof generation !== 'number' || !Number.isSafeInteger(generation) || generation < 1)
  ) {
    throw new Error('invalid context projection: snapshotGeneration');
  }
  return {
    schema: CONTEXT_PROJECTION_SCHEMA,
    taskId: requiredString(item.taskId, 'taskId'),
    workspace: requiredString(item.workspace, 'workspace'),
    projectPath: requiredString(item.projectPath, 'projectPath'),
    worktreeRoot: requiredString(item.worktreeRoot, 'worktreeRoot'),
    generatedAt: requiredString(item.generatedAt, 'generatedAt'),
    goal: nullableString(item.goal, 'goal'),
    workflow: nullableString(item.workflow, 'workflow'),
    worker: nullableString(item.worker, 'worker'),
    session: nullableString(item.session, 'session'),
    git: gitProjection(item.git),
    acceptance: boundedList(item.acceptance ?? [], 'acceptance'),
    blockers: boundedList(item.blockers ?? [], 'blockers'),
    nextActions: boundedList(item.nextActions ?? [], 'nextActions'),
    completedMilestones: boundedList(item.completedMilestones ?? [], 'completedMilestones'),
    decisions: boundedList(item.decisions ?? [], 'decisions'),
    verificationEvidence: boundedList(item.verificationEvidence ?? [], 'verificationEvidence'),
    snapshotGeneration: generation as number | undefined
  };
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

export function checkpointFromProjection(
  projection: ContextProjectionInput,
  task: CurrentTask
): ContextCheckpointResult {
  if (
    projection.taskId !== task.taskId ||
    !samePath(projection.projectPath, task.projectPath) ||
    !samePath(projection.worktreeRoot, task.worktreeRoot)
  ) {
    throw new Error('context projection does not match current task binding');
  }
  return generateContextCheckpoint({
    task,
    git: projection.git,
    goalState: projection.goal,
    workflowState: projection.workflow,
    workerState: projection.worker,
    blockers: projection.blockers,
    nextActions: projection.nextActions,
    completedMilestones: projection.completedMilestones,
    decisions: projection.decisions,
    verificationEvidence: [
      ...projection.acceptance,
      ...projection.verificationEvidence
    ],
    snapshotGeneration: projection.snapshotGeneration,
    now: projection.generatedAt
  });
}

export async function readContextProjection(filePath: string): Promise<ContextProjectionInput> {
  const absolute = path.resolve(filePath);
  const stat = await fs.stat(absolute);
  if (!stat.isFile() || stat.size > MAX_PROJECTION_BYTES) {
    throw new Error('context projection must be a regular file under 64 KiB');
  }
  return validateContextProjection(JSON.parse(await fs.readFile(absolute, 'utf8')));
}

export function projectionDigest(projection: ContextProjectionInput): string {
  return createHash('sha256')
    .update(JSON.stringify(projection), 'utf8')
    .digest('hex')
    .toUpperCase();
}
