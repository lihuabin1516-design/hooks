import fs from 'node:fs/promises';
import path from 'node:path';
import type { CurrentTask, TaskPhase } from './types.js';

const MAX_CURRENT_TASK_BYTES = 16 * 1024;
const phases: TaskPhase[] = ['shape', 'build', 'verify', 'archive'];
const sources: CurrentTask['source'][] = ['leader', 'worker', 'manual-import'];

export function currentTaskPath(worktreeRoot: string): string {
  return path.join(worktreeRoot, '.ccpanes-task', 'current-task.json');
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid current task: ${field}`);
  }
}

function assertNullableString(value: unknown, field: string): asserts value is string | null {
  if (!(typeof value === 'string' || value === null)) {
    throw new Error(`invalid current task: ${field}`);
  }
}

export function validateCurrentTask(value: unknown): CurrentTask {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid current task: object');
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== 'ccpanes.task-selection.v1') throw new Error('invalid current task: schema');
  assertString(record.taskId, 'taskId');
  assertString(record.workspace, 'workspace');
  assertString(record.projectPath, 'projectPath');
  assertString(record.worktreeRoot, 'worktreeRoot');
  assertNullableString(record.mainRepoRoot, 'mainRepoRoot');
  assertNullableString(record.branch, 'branch');
  assertNullableString(record.head, 'head');
  if (!record.owner || typeof record.owner !== 'object') throw new Error('invalid current task: owner');
  const owner = record.owner as Record<string, unknown>;
  assertNullableString(owner.leaderSessionId, 'owner.leaderSessionId');
  assertNullableString(owner.paneId, 'owner.paneId');
  assertNullableString(owner.layoutId, 'owner.layoutId');
  if (!phases.includes(record.phase as TaskPhase)) throw new Error('invalid current task: phase');
  assertString(record.createdAt, 'createdAt');
  assertString(record.updatedAt, 'updatedAt');
  if (!sources.includes(record.source as CurrentTask['source'])) throw new Error('invalid current task: source');
  assertString(record.notes, 'notes');
  return record as unknown as CurrentTask;
}

export async function readCurrentTask(worktreeRoot: string): Promise<CurrentTask | null> {
  const file = currentTaskPath(worktreeRoot);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (stat.size > MAX_CURRENT_TASK_BYTES) {
    throw new Error('current-task.json exceeds 16384 bytes');
  }
  const text = await fs.readFile(file, 'utf8');
  return validateCurrentTask(JSON.parse(text));
}

export interface ResolvedCurrentTask {
  task: CurrentTask;
  taskPath: string;
  projectRoot: string;
}

export async function resolveCurrentTaskFromCwd(cwd: string): Promise<ResolvedCurrentTask | null> {
  let current = path.resolve(cwd);
  for (;;) {
    const taskPath = currentTaskPath(current);
    try {
      const stat = await fs.stat(taskPath);
      if (stat.size > MAX_CURRENT_TASK_BYTES) {
        throw new Error('current-task.json exceeds 16384 bytes');
      }
      const task = validateCurrentTask(JSON.parse(await fs.readFile(taskPath, 'utf8')));
      return { task, taskPath, projectRoot: current };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function writeCurrentTaskAtomic(worktreeRoot: string, task: CurrentTask): Promise<void> {
  validateCurrentTask(task);
  const dir = path.join(worktreeRoot, '.ccpanes-task');
  await fs.mkdir(dir, { recursive: true });
  const finalPath = currentTaskPath(worktreeRoot);
  const tempPath = path.join(dir, `current-task.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, finalPath);
}
