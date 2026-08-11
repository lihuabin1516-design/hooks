import fs from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';
import { GitTopologyError, readGitState, readGitTopology } from './git-state.js';
import { isPathInside, normalizeForComparison } from './paths.js';
import type {
  CurrentTask,
  GitTopology,
  TaskBindingCheck,
  TaskOwner,
  TaskPhase
} from './types.js';

const MAX_CURRENT_TASK_BYTES = 16 * 1024;
const phases: TaskPhase[] = ['shape', 'build', 'verify', 'archive'];
const sources: CurrentTask['source'][] = ['leader', 'worker', 'manual-import'];

interface TaskDirectoryBoundary {
  dir: string;
  realRoot: string;
  realDir: string;
  stat: Stats;
}

export function currentTaskPath(worktreeRoot: string): string {
  return path.join(worktreeRoot, '.ccpanes-task', 'current-task.json');
}

async function lstatIfExists(candidate: string): Promise<Stats | null> {
  try {
    return await fs.lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertNotSymbolicLink(stat: Stats, label: string): void {
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link`);
  }
}

async function inspectTaskDirectoryBoundary(
  worktreeRoot: string,
  create: boolean
): Promise<TaskDirectoryBoundary | null> {
  const resolvedRoot = path.resolve(worktreeRoot);
  const dir = path.join(resolvedRoot, '.ccpanes-task');
  if (create) {
    await fs.mkdir(dir, { recursive: true });
  }
  const stat = await lstatIfExists(dir);
  if (!stat) return null;
  assertNotSymbolicLink(stat, 'current task directory');
  if (!stat.isDirectory()) {
    throw new Error('current task directory must be a directory');
  }
  const [realRoot, realDir] = await Promise.all([
    fs.realpath(resolvedRoot),
    fs.realpath(dir)
  ]);
  if (!isPathInside(realRoot, realDir)) {
    throw new Error('current task directory must be physically inside the worktree');
  }
  return { dir, realRoot, realDir, stat };
}

async function assertTaskDirectoryIdentity(
  worktreeRoot: string,
  expected: TaskDirectoryBoundary
): Promise<void> {
  const current = await inspectTaskDirectoryBoundary(worktreeRoot, false);
  if (
    !current ||
    normalizeForComparison(current.realRoot) !== normalizeForComparison(expected.realRoot) ||
    normalizeForComparison(current.realDir) !== normalizeForComparison(expected.realDir) ||
    current.stat.dev !== expected.stat.dev ||
    current.stat.ino !== expected.stat.ino
  ) {
    throw new Error('current task directory changed during atomic write');
  }
}

async function assertSafeTaskFile(file: string, boundary: TaskDirectoryBoundary): Promise<Stats | null> {
  const stat = await lstatIfExists(file);
  if (!stat) return null;
  assertNotSymbolicLink(stat, 'current task file');
  if (!stat.isFile()) {
    throw new Error('current task file must be a regular file');
  }
  const realFile = await fs.realpath(file);
  if (!isPathInside(boundary.realDir, realFile) || !isPathInside(boundary.realRoot, realFile)) {
    throw new Error('current task file must be physically inside the worktree');
  }
  return stat;
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

function isCanonicalAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) && path.normalize(value) === value && path.resolve(value) === value;
}

function assertCanonicalAbsolutePath(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || !isCanonicalAbsolutePath(value)) {
    throw new Error(`invalid current task: ${field} must be a canonical absolute path`);
  }
}

function assertNullableCanonicalAbsolutePath(
  value: unknown,
  field: string
): asserts value is string | null {
  if (value === null) return;
  assertCanonicalAbsolutePath(value, field);
}

export function validateCurrentTask(value: unknown): CurrentTask {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid current task: object');
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== 'ccpanes.task-selection.v1') throw new Error('invalid current task: schema');
  assertString(record.taskId, 'taskId');
  assertString(record.workspace, 'workspace');
  assertCanonicalAbsolutePath(record.projectPath, 'projectPath');
  assertCanonicalAbsolutePath(record.worktreeRoot, 'worktreeRoot');
  assertNullableCanonicalAbsolutePath(record.mainRepoRoot, 'mainRepoRoot');
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

export interface CreateCurrentTaskInput {
  root: string;
  taskId: string;
  phase: TaskPhase;
  workspace?: string | null;
  owner?: TaskOwner | null;
  source?: CurrentTask['source'] | null;
  notes?: string | null;
  now?: string | null;
}

export function createCurrentTask(input: CreateCurrentTaskInput): CurrentTask {
  const requestedRoot = path.resolve(input.root);
  const topology = readGitTopology(requestedRoot);
  if (topology && !topology.mainRepoRoot) {
    throw new Error('unsupported Git topology: canonical project root is unavailable');
  }
  const gitState = readGitState(requestedRoot);
  const worktreeRoot = topology?.worktreeRoot ?? requestedRoot;
  const projectPath = topology?.mainRepoRoot ?? worktreeRoot;
  const now = input.now ?? new Date().toISOString();

  return validateCurrentTask({
    schema: 'ccpanes.task-selection.v1',
    taskId: input.taskId,
    workspace: input.workspace ?? 'cc-pane',
    projectPath,
    worktreeRoot,
    mainRepoRoot: topology?.mainRepoRoot ?? null,
    branch: gitState.branch,
    head: gitState.head,
    owner: input.owner ?? {
      leaderSessionId: null,
      paneId: null,
      layoutId: null
    },
    phase: input.phase,
    createdAt: now,
    updatedAt: now,
    source: input.source ?? 'manual-import',
    notes: input.notes ?? 'task binding written by CC-Panes hooks'
  });
}

export async function readCurrentTask(worktreeRoot: string): Promise<CurrentTask | null> {
  const boundary = await inspectTaskDirectoryBoundary(worktreeRoot, false);
  if (!boundary) return null;
  const file = currentTaskPath(worktreeRoot);
  const stat = await assertSafeTaskFile(file, boundary);
  if (!stat) return null;
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

export interface CurrentTaskBindingResolution {
  check: TaskBindingCheck;
  candidate: ResolvedCurrentTask | null;
}

async function findNearestTaskCandidate(
  cwd: string,
  inclusiveStop: string | null = null
): Promise<ResolvedCurrentTask | null> {
  let current = path.resolve(cwd);
  const stop = inclusiveStop ? normalizeForComparison(inclusiveStop) : null;
  for (;;) {
    const task = await readCurrentTask(current);
    if (task) {
      return {
        task,
        taskPath: currentTaskPath(current),
        projectRoot: current
      };
    }
    if (stop && normalizeForComparison(current) === stop) return null;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function taskBindingCheck(
  status: TaskBindingCheck['status'],
  reason: string,
  cwd: string,
  topology: GitTopology | null,
  candidate: ResolvedCurrentTask | null
): TaskBindingCheck {
  return {
    schema: 'ccpanes.task-binding-check.v1',
    status,
    reason,
    cwd: path.resolve(cwd),
    gitRoot: topology?.worktreeRoot ?? null,
    gitCommonDir: topology?.commonDir ?? null,
    canonicalProjectRoot: topology?.mainRepoRoot ?? null,
    taskPath: candidate?.taskPath ?? null,
    taskFileRoot: candidate?.projectRoot ?? null,
    declaredProjectPath: candidate?.task.projectPath ?? null,
    declaredWorktreeRoot: candidate?.task.worktreeRoot ?? null,
    declaredMainRepoRoot: candidate?.task.mainRepoRoot ?? null,
    taskId: candidate?.task.taskId ?? null
  };
}

function inspectCandidate(
  cwd: string,
  topology: GitTopology | null,
  candidate: ResolvedCurrentTask
): CurrentTaskBindingResolution {
  const taskFileRoot = normalizeForComparison(candidate.projectRoot);
  const declaredWorktreeRoot = normalizeForComparison(candidate.task.worktreeRoot);
  if (taskFileRoot !== declaredWorktreeRoot) {
    return {
      check: taskBindingCheck(
        'task-root-mismatch',
        'task_file_root_does_not_match_declared_worktree_root',
        cwd,
        topology,
        candidate
      ),
      candidate
    };
  }

  const declaredProjectPath = normalizeForComparison(candidate.task.projectPath);
  if (!topology) {
    if (
      declaredProjectPath !== declaredWorktreeRoot ||
      candidate.task.mainRepoRoot !== null
    ) {
      return {
        check: taskBindingCheck(
          'project-root-mismatch',
          'non_git_task_project_path_or_main_repo_root_is_invalid',
          cwd,
          null,
          candidate
        ),
        candidate
      };
    }
    return {
      check: taskBindingCheck(
        'matched',
        'task_binding_matches_non_git_project',
        cwd,
        null,
        candidate
      ),
      candidate
    };
  }

  if (normalizeForComparison(topology.worktreeRoot) !== declaredWorktreeRoot) {
    return {
      check: taskBindingCheck(
        'git-root-mismatch',
        'declared_worktree_root_does_not_match_current_git_root',
        cwd,
        topology,
        candidate
      ),
      candidate
    };
  }

  if (!topology.mainRepoRoot) {
    return {
      check: taskBindingCheck(
        'project-root-mismatch',
        'unsupported_git_topology_cannot_derive_canonical_project',
        cwd,
        topology,
        candidate
      ),
      candidate
    };
  }

  const canonicalProjectRoot = normalizeForComparison(topology.mainRepoRoot);
  const declaredMainRepoRoot = candidate.task.mainRepoRoot
    ? normalizeForComparison(candidate.task.mainRepoRoot)
    : null;
  if (
    declaredProjectPath !== canonicalProjectRoot ||
    (declaredMainRepoRoot !== null && declaredMainRepoRoot !== canonicalProjectRoot)
  ) {
    return {
      check: taskBindingCheck(
        'project-root-mismatch',
        'declared_project_path_or_main_repo_root_does_not_match_git_topology',
        cwd,
        topology,
        candidate
      ),
      candidate
    };
  }

  return {
    check: taskBindingCheck(
      'matched',
      'task_binding_matches_current_git_worktree_and_project',
      cwd,
      topology,
      candidate
    ),
    candidate
  };
}

export async function resolveCurrentTaskBindingFromCwd(
  cwd: string
): Promise<CurrentTaskBindingResolution> {
  const resolvedCwd = path.resolve(cwd);
  let topology: GitTopology | null;
  try {
    topology = readGitTopology(resolvedCwd);
  } catch (error) {
    if (!(error instanceof GitTopologyError)) throw error;
    const candidate = await findNearestTaskCandidate(resolvedCwd);
    return {
      check: taskBindingCheck(
        'git-topology-unavailable',
        error.code,
        resolvedCwd,
        null,
        candidate
      ),
      candidate
    };
  }
  if (!topology) {
    const candidate = await findNearestTaskCandidate(resolvedCwd);
    if (!candidate) {
      return {
        check: taskBindingCheck('missing', 'no_current_task_found', resolvedCwd, null, null),
        candidate: null
      };
    }
    return inspectCandidate(resolvedCwd, null, candidate);
  }

  const candidate = await findNearestTaskCandidate(resolvedCwd, topology.worktreeRoot);
  if (candidate) return inspectCandidate(resolvedCwd, topology, candidate);

  const parentStart = path.dirname(topology.worktreeRoot);
  const staleCandidate = parentStart === topology.worktreeRoot
    ? null
    : await findNearestTaskCandidate(parentStart);
  if (staleCandidate) {
    return {
      check: taskBindingCheck(
        'stale-parent-binding',
        'task_found_above_current_git_root',
        resolvedCwd,
        topology,
        staleCandidate
      ),
      candidate: staleCandidate
    };
  }

  if (!topology.mainRepoRoot) {
    return {
      check: taskBindingCheck(
        'project-root-mismatch',
        'unsupported_git_topology_cannot_derive_canonical_project',
        resolvedCwd,
        topology,
        null
      ),
      candidate: null
    };
  }

  return {
    check: taskBindingCheck('missing', 'no_current_task_found', resolvedCwd, topology, null),
    candidate: null
  };
}

export async function inspectCurrentTaskBindingFromCwd(cwd: string): Promise<TaskBindingCheck> {
  return (await resolveCurrentTaskBindingFromCwd(cwd)).check;
}

export async function resolveCurrentTaskFromCwd(cwd: string): Promise<ResolvedCurrentTask | null> {
  const inspection = await resolveCurrentTaskBindingFromCwd(cwd);
  return inspection.check.status === 'matched' ? inspection.candidate : null;
}

export async function writeCurrentTaskAtomic(worktreeRoot: string, task: CurrentTask): Promise<void> {
  validateCurrentTask(task);
  const resolvedWorktreeRoot = path.resolve(worktreeRoot);
  if (normalizeForComparison(resolvedWorktreeRoot) !== normalizeForComparison(task.worktreeRoot)) {
    throw new Error('current task write root does not match task.worktreeRoot');
  }
  const boundary = await inspectTaskDirectoryBoundary(resolvedWorktreeRoot, true);
  if (!boundary) throw new Error('current task directory is unavailable');
  const finalPath = currentTaskPath(resolvedWorktreeRoot);
  await assertSafeTaskFile(finalPath, boundary);
  const tempPath = path.join(
    boundary.dir,
    `current-task.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );
  try {
    const handle = await fs.open(tempPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(task, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertTaskDirectoryIdentity(resolvedWorktreeRoot, boundary);
    await assertSafeTaskFile(finalPath, boundary);
    await fs.rename(tempPath, finalPath);
  } catch (error) {
    try {
      await fs.unlink(tempPath);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
}
