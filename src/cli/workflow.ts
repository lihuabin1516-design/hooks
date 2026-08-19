import { readFile } from 'node:fs/promises';
import { createHostAdapterRegistry, getHostAdapter } from '../host-adapter-registry.js';
import { createWorkflowAdvisory, parseWorkflowAdvisoryHookEvent, appendWorkflowAdvisoryAudit } from '../workflow-advisory-hook.js';
import { classifyTaskRisk } from '../task-risk.js';
import { classifyWorkflowProfile } from '../workflow-profile.js';
import { scanWorkspaceTasks } from '../workspace-scan.js';
import { probeResume } from '../resume-probe.js';
import type { CurrentTask, GitState } from '../types.js';
import type { RunCliOptions } from '../cli-types.js';
import {
  extractHookCwd,
  gitStateForTask,
  readStdin,
  valueAfter,
  valuesAfter,
  workflowAdvisoryAuditPathFromRoot
} from '../cli-shared.js';
import { resolveCurrentTaskBindingFromCwd } from '../current-task.js';

function gitStateMapForTasks(tasks: CurrentTask[]): Map<string, GitState> {
  const gitStates = new Map<string, GitState>();
  for (const task of tasks) {
    gitStates.set(task.worktreeRoot, gitStateForTask(task));
  }
  return gitStates;
}

export async function handleWorkflowCommands(
  args: string[],
  stdinText: string | undefined,
  _options: RunCliOptions
): Promise<string | null> {
  const command = args[0];

  if (command === 'probe') {
    const utterance = valueAfter(args, '--utterance') ?? '';
    const session = valueAfter(args, '--session');
    const workspaceRoot = valueAfter(args, '--workspace-root');
    if (workspaceRoot) {
      const scan = await scanWorkspaceTasks(workspaceRoot);
      const tasks = scan.tasks.map((item) => item.task);
      const gitStates = gitStateMapForTasks(tasks);
      const result = probeResume({ utterance, currentSessionId: session, tasks, gitStates });
      return `${JSON.stringify({ ...result, scanErrors: scan.errors }, null, 2)}\n`;
    }
    const result = probeResume({ utterance, currentSessionId: session, tasks: [], gitStates: new Map() });
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  if (command === 'classify-task-risk') {
    const prompt = valueAfter(args, '--prompt');
    const cwd = valueAfter(args, '--cwd');
    if (prompt === null) throw new Error('missing --prompt');
    return `${JSON.stringify(classifyTaskRisk({ prompt, cwd }), null, 2)}\n`;
  }

  if (command === 'classify-workflow') {
    const prompt = valueAfter(args, '--prompt');
    const cwd = valueAfter(args, '--cwd');
    if (prompt === null) throw new Error('missing --prompt');
    return `${JSON.stringify(classifyWorkflowProfile({
      prompt,
      cwd,
      changedPaths: valuesAfter(args, '--changed-path')
    }), null, 2)}\n`;
  }

  if (command === 'workflow-advisory') {
    const auditRoot = valueAfter(args, '--audit-root');
    if (!auditRoot || !args.includes('--resolve-task-from-cwd')) return '';
    try {
      const eventText = stdinText ?? await readStdin();
      const event = JSON.parse(eventText);
      const parsedEvent = parseWorkflowAdvisoryHookEvent(event);
      if (!parsedEvent) return '';
      const binding = await resolveCurrentTaskBindingFromCwd(parsedEvent.cwd);
      if (binding.check.status !== 'matched' || !binding.candidate) return '';
      const result = createWorkflowAdvisory({
        task: binding.candidate.task,
        event
      });
      if (result.audit) {
        try {
          await appendWorkflowAdvisoryAudit(
            workflowAdvisoryAuditPathFromRoot(auditRoot, binding.candidate.task),
            result.audit
          );
        } catch {
          // Advisory audit failure must not block prompt submission.
        }
      }
      return result.output ? `${JSON.stringify(result.output, null, 2)}\n` : '';
    } catch {
      return '';
    }
  }

  if (command === 'host-adapter-registry') {
    const host = valueAfter(args, '--host');
    if (host) {
      const adapter = getHostAdapter(host);
      if (!adapter) throw new Error(`unknown host adapter: ${host}`);
      return `${JSON.stringify({ schema: 'ccpanes.host-adapter.v1', adapter }, null, 2)}\n`;
    }
    return `${JSON.stringify(createHostAdapterRegistry(), null, 2)}\n`;
  }

  return null;
}
