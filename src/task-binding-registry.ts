import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside, normalizeForComparison } from './paths.js';

const MAX_REGISTRY_BYTES = 64 * 1024;
const MAX_BINDINGS = 128;
const MAX_STRING = 4096;

export interface TaskBindingRegistration {
  taskId: string;
  worktreeRoot: string;
  projectPath: string;
  handoffPath: string;
  contextPath: string;
  coordinatorNamespace: string | null;
}

export interface TaskBindingRegistry {
  schema: 'ccpanes.task-binding-registry.v1';
  bindings: TaskBindingRegistration[];
}

function assertString(value: unknown, field: string, max = MAX_STRING): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`invalid task binding registry: ${field}`);
  }
}

function assertAbsolutePath(value: unknown, field: string): asserts value is string {
  assertString(value, field);
  if (!path.isAbsolute(value) || path.normalize(value) !== value || path.resolve(value) !== value) {
    throw new Error(`invalid task binding registry: ${field} must be canonical absolute path`);
  }
}

function validateRegistration(value: unknown): TaskBindingRegistration {
  if (!value || typeof value !== 'object') throw new Error('invalid task binding registry: binding');
  const record = value as Record<string, unknown>;
  assertString(record.taskId, 'taskId', 256);
  assertAbsolutePath(record.worktreeRoot, 'worktreeRoot');
  assertAbsolutePath(record.projectPath, 'projectPath');
  assertAbsolutePath(record.handoffPath, 'handoffPath');
  assertAbsolutePath(record.contextPath, 'contextPath');
  if (record.coordinatorNamespace !== null && record.coordinatorNamespace !== undefined) {
    assertString(record.coordinatorNamespace, 'coordinatorNamespace', 256);
  }
  if (!isPathInside(record.worktreeRoot, record.handoffPath) ||
      !isPathInside(record.worktreeRoot, record.contextPath)) {
    throw new Error('invalid task binding registry: handoff/context must be inside worktreeRoot');
  }
  return {
    taskId: record.taskId,
    worktreeRoot: record.worktreeRoot,
    projectPath: record.projectPath,
    handoffPath: record.handoffPath,
    contextPath: record.contextPath,
    coordinatorNamespace: (record.coordinatorNamespace as string | null | undefined) ?? null
  };
}

export function validateTaskBindingRegistry(value: unknown): TaskBindingRegistry {
  if (!value || typeof value !== 'object') throw new Error('invalid task binding registry: object');
  const record = value as Record<string, unknown>;
  if (record.schema !== 'ccpanes.task-binding-registry.v1') {
    throw new Error('invalid task binding registry: schema');
  }
  if (!Array.isArray(record.bindings) || record.bindings.length > MAX_BINDINGS) {
    throw new Error('invalid task binding registry: bindings');
  }
  const seen = new Set<string>();
  const bindings = record.bindings.map(validateRegistration);
  for (const binding of bindings) {
    const key = normalizeForComparison(binding.worktreeRoot);
    if (seen.has(key)) throw new Error('invalid task binding registry: duplicate worktreeRoot');
    seen.add(key);
  }
  return { schema: 'ccpanes.task-binding-registry.v1', bindings };
}

export async function readTaskBindingRegistry(file: string): Promise<TaskBindingRegistry> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(MAX_REGISTRY_BYTES + 1);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    if (result.bytesRead > MAX_REGISTRY_BYTES) {
      throw new Error('task binding registry exceeds 65536 bytes');
    }
    let value: unknown;
    try {
      value = JSON.parse(buffer.subarray(0, result.bytesRead).toString('utf8'));
    } catch {
      throw new Error('invalid task binding registry: malformed JSON');
    }
    return validateTaskBindingRegistry(value);
  } finally {
    await handle.close();
  }
}

export async function writeTaskBindingRegistry(
  file: string,
  bindings: TaskBindingRegistration[]
): Promise<void> {
  const registry = validateTaskBindingRegistry({
    schema: 'ccpanes.task-binding-registry.v1',
    bindings
  });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export function findTaskBinding(
  registry: TaskBindingRegistry,
  cwd: string
): TaskBindingRegistration | null {
  const resolvedCwd = path.resolve(cwd);
  const candidates = registry.bindings
    .filter((binding) => isPathInside(binding.worktreeRoot, resolvedCwd))
    .sort((left, right) => right.worktreeRoot.length - left.worktreeRoot.length);
  return candidates[0] ?? null;
}
