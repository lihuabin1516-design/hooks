import fs from 'node:fs/promises';
import path from 'node:path';
import { readCurrentTask } from './current-task.js';
import type { CurrentTask } from './types.js';

const skippedDirectoryNames = new Set(['.git', 'node_modules', 'dist']);

export interface ScannedTask {
  worktreeRoot: string;
  task: CurrentTask;
}

export interface WorkspaceScanError {
  worktreeRoot: string;
  path: string;
  reason: string;
}

export interface WorkspaceScanResult {
  tasks: ScannedTask[];
  errors: WorkspaceScanError[];
}

export async function scanWorkspaceTasks(workspaceRoot: string): Promise<WorkspaceScanResult> {
  const entries = await fs.readdir(workspaceRoot, { withFileTypes: true });
  const tasks: ScannedTask[] = [];
  const errors: WorkspaceScanError[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    if (skippedDirectoryNames.has(entry.name)) continue;

    const worktreeRoot = path.join(workspaceRoot, entry.name);
    try {
      const task = await readCurrentTask(worktreeRoot);
      if (task) {
        tasks.push({ worktreeRoot, task });
      }
    } catch (error) {
      errors.push({
        worktreeRoot,
        path: path.join(worktreeRoot, '.ccpanes-task', 'current-task.json'),
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { tasks, errors };
}