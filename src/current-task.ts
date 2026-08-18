import fs from 'node:fs/promises';
import type { BigIntStats, Stats } from 'node:fs';
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
const CURRENT_TASK_ROOT_FIELDS = new Set([
  'schema',
  'taskId',
  'workspace',
  'projectPath',
  'worktreeRoot',
  'mainRepoRoot',
  'branch',
  'head',
  'owner',
  'phase',
  'createdAt',
  'updatedAt',
  'source',
  'notes'
]);
const CURRENT_TASK_OWNER_FIELDS = new Set([
  'leaderSessionId',
  'paneId',
  'layoutId'
]);
const CURRENT_TASK_STRING_LIMITS = Object.freeze({
  taskId: 256,
  workspace: 256,
  path: 4096,
  reference: 512,
  ownerReference: 256,
  timestamp: 64,
  notes: 4096
});
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

function assertKnownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  scope: string
): void {
  const unknown = Object.keys(value)
    .filter((field) => !allowed.has(field))
    .sort()[0];
  if (unknown !== undefined) {
    throw new Error(`invalid current task: unknown field ${scope}.${unknown}`);
  }
}

function assertString(
  value: unknown,
  field: string,
  maxLength: number
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`invalid current task: ${field}`);
  }
}

function assertNullableString(
  value: unknown,
  field: string,
  maxLength: number
): asserts value is string | null {
  if (
    !(
      value === null ||
      (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= maxLength
      )
    )
  ) {
    throw new Error(`invalid current task: ${field}`);
  }
}

function isCanonicalAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) && path.normalize(value) === value && path.resolve(value) === value;
}

function assertCanonicalAbsolutePath(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > CURRENT_TASK_STRING_LIMITS.path ||
    !isCanonicalAbsolutePath(value)
  ) {
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
  assertKnownFields(record, CURRENT_TASK_ROOT_FIELDS, 'root');
  if (record.schema !== 'ccpanes.task-selection.v1') throw new Error('invalid current task: schema');
  assertString(record.taskId, 'taskId', CURRENT_TASK_STRING_LIMITS.taskId);
  assertString(
    record.workspace,
    'workspace',
    CURRENT_TASK_STRING_LIMITS.workspace
  );
  assertCanonicalAbsolutePath(record.projectPath, 'projectPath');
  assertCanonicalAbsolutePath(record.worktreeRoot, 'worktreeRoot');
  assertNullableCanonicalAbsolutePath(record.mainRepoRoot, 'mainRepoRoot');
  assertNullableString(
    record.branch,
    'branch',
    CURRENT_TASK_STRING_LIMITS.reference
  );
  assertNullableString(
    record.head,
    'head',
    CURRENT_TASK_STRING_LIMITS.reference
  );
  if (!record.owner || typeof record.owner !== 'object') throw new Error('invalid current task: owner');
  const owner = record.owner as Record<string, unknown>;
  assertKnownFields(owner, CURRENT_TASK_OWNER_FIELDS, 'owner');
  assertNullableString(
    owner.leaderSessionId,
    'owner.leaderSessionId',
    CURRENT_TASK_STRING_LIMITS.ownerReference
  );
  assertNullableString(
    owner.paneId,
    'owner.paneId',
    CURRENT_TASK_STRING_LIMITS.ownerReference
  );
  assertNullableString(
    owner.layoutId,
    'owner.layoutId',
    CURRENT_TASK_STRING_LIMITS.ownerReference
  );
  if (!phases.includes(record.phase as TaskPhase)) throw new Error('invalid current task: phase');
  assertString(
    record.createdAt,
    'createdAt',
    CURRENT_TASK_STRING_LIMITS.timestamp
  );
  assertString(
    record.updatedAt,
    'updatedAt',
    CURRENT_TASK_STRING_LIMITS.timestamp
  );
  if (!sources.includes(record.source as CurrentTask['source'])) throw new Error('invalid current task: source');
  assertString(record.notes, 'notes', CURRENT_TASK_STRING_LIMITS.notes);
  return record as unknown as CurrentTask;
}

export type CurrentTaskFileReadErrorReason =
  | 'read-failed'
  | 'oversized'
  | 'malformed-json'
  | 'schema-invalid';

export class CurrentTaskFileReadError extends Error {
  readonly code = 'CURRENT_TASK_FILE_INVALID' as const;

  constructor(readonly reason: CurrentTaskFileReadErrorReason) {
    super(
      reason === 'oversized'
        ? 'current-task.json exceeds 16384 bytes'
        : reason === 'malformed-json'
          ? 'invalid current task: malformed JSON'
          : reason === 'schema-invalid'
            ? 'invalid current task: schema'
            : 'current task file read failed'
    );
    this.name = 'CurrentTaskFileReadError';
  }
}

export interface CurrentTaskFileReadOptions {
  afterOpenForTest?: () => Promise<void>;
  identityOperationsForTest?: {
    lstat: (file: string) => Promise<BigIntStats>;
    stat: (
      handle: Awaited<ReturnType<typeof fs.open>>
    ) => Promise<BigIntStats>;
  };
}

interface FileEntityIdentity {
  dev: bigint;
  ino: bigint;
  mode: bigint;
}

function fileEntityIdentity(stat: BigIntStats): FileEntityIdentity | null {
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  if (stat.dev < 0n || stat.ino <= 0n) return null;
  return { dev: stat.dev, ino: stat.ino, mode: stat.mode };
}

function sameFileEntity(
  left: FileEntityIdentity,
  right: FileEntityIdentity
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode;
}

function currentTaskFileReadError(error: unknown): CurrentTaskFileReadError {
  return error instanceof CurrentTaskFileReadError
    ? error
    : new CurrentTaskFileReadError('read-failed');
}

export async function readCurrentTaskFile(
  file: string,
  options: CurrentTaskFileReadOptions = {}
): Promise<CurrentTask> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  let result: CurrentTask | null = null;
  let failure: CurrentTaskFileReadError | null = null;
  const lstatIdentity = options.identityOperationsForTest?.lstat ??
    ((candidate: string) => fs.lstat(candidate, { bigint: true }));
  const statIdentity = options.identityOperationsForTest?.stat ??
    ((candidate: Awaited<ReturnType<typeof fs.open>>) =>
      candidate.stat({ bigint: true }));
  try {
    const preStat = await lstatIdentity(file);
    const preIdentity = fileEntityIdentity(preStat);
    if (!preIdentity) {
      throw new CurrentTaskFileReadError('read-failed');
    }
    handle = await fs.open(file, 'r');
    await options.afterOpenForTest?.();
    const handleIdentity = fileEntityIdentity(
      await statIdentity(handle)
    );
    if (!handleIdentity || !sameFileEntity(preIdentity, handleIdentity)) {
      throw new CurrentTaskFileReadError('read-failed');
    }
    const buffer = Buffer.alloc(MAX_CURRENT_TASK_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        null
      );
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead > MAX_CURRENT_TASK_BYTES) {
      throw new CurrentTaskFileReadError('oversized');
    }
    const postIdentity = fileEntityIdentity(
      await lstatIdentity(file)
    );
    if (!postIdentity || !sameFileEntity(handleIdentity, postIdentity)) {
      throw new CurrentTaskFileReadError('read-failed');
    }
    let value: unknown;
    try {
      value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    } catch {
      throw new CurrentTaskFileReadError('malformed-json');
    }
    try {
      result = validateCurrentTask(value);
    } catch {
      throw new CurrentTaskFileReadError('schema-invalid');
    }
  } catch (error) {
    failure = currentTaskFileReadError(error);
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        failure = new CurrentTaskFileReadError('read-failed');
      }
    }
  }
  if (failure) throw failure;
  if (!result) throw new CurrentTaskFileReadError('read-failed');
  return result;
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
  return readCurrentTaskFile(file);
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
