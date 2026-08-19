import fs from 'node:fs';
import path from 'node:path';
import { bootstrapProject } from '../project-bootstrap.js';
import { installAgentsEntry, validateAgentsEntry } from '../agents-entry.js';
import {
  createCurrentTask,
  currentTaskPath,
  inspectCurrentTaskBindingFromCwd,
  validateCurrentTask,
  writeCurrentTaskAtomic
} from '../current-task.js';
import type { RunCliOptions } from '../cli-types.js';
import { parsePhase, valueAfter } from '../cli-shared.js';

export async function handleTaskCommands(
  args: string[],
  _stdinText: string | undefined,
  _options: RunCliOptions
): Promise<string | null> {
  const command = args[0];

  if (command === 'write-current') {
    const root = valueAfter(args, '--root');
    const taskId = valueAfter(args, '--task-id');
    const phase = parsePhase(valueAfter(args, '--phase'));
    if (!root) throw new Error('missing --root');
    if (!taskId) throw new Error('missing --task-id');
    const requestedRoot = path.resolve(root);
    fs.mkdirSync(requestedRoot, { recursive: true });
    const leaderSessionId = valueAfter(args, '--leader-session-id');
    const task = createCurrentTask({
      root: requestedRoot,
      taskId,
      phase,
      workspace: valueAfter(args, '--workspace'),
      owner: { leaderSessionId, paneId: null, layoutId: null },
      source: leaderSessionId ? 'leader' : 'manual-import',
      notes: valueAfter(args, '--notes')
    });
    await writeCurrentTaskAtomic(task.worktreeRoot, task);
    return `${JSON.stringify({ path: currentTaskPath(task.worktreeRoot), taskId, phase }, null, 2)}\n`;
  }

  if (command === 'verify-task-binding') {
    const cwd = valueAfter(args, '--cwd') ?? process.cwd();
    return `${JSON.stringify(await inspectCurrentTaskBindingFromCwd(cwd), null, 2)}\n`;
  }

  if (command === 'bootstrap-project') {
    const root = valueAfter(args, '--root');
    const taskId = valueAfter(args, '--task-id');
    const phase = parsePhase(valueAfter(args, '--phase') ?? 'shape');
    const workspace = valueAfter(args, '--workspace');
    const notes = valueAfter(args, '--notes');
    if (!root) throw new Error('missing --root');
    if (!taskId) throw new Error('missing --task-id');
    return `${JSON.stringify(await bootstrapProject({ projectRoot: root, taskId, phase, workspace, notes }), null, 2)}\n`;
  }

  if (command === 'agents-install') {
    const root = valueAfter(args, '--root');
    const templatePath = valueAfter(args, '--template');
    if (!root) throw new Error('missing --root');
    return `${JSON.stringify(await installAgentsEntry(root, templatePath), null, 2)}\n`;
  }

  if (command === 'agents-validate') {
    const root = valueAfter(args, '--root');
    if (!root) throw new Error('missing --root');
    return `${JSON.stringify(await validateAgentsEntry(root), null, 2)}\n`;
  }

  return null;
}
