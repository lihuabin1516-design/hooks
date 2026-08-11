import fs from 'node:fs/promises';
import path from 'node:path';
import {
  currentTaskPath,
  resolveCurrentTaskBindingFromCwd
} from './current-task.js';
import { normalizeForComparison } from './paths.js';
import type { CurrentTask, TaskBindingStatus } from './types.js';

const skippedDirectoryNames = new Set(['.git', 'node_modules', 'dist']);

export interface ScannedTask {
  worktreeRoot: string;
  task: CurrentTask;
}

export interface WorkspaceScanError {
  worktreeRoot: string;
  path: string;
  reason: string;
  bindingStatus?: TaskBindingStatus;
}

export interface WorkspaceScanResult {
  tasks: ScannedTask[];
  errors: WorkspaceScanError[];
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function scanWorkspaceTasks(workspaceRoot: string): Promise<WorkspaceScanResult> {
  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  const tasks: ScannedTask[] = [];
  const errors: WorkspaceScanError[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    if (skippedDirectoryNames.has(entry.name)) continue;

    const worktreeRoot = path.join(workspaceRoot, entry.name);
    const taskPath = currentTaskPath(worktreeRoot);
    try {
      const shouldInspect = await pathExists(taskPath) ||
        await pathExists(path.join(worktreeRoot, '.git'));
      if (!shouldInspect) continue;

      const binding = await resolveCurrentTaskBindingFromCwd(worktreeRoot);
      if (binding.check.status === 'missing') continue;
      if (
        binding.check.status === 'matched' &&
        binding.candidate &&
        normalizeForComparison(binding.candidate.projectRoot) === normalizeForComparison(worktreeRoot)
      ) {
        tasks.push({ worktreeRoot, task: binding.candidate.task });
      } else {
        errors.push({
          worktreeRoot,
          path: binding.check.taskPath ?? taskPath,
          reason: binding.check.reason,
          bindingStatus: binding.check.status
        });
      }
    } catch (error) {
      errors.push({
        worktreeRoot,
        path: taskPath,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { tasks, errors };
}
