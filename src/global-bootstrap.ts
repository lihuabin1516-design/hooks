import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveCurrentTaskBindingFromCwd } from './current-task.js';
import { findTaskBinding, readTaskBindingRegistry, type TaskBindingRegistration } from './task-binding-registry.js';

export type BootstrapStatus =
  | 'READY'
  | 'MISSING_TASK_BINDING'
  | 'REGISTRY_MISSING'
  | 'REGISTRY_INVALID'
  | 'CONTEXT_MISSING';

export interface BootstrapInput {
  cwd: string;
  registryPath?: string | null;
}

export interface BootstrapResult {
  schema: 'ccpanes.bootstrap.v1';
  status: BootstrapStatus;
  cwd: string;
  taskId: string | null;
  projectPath: string | null;
  worktreeRoot: string | null;
  handoff: { path: string | null; exists: boolean };
  context: { path: string | null; exists: boolean };
  coordinatorNamespace: string | null;
  reason: string;
}

async function exists(file: string | null): Promise<boolean> {
  if (!file) return false;
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

function result(
  input: BootstrapInput,
  status: BootstrapStatus,
  binding: TaskBindingRegistration | null,
  handoffExists: boolean,
  contextExists: boolean,
  reason: string
): BootstrapResult {
  return {
    schema: 'ccpanes.bootstrap.v1',
    status,
    cwd: path.resolve(input.cwd),
    taskId: binding?.taskId ?? null,
    projectPath: binding?.projectPath ?? null,
    worktreeRoot: binding?.worktreeRoot ?? null,
    handoff: { path: binding?.handoffPath ?? null, exists: handoffExists },
    context: { path: binding?.contextPath ?? null, exists: contextExists },
    coordinatorNamespace: binding?.coordinatorNamespace ?? null,
    reason
  };
}

export async function resolveBootstrap(input: BootstrapInput): Promise<BootstrapResult> {
  const registryPath = path.resolve(
    input.registryPath ?? path.join(os.homedir(), '.cc-panes', 'task-bindings.json')
  );
  let registry;
  try {
    registry = await readTaskBindingRegistry(registryPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      const local = await resolveCurrentTaskBindingFromCwd(input.cwd);
      if (local.check.status === 'matched' && local.candidate) {
        const binding: TaskBindingRegistration = {
          taskId: local.candidate.task.taskId,
          worktreeRoot: local.candidate.task.worktreeRoot,
          projectPath: local.candidate.task.projectPath,
          handoffPath: path.join(local.candidate.task.worktreeRoot, 'HANDOFF.md'),
          contextPath: path.join(local.candidate.task.worktreeRoot, 'context.md'),
          coordinatorNamespace: null
        };
        const [handoffExists, contextExists] = await Promise.all([
          exists(binding.handoffPath),
          exists(binding.contextPath)
        ]);
        if (handoffExists && contextExists) {
          return result(input, 'READY', binding, true, true, 'local_current_task_binding_resolved');
        }
        return result(input, 'CONTEXT_MISSING', binding, handoffExists, contextExists, 'handoff_or_context_missing');
      }
      return result(input, 'REGISTRY_MISSING', null, false, false, 'task_binding_registry_missing');
    }
    return result(input, 'REGISTRY_INVALID', null, false, false, 'task_binding_registry_invalid');
  }

  const binding = findTaskBinding(registry, input.cwd);
  if (!binding) {
    return result(input, 'MISSING_TASK_BINDING', null, false, false, 'no_exact_worktree_binding');
  }
  const [handoffExists, contextExists] = await Promise.all([
    exists(binding.handoffPath),
    exists(binding.contextPath)
  ]);
  if (!handoffExists || !contextExists) {
    return result(input, 'CONTEXT_MISSING', binding, handoffExists, contextExists, 'handoff_or_context_missing');
  }
  return result(input, 'READY', binding, true, true, 'exact_worktree_binding_and_context_resolved');
}
