import fs from 'node:fs';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { decideHookDryRun } from '../hook-dry-run.js';
import { adaptHookEventToBatch } from '../hook-event-adapter.js';
import { runHookDryRunBatch, validateHookDryRunBatch } from '../hook-batch.js';
import {
  createTaskBindingMismatchGateTask,
  runHookEventDryRunWithProjectPolicy,
  runHookEventWithTaskBindingMismatch
} from '../hook-runner.js';
import { createHookShadowAudit, writeHookShadowAuditAtomic } from '../hook-shadow.js';
import { appendPostToolUseAudit, createPostToolUseAuditRecord } from '../post-tool-audit.js';
import {
  analyzeStopCheckEvent,
  createSessionStartHookOutput,
  createStopCheckHookOutput,
  createTaskBindingMismatchSessionStartOutput,
  createTaskBindingMismatchStopOutput
} from '../session-lifecycle.js';
import { createCurrentTask, validateCurrentTask, resolveCurrentTaskBindingFromCwd } from '../current-task.js';
import { isPathInside } from '../paths.js';
import type { CurrentTask, HookCall, TaskBindingCheck } from '../types.js';
import type { RunCliOptions } from '../cli-types.js';
import {
  auditPathFromRoot,
  cliPathForBootstrapAuthorization,
  extractHookCwd,
  formatPermissionRequestDeny,
  formatPreToolUseDeny,
  permissionAuditPathFromRoot,
  postToolUseAuditPathFromRoot,
  processExecPathForBootstrapAuthorization,
  readStdin,
  parsePhase,
  valueAfter
} from '../cli-shared.js';

export async function handleHookCommands(
  args: string[],
  stdinText: string | undefined,
  options: RunCliOptions
): Promise<string | null> {
  const command = args[0];

  if (command === 'dry-run-hook') {
    const input = valueAfter(args, '--input');
    if (input) {
      const batch = JSON.parse(await readFile(input, 'utf8'));
      return `${JSON.stringify(runHookDryRunBatch(batch), null, 2)}\n`;
    }
    const root = valueAfter(args, '--root');
    const phase = valueAfter(args, '--phase');
    const target = valueAfter(args, '--target');
    const tool = valueAfter(args, '--tool') as HookCall['tool'] | null;
    if (!root) throw new Error('missing --root');
    if (!target) throw new Error('missing --target');
    if (!tool) throw new Error('missing --tool');
    const task = createCurrentTask({
      root,
      taskId: 'synthetic-task',
      phase: parsePhase(phase),
      notes: 'synthetic dry-run task'
    });
    const call: HookCall = { tool, targetPath: target, writes: ['edit', 'write', 'apply_patch', 'shell'].includes(tool) };
    return `${JSON.stringify(decideHookDryRun(task, call), null, 2)}\n`;
  }

  if (command === 'adapt-hook-event') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    if (!taskPath) throw new Error('missing --task');
    if (!eventPath) throw new Error('missing --event');
    const task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    const event = JSON.parse(await readFile(eventPath, 'utf8'));
    const batch = validateHookDryRunBatch(adaptHookEventToBatch(task, event));
    return `${JSON.stringify(batch, null, 2)}\n`;
  }

  if (command === 'hook-runner') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    if (!taskPath) throw new Error('missing --task');
    const task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const result = await runHookEventDryRunWithProjectPolicy(task, event);
    return `${JSON.stringify(result, null, 2)}\n`;
  }

  if (command === 'hook-enforce') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const auditOut = valueAfter(args, '--audit-out');
    const auditRoot = valueAfter(args, '--audit-root');
    const resolveTaskFromCwd = args.includes('--resolve-task-from-cwd');
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const cwd = extractHookCwd(event);
    let task: CurrentTask;
    let mismatchCheck: TaskBindingCheck | null = null;
    if (resolveTaskFromCwd) {
      const startCwd = cwd ?? process.cwd();
      const binding = await resolveCurrentTaskBindingFromCwd(startCwd);
      if (binding.check.status === 'missing') return '';
      if (binding.check.status !== 'matched') {
        mismatchCheck = binding.check;
        task = createTaskBindingMismatchGateTask(binding.check);
      } else {
        if (!binding.candidate) return '';
        task = binding.candidate.task;
      }
    } else {
      if (!taskPath) throw new Error('missing --task');
      task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    }
    if (!mismatchCheck && cwd && !isPathInside(task.worktreeRoot, cwd)) return '';
    const result = mismatchCheck
      ? runHookEventWithTaskBindingMismatch(task, event, mismatchCheck, {
        trustedCliPath: cliPathForBootstrapAuthorization(options),
        processExecPath: processExecPathForBootstrapAuthorization(options)
      })
      : await runHookEventDryRunWithProjectPolicy(task, event);
    const resolvedAuditOut = mismatchCheck
      ? auditOut
      : auditOut ?? (auditRoot ? auditPathFromRoot(auditRoot, task) : null);
    if (resolvedAuditOut) {
      fs.mkdirSync(path.dirname(resolvedAuditOut), { recursive: true });
      fs.writeFileSync(resolvedAuditOut, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    return result.allowed ? '' : formatPreToolUseDeny(result);
  }

  if (command === 'permission-enforce') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const auditOut = valueAfter(args, '--audit-out');
    const auditRoot = valueAfter(args, '--audit-root');
    const resolveTaskFromCwd = args.includes('--resolve-task-from-cwd');
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const cwd = extractHookCwd(event);
    let task: CurrentTask;
    let mismatchCheck: TaskBindingCheck | null = null;
    if (resolveTaskFromCwd) {
      const startCwd = cwd ?? process.cwd();
      const binding = await resolveCurrentTaskBindingFromCwd(startCwd);
      if (binding.check.status === 'missing') return '';
      if (binding.check.status !== 'matched') {
        mismatchCheck = binding.check;
        task = createTaskBindingMismatchGateTask(binding.check);
      } else {
        if (!binding.candidate) return '';
        task = binding.candidate.task;
      }
    } else {
      if (!taskPath) throw new Error('missing --task');
      task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    }
    if (!mismatchCheck && cwd && !isPathInside(task.worktreeRoot, cwd)) return '';
    const result = mismatchCheck
      ? runHookEventWithTaskBindingMismatch(task, event, mismatchCheck, {
        trustedCliPath: cliPathForBootstrapAuthorization(options),
        processExecPath: processExecPathForBootstrapAuthorization(options)
      })
      : await runHookEventDryRunWithProjectPolicy(task, event);
    const resolvedAuditOut = mismatchCheck
      ? auditOut
      : auditOut ?? (auditRoot ? permissionAuditPathFromRoot(auditRoot, task) : null);
    if (resolvedAuditOut) {
      fs.mkdirSync(path.dirname(resolvedAuditOut), { recursive: true });
      fs.writeFileSync(resolvedAuditOut, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    }
    return result.allowed ? '' : formatPermissionRequestDeny(result);
  }

  if (command === 'post-enforce') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const auditOut = valueAfter(args, '--audit-out');
    const auditRoot = valueAfter(args, '--audit-root');
    const resolveTaskFromCwd = args.includes('--resolve-task-from-cwd');
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const cwd = extractHookCwd(event);
    let task: CurrentTask;
    if (resolveTaskFromCwd) {
      const startCwd = cwd ?? process.cwd();
      const binding = await resolveCurrentTaskBindingFromCwd(startCwd);
      if (binding.check.status !== 'matched' || !binding.candidate) return '';
      task = binding.candidate.task;
    } else {
      if (!taskPath) throw new Error('missing --task');
      task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    }
    if (cwd && !isPathInside(task.worktreeRoot, cwd)) return '';
    const resolvedAuditOut = auditOut ?? (auditRoot ? postToolUseAuditPathFromRoot(auditRoot, task) : null);
    if (resolvedAuditOut) {
      await appendPostToolUseAudit(resolvedAuditOut, createPostToolUseAuditRecord(task, event));
    }
    return '';
  }

  if (command === 'session-start') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const auditRoot = valueAfter(args, '--audit-root');
    const resolveTaskFromCwd = args.includes('--resolve-task-from-cwd');
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const cwd = extractHookCwd(event);
    let task: CurrentTask;
    let resolvedTaskPath: string;
    if (resolveTaskFromCwd) {
      const startCwd = cwd ?? process.cwd();
      const binding = await resolveCurrentTaskBindingFromCwd(startCwd);
      if (binding.check.status === 'missing') return '';
      if (binding.check.status !== 'matched') {
        return `${JSON.stringify(createTaskBindingMismatchSessionStartOutput(binding.check), null, 2)}\n`;
      }
      if (!binding.candidate) return '';
      task = binding.candidate.task;
      resolvedTaskPath = binding.candidate.taskPath;
    } else {
      if (!taskPath) throw new Error('missing --task');
      task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
      resolvedTaskPath = taskPath;
    }
    if (cwd && !isPathInside(task.worktreeRoot, cwd)) return '';
    return `${JSON.stringify(createSessionStartHookOutput({ task, taskPath: resolvedTaskPath, auditRoot }), null, 2)}\n`;
  }

  if (command === 'stop-check') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const auditRoot = valueAfter(args, '--audit-root');
    const resolveTaskFromCwd = args.includes('--resolve-task-from-cwd');
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const cwd = extractHookCwd(event);
    let task: CurrentTask;
    let resolvedTaskPath: string;
    if (resolveTaskFromCwd) {
      const startCwd = cwd ?? process.cwd();
      const binding = await resolveCurrentTaskBindingFromCwd(startCwd);
      if (binding.check.status === 'missing') return '';
      if (binding.check.status !== 'matched') {
        return `${JSON.stringify(createTaskBindingMismatchStopOutput(binding.check), null, 2)}\n`;
      }
      if (!binding.candidate) return '';
      task = binding.candidate.task;
      resolvedTaskPath = binding.candidate.taskPath;
    } else {
      if (!taskPath) throw new Error('missing --task');
      task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
      resolvedTaskPath = taskPath;
    }
    if (cwd && !isPathInside(task.worktreeRoot, cwd)) return '';
    return `${JSON.stringify(createStopCheckHookOutput({ task, taskPath: resolvedTaskPath, auditRoot, stopAnalysis: analyzeStopCheckEvent(event) }), null, 2)}\n`;
  }

  if (command === 'hook-shadow') {
    const taskPath = valueAfter(args, '--task');
    const eventPath = valueAfter(args, '--event');
    const upstreamHookPath = valueAfter(args, '--upstream-hook');
    const outPath = valueAfter(args, '--out');
    if (!taskPath) throw new Error('missing --task');
    const task = validateCurrentTask(JSON.parse(await readFile(taskPath, 'utf8')));
    const eventText = eventPath ? await readFile(eventPath, 'utf8') : (stdinText ?? await readStdin());
    if (eventText.trim().length === 0) throw new Error('missing hook event stdin');
    const event = JSON.parse(eventText);
    const audit = await createHookShadowAudit({ task, event, upstreamHookPath });
    if (outPath) await writeHookShadowAuditAtomic(outPath, audit);
    return `${JSON.stringify(audit, null, 2)}\n`;
  }

  return null;
}
