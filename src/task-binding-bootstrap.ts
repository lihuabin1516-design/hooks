import path from 'node:path';
import { normalizeForComparison } from './paths.js';
import type { HookCall, TaskBindingCheck, TaskPhase } from './types.js';

export interface TaskBindingBootstrapInput {
  check: TaskBindingCheck;
  call: HookCall;
  trustedCliPath?: string | null;
  processExecPath?: string | null;
}

export interface TaskBindingBootstrapDecision {
  allowed: boolean;
  reason: string;
}

const requiredFlags = new Set(['--root', '--task-id', '--phase']);
const optionalFlags = new Set(['--workspace', '--leader-session-id', '--notes']);
const allowedFlags = new Set([...requiredFlags, ...optionalFlags]);
const phases = new Set<TaskPhase>(['shape', 'build', 'verify', 'archive']);

function hasRejectedShellSyntax(command: string): boolean {
  return /[\r\n;&|`<>]/.test(command) || command.includes('$(');
}

function tokenizeSingleCommand(command: string): string[] | null {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let inToken = false;

  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      inToken = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      continue;
    }

    current += char;
    inToken = true;
  }

  if (quote) return null;
  if (inToken) tokens.push(current);
  return tokens;
}

function isAllowedNodeExecutable(token: string, processExecPath: string | null | undefined): boolean {
  const normalizedToken = token.toLowerCase();
  if (normalizedToken === 'node' || normalizedToken === 'node.exe') return true;
  if (!processExecPath) return false;
  return normalizeForComparison(token) === normalizeForComparison(processExecPath);
}

function readFlagPairs(tokens: string[]): { flags: Map<string, string>; reason: string | null } {
  const flags = new Map<string, string>();

  for (let index = 3; index < tokens.length; index += 2) {
    const flag = tokens[index];
    if (!flag?.startsWith('--') || !allowedFlags.has(flag)) {
      return { flags, reason: 'bootstrap_unknown_flag' };
    }
    if (flags.has(flag)) {
      return { flags, reason: 'bootstrap_duplicate_flag' };
    }

    const value = tokens[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith('--')) {
      return { flags, reason: 'bootstrap_missing_flag_value' };
    }
    flags.set(flag, value);
  }

  for (const flag of requiredFlags) {
    if (!flags.has(flag)) return { flags, reason: 'bootstrap_missing_required_flag' };
  }
  return { flags, reason: null };
}

function pathEquals(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right);
}

export function authorizeTaskBindingBootstrapWrite(input: TaskBindingBootstrapInput): TaskBindingBootstrapDecision {
  if (input.check.status !== 'stale-parent-binding') {
    return { allowed: false, reason: 'bootstrap_status_not_stale_parent_binding' };
  }
  if (!input.check.gitRoot) {
    return { allowed: false, reason: 'bootstrap_git_root_missing' };
  }
  if (input.call.tool !== 'shell' || !input.call.writes || !input.call.command) {
    return { allowed: false, reason: 'bootstrap_not_shell_write' };
  }
  if (!input.trustedCliPath) {
    return { allowed: false, reason: 'bootstrap_trusted_cli_missing' };
  }

  const rawCommand = input.call.rawCommand ?? input.call.command;
  if (hasRejectedShellSyntax(rawCommand)) {
    return { allowed: false, reason: 'bootstrap_shell_syntax_rejected' };
  }
  const command = rawCommand.trim();

  const tokens = tokenizeSingleCommand(command);
  if (!tokens) return { allowed: false, reason: 'bootstrap_unbalanced_quotes' };
  if (tokens.length < 3) return { allowed: false, reason: 'bootstrap_incomplete_command' };

  if (!isAllowedNodeExecutable(tokens[0] ?? '', input.processExecPath)) {
    return { allowed: false, reason: 'bootstrap_node_mismatch' };
  }
  if (!pathEquals(tokens[1] ?? '', path.resolve(input.trustedCliPath))) {
    return { allowed: false, reason: 'bootstrap_cli_mismatch' };
  }
  if (tokens[2] !== 'write-current') {
    return { allowed: false, reason: 'bootstrap_command_mismatch' };
  }

  const parsed = readFlagPairs(tokens);
  if (parsed.reason) return { allowed: false, reason: parsed.reason };

  const root = parsed.flags.get('--root');
  const taskId = parsed.flags.get('--task-id');
  const phase = parsed.flags.get('--phase') as TaskPhase | undefined;
  if (!root || !pathEquals(root, input.check.gitRoot)) {
    return { allowed: false, reason: 'bootstrap_root_mismatch' };
  }
  if (!taskId) {
    return { allowed: false, reason: 'bootstrap_task_id_missing' };
  }
  if (!phase || !phases.has(phase)) {
    return { allowed: false, reason: 'bootstrap_phase_invalid' };
  }

  return { allowed: true, reason: 'task_binding_bootstrap_write' };
}
