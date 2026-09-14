import path from 'node:path';
import { isPathInside, normalizeForComparison } from './paths.js';
import type { CurrentTask, HookCall } from './types.js';

export interface TaskLifecycleAuthorizationOptions {
  trustedCliPath?: string | null;
  processExecPath?: string | null;
}

interface ParsedShellCommand {
  tokens: string[];
  redirectTarget: string | null;
}

function parseSingleShellCommand(rawCommand: string): ParsedShellCommand | null {
  if (rawCommand !== rawCommand.trim() || rawCommand.includes('`') || rawCommand.includes('$(')) return null;

  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let inToken = false;
  let redirectIndex: number | null = null;

  const pushCurrent = (): void => {
    if (!inToken) return;
    tokens.push(current);
    current = '';
    inToken = false;
  };

  for (let index = 0; index < rawCommand.length; index += 1) {
    const char = rawCommand[index] ?? '';
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      inToken = true;
      continue;
    }
    if (char === '\r' || char === '\n' || char === ';' || char === '&' || char === '|' || char === '<') return null;
    if (char === '>') {
      pushCurrent();
      if (redirectIndex !== null || rawCommand[index + 1] === '>') return null;
      redirectIndex = tokens.length;
      tokens.push('>');
      continue;
    }
    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }
    current += char;
    inToken = true;
  }

  if (quote) return null;
  pushCurrent();
  if (redirectIndex === null) return { tokens, redirectTarget: null };
  if (redirectIndex === 0 || tokens.length !== redirectIndex + 2) return null;
  return {
    tokens: tokens.slice(0, redirectIndex),
    redirectTarget: tokens[redirectIndex + 1] ?? null
  };
}

function pathEquals(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right);
}

function resolveFromTask(task: CurrentTask, candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.resolve(task.worktreeRoot, candidate);
}

function hasTrustedHeader(
  task: CurrentTask,
  tokens: string[],
  options: TaskLifecycleAuthorizationOptions
): boolean {
  if (tokens.length < 3 || !options.trustedCliPath) return false;
  const executable = tokens[0]?.toLowerCase();
  const processExecutableMatches = options.processExecPath
    ? pathEquals(tokens[0] ?? '', options.processExecPath)
    : false;
  if (executable !== 'node' && executable !== 'node.exe' && !processExecutableMatches) return false;
  return pathEquals(resolveFromTask(task, tokens[1] ?? ''), resolveFromTask(task, options.trustedCliPath));
}

function parseFlagPairs(tokens: string[], allowedFlags: Set<string>): Map<string, string[]> | null {
  const flags = new Map<string, string[]>();
  for (let index = 3; index < tokens.length; index += 2) {
    const flag = tokens[index];
    const value = tokens[index + 1];
    if (!flag || !allowedFlags.has(flag) || !value || value.startsWith('--')) return null;
    flags.set(flag, [...(flags.get(flag) ?? []), value]);
  }
  return flags;
}

function one(flags: Map<string, string[]>, name: string): string | null {
  const values = flags.get(name) ?? [];
  return values.length === 1 ? values[0] ?? null : null;
}

function authorizeVerify(
  task: CurrentTask,
  call: HookCall,
  parsed: ParsedShellCommand
): HookCall | null {
  if (parsed.redirectTarget || parsed.tokens.length !== 5 || parsed.tokens[3] !== '--input') return null;
  const acceptancePath = path.join(task.worktreeRoot, '.ccpanes-task', 'acceptance.json');
  if (!pathEquals(resolveFromTask(task, parsed.tokens[4] ?? ''), acceptancePath)) return null;
  return {
    ...call,
    writes: false,
    policyEffect: 'allow',
    policyReason: 'trusted_task_lifecycle_verify_acceptance'
  };
}

function authorizeRecord(
  task: CurrentTask,
  call: HookCall,
  parsed: ParsedShellCommand
): HookCall | null {
  if (task.phase !== 'archive' || !parsed.redirectTarget) return null;
  const acceptancePath = path.join(task.worktreeRoot, '.ccpanes-task', 'acceptance.json');
  if (!pathEquals(resolveFromTask(task, parsed.redirectTarget), acceptancePath)) return null;
  if (!call.targetPath || !pathEquals(call.targetPath, acceptancePath)) return null;

  const flags = parseFlagPairs(parsed.tokens, new Set(['--task', '--artifact', '--check', '--truth']));
  if (!flags) return null;
  const taskPath = one(flags, '--task');
  if (!taskPath || !pathEquals(resolveFromTask(task, taskPath), path.join(task.worktreeRoot, '.ccpanes-task', 'current-task.json'))) return null;
  const artifacts = flags.get('--artifact') ?? [];
  if (artifacts.length === 0 || artifacts.some((artifact) => !isPathInside(task.worktreeRoot, resolveFromTask(task, artifact)))) return null;
  return {
    ...call,
    policyEffect: 'allow',
    policyReason: 'trusted_task_lifecycle_record_acceptance'
  };
}

function authorizePhaseTransition(
  task: CurrentTask,
  call: HookCall,
  parsed: ParsedShellCommand
): HookCall | null {
  if (task.phase !== 'archive' || parsed.redirectTarget) return null;
  const flags = parseFlagPairs(parsed.tokens, new Set(['--root', '--task-id', '--phase', '--workspace', '--leader-session-id', '--notes']));
  if (!flags || [...flags.values()].some((values) => values.length !== 1)) return null;
  const root = one(flags, '--root');
  const taskId = one(flags, '--task-id');
  const phase = one(flags, '--phase');
  const workspace = one(flags, '--workspace');
  if (!root || !pathEquals(resolveFromTask(task, root), task.worktreeRoot)) return null;
  if (taskId !== task.taskId || phase !== 'verify') return null;
  if (workspace && workspace !== task.workspace) return null;
  return {
    ...call,
    policyEffect: 'allow',
    policyReason: 'trusted_task_lifecycle_phase_transition'
  };
}

export function applyTrustedTaskLifecycleAuthorization(
  task: CurrentTask,
  call: HookCall,
  options: TaskLifecycleAuthorizationOptions
): HookCall {
  if (call.tool !== 'shell' || !call.command || call.policyEffect === 'block') return call;
  const parsed = parseSingleShellCommand(call.rawCommand ?? call.command);
  if (!parsed || !hasTrustedHeader(task, parsed.tokens, options)) return call;
  const command = parsed.tokens[2];
  if (command === 'verify-acceptance') return authorizeVerify(task, call, parsed) ?? call;
  if (command === 'record-acceptance') return authorizeRecord(task, call, parsed) ?? call;
  if (command === 'write-current') return authorizePhaseTransition(task, call, parsed) ?? call;
  return call;
}
