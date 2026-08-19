import fs from 'node:fs';
import path from 'node:path';
import { type AcceptanceTruthLayerInput, type AcceptanceTruthLayerName } from './acceptance.js';
import { type HookRunnerResult } from './hook-runner.js';
import { type VerificationCheckInput } from './hook-release-gate.js';
import { readGitState } from './git-state.js';
import { isCodexSidebarCliAction } from './codex-sidebar-cli.js';
import type { CurrentTask, GitState, HookCall, TaskPhase } from './types.js';
import type { HookInstallTarget } from './hook-install-plan.js';
import { normalizeForComparison } from './paths.js';
import { projectPolicyPath } from './project-policy.js';
import type { ProjectPolicyRuleInput } from './project-policy.js';
import type { RunCliOptions } from './cli-types.js';

export function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

export function valuesAfter(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

export type CodexSessionIndexAction = 'scan' | 'resolve' | 'retention' | 'graph';
export type CodexSessionsAction = CodexSessionIndexAction | import('./codex-sidebar-cli.js').CodexSidebarCliAction;

const CODEX_SESSIONS_OPTION_KINDS = {
  '--sessions-dir': 'value',
  '--state-db': 'value',
  '--thread-history-db': 'value',
  '--project': 'value',
  '--task-context': 'value',
  '--ccpanes-snapshot': 'value',
  '--out': 'value',
  '--json': 'boolean',
  '--include-archived': 'boolean',
  '--include-subagents': 'boolean',
  '--include-related': 'boolean',
  '--include-ambient': 'boolean'
} as const;

export type CodexSessionsOption = keyof typeof CODEX_SESSIONS_OPTION_KINDS;

const CODEX_SESSIONS_COMMON_OPTIONS = new Set<CodexSessionsOption>([
  '--sessions-dir',
  '--state-db',
  '--thread-history-db',
  '--project',
  '--task-context',
  '--ccpanes-snapshot'
]);

export interface CodexSessionsCommonOptions {
  sessionsDir: string | null;
  stateDb: string | null;
  threadHistoryDb: string | null;
  project: string | null;
  taskContextPath: string | null;
  snapshotPath: string | null;
}

export interface CodexSessionsResolveOptions extends CodexSessionsCommonOptions {
  action: 'resolve';
  json: boolean;
  includeArchived: boolean;
  includeSubagents: boolean;
  includeRelated: boolean;
  includeAmbient: boolean;
}

export interface CodexSessionsGraphOptions extends CodexSessionsCommonOptions {
  action: 'graph';
  outPath: string | null;
}

export interface CodexSessionsGenericOptions extends CodexSessionsCommonOptions {
  action: 'scan' | 'retention';
  outPath: string | null;
}

export type CodexSessionsOptions =
  | CodexSessionsResolveOptions
  | CodexSessionsGraphOptions
  | CodexSessionsGenericOptions;

export interface HandoffGenerateOptions {
  mode: import('./codex-session-handoff.js').HandoffMode;
  project: string;
  sessionsDir: string | null;
  stateDb: string | null;
  threadHistoryDb: string | null;
  taskContextPath: string | null;
  indexPath: string | null;
}

export function isCodexSessionIndexAction(value: CodexSessionsAction): value is CodexSessionIndexAction {
  return value === 'scan' || value === 'resolve' || value === 'retention' || value === 'graph';
}

export function isCodexSessionsAction(value: string | undefined): value is CodexSessionsAction {
  return value === 'scan' ||
    value === 'resolve' ||
    value === 'retention' ||
    value === 'graph' ||
    isCodexSidebarCliAction(value);
}

export function isCodexSessionsOption(value: string): value is CodexSessionsOption {
  return Object.hasOwn(CODEX_SESSIONS_OPTION_KINDS, value);
}

export function codexSessionsOptionAllowed(action: CodexSessionIndexAction, option: CodexSessionsOption): boolean {
  if (CODEX_SESSIONS_COMMON_OPTIONS.has(option)) return true;
  if (action === 'resolve') {
    return option === '--json' ||
      option === '--include-archived' ||
      option === '--include-subagents' ||
      option === '--include-related' ||
      option === '--include-ambient';
  }
  return option === '--out';
}

export function parseCodexSessionsOptions(
  action: CodexSessionIndexAction,
  args: string[]
): CodexSessionsOptions {
  const values = new Map<CodexSessionsOption, string>();
  const enabled = new Set<CodexSessionsOption>();
  const seen = new Set<CodexSessionsOption>();

  for (let index = 0; index < args.length;) {
    const token = args[index];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected positional argument: ${token}`);
    }
    if (!isCodexSessionsOption(token)) {
      throw new Error(`unknown option: ${token}`);
    }
    if (!codexSessionsOptionAllowed(action, token)) {
      throw new Error(`unsupported option for ${action}: ${token}`);
    }
    if (seen.has(token)) {
      throw new Error(`duplicate option: ${token}`);
    }
    seen.add(token);

    if (CODEX_SESSIONS_OPTION_KINDS[token] === 'value') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--') || value.trim().length === 0) {
        throw new Error(`missing value for ${token}`);
      }
      values.set(token, value);
      index += 2;
    } else {
      enabled.add(token);
      index += 1;
    }
  }

  const common: CodexSessionsCommonOptions = {
    sessionsDir: values.get('--sessions-dir') ?? null,
    stateDb: values.get('--state-db') ?? null,
    threadHistoryDb: values.get('--thread-history-db') ?? null,
    project: values.get('--project') ?? null,
    taskContextPath: values.get('--task-context') ?? null,
    snapshotPath: values.get('--ccpanes-snapshot') ?? null
  };
  if (common.snapshotPath && !common.project) {
    throw new Error('--ccpanes-snapshot requires --project');
  }
  if (action === 'resolve') {
    if (!common.project) throw new Error('missing --project');
    return {
      action,
      ...common,
      project: common.project,
      json: enabled.has('--json'),
      includeArchived: enabled.has('--include-archived'),
      includeSubagents: enabled.has('--include-subagents'),
      includeRelated: enabled.has('--include-related'),
      includeAmbient: enabled.has('--include-ambient')
    };
  }
  if (action === 'graph') {
    if (!common.project) throw new Error('missing --project');
    return {
      action,
      ...common,
      project: common.project,
      outPath: values.get('--out') ?? null
    };
  }
  return {
    action,
    ...common,
    outPath: values.get('--out') ?? null
  };
}

const HANDOFF_GENERATE_VALUE_OPTIONS = [
  '--mode',
  '--project',
  '--sessions-dir',
  '--state-db',
  '--thread-history-db',
  '--task-context',
  '--index'
] as const;

export type HandoffGenerateOption = typeof HANDOFF_GENERATE_VALUE_OPTIONS[number];

export function isHandoffGenerateOption(value: string): value is HandoffGenerateOption {
  return (HANDOFF_GENERATE_VALUE_OPTIONS as readonly string[]).includes(value);
}

export function parseHandoffGenerateOptions(args: string[]): HandoffGenerateOptions {
  const values = new Map<HandoffGenerateOption, string>();
  const seen = new Set<HandoffGenerateOption>();

  for (let index = 0; index < args.length;) {
    const token = args[index];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected positional argument: ${token}`);
    }
    if (!isHandoffGenerateOption(token)) {
      throw new Error(`unknown option: ${token}`);
    }
    if (seen.has(token)) {
      throw new Error(`duplicate option: ${token}`);
    }
    seen.add(token);

    const value = args[index + 1];
    if (
      value === undefined ||
      value.startsWith('--') ||
      value.trim().length === 0
    ) {
      throw new Error(`missing value for ${token}`);
    }
    values.set(token, value);
    index += 2;
  }

  const project = values.get('--project');
  if (!project) throw new Error('missing --project');
  const mode = values.get('--mode');
  if (mode !== 'ccpanes-worker' && mode !== 'codex-app-visual') {
    throw new Error(`invalid handoff mode: ${mode ?? null}`);
  }
  return {
    mode,
    project,
    sessionsDir: values.get('--sessions-dir') ?? null,
    stateDb: values.get('--state-db') ?? null,
    threadHistoryDb: values.get('--thread-history-db') ?? null,
    taskContextPath: values.get('--task-context') ?? null,
    indexPath: values.get('--index') ?? null
  };
}

export function parsePhase(value: string | null): TaskPhase {
  if (value === 'shape' || value === 'build' || value === 'verify' || value === 'archive') return value;
  throw new Error(`invalid phase: ${value}`);
}

export function parseCheck(value: string): { name: string; command: string; result: string; evidence: string } {
  const [name, result, ...evidenceParts] = value.split('=');
  if (!name || !result || evidenceParts.length === 0) throw new Error(`invalid check: ${value}`);
  return { name, command: name, result, evidence: evidenceParts.join('=') };
}

export function parseTruthLayer(value: string): AcceptanceTruthLayerInput {
  const [name, state, ...evidenceParts] = value.split('=');
  if (!name || !state || evidenceParts.length === 0) throw new Error(`invalid truth layer: ${value}`);
  const required = !name.endsWith('?');
  const normalizedName = (required ? name : name.slice(0, -1)) as AcceptanceTruthLayerName;
  return { name: normalizedName, state, required, evidence: evidenceParts.join('=') };
}

export function parseVerificationCheck(value: string): VerificationCheckInput {
  const parsed = parseCheck(value);
  if (parsed.result === 'pass' || parsed.result === 'fail' || parsed.result === 'blocked' || parsed.result === 'not-run') {
    return { name: parsed.name, result: parsed.result, evidence: parsed.evidence };
  }
  throw new Error(`invalid verification check result: ${parsed.result}`);
}

export function parseHookInstallTarget(value: string | null): HookInstallTarget {
  if (value === 'codex' || value === 'ccpanes' || value === 'both') return value;
  throw new Error(`invalid hook install target: ${value}`);
}

export function parseProjectPolicyEffect(value: string | null): ProjectPolicyRuleInput['effect'] {
  if (value === 'allow' || value === 'block') return value;
  throw new Error(`invalid policy effect: ${value}`);
}

export function parseProjectPolicyTool(value: string): HookCall['tool'] {
  if (value === 'read' || value === 'grep' || value === 'glob' || value === 'edit' || value === 'write' || value === 'apply_patch' || value === 'shell') return value;
  throw new Error(`invalid policy tool: ${value}`);
}

export function extractHookCwd(event: unknown): string | null {
  if (!event || typeof event !== 'object') return null;
  const record = event as Record<string, unknown>;
  return typeof record.cwd === 'string' && record.cwd.length > 0 ? record.cwd : null;
}

export function formatPreToolUseDeny(result: HookRunnerResult): string {
  const blocked = result.dryRun.decisions.find((decision: HookRunnerResult['dryRun']['decisions'][number]) => decision.action === 'block');
  const reason = blocked
    ? `${blocked.reason}${blocked.targetPath ? `: ${blocked.targetPath}` : ''}`
    : 'blocked by ccpanes task probe';
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `ccpanes-task-probe: ${reason}`
    }
  }, null, 2)}\n`;
}

export function formatPermissionRequestDeny(result: HookRunnerResult): string {
  const blocked = result.dryRun.decisions.find((decision: HookRunnerResult['dryRun']['decisions'][number]) => decision.action === 'block');
  const reason = blocked
    ? `${blocked.reason}${blocked.targetPath ? `: ${blocked.targetPath}` : ''}`
    : 'blocked by ccpanes task probe';
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'deny',
        message: `ccpanes-task-probe: ${reason}`
      }
    }
  }, null, 2)}\n`;
}

export function safeName(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

export function auditPathFromRoot(auditRoot: string, task: CurrentTask): string {
  return path.join(auditRoot, safeName(task.taskId), 'hook-enforce-audit.json');
}

export function permissionAuditPathFromRoot(auditRoot: string, task: CurrentTask): string {
  return path.join(auditRoot, safeName(task.taskId), 'permission-enforce-audit.json');
}

export function postToolUseAuditPathFromRoot(auditRoot: string, task: CurrentTask): string {
  return path.join(auditRoot, safeName(task.taskId), 'post-tool-use-audit.jsonl');
}

export function workflowAdvisoryAuditPathFromRoot(auditRoot: string, task: CurrentTask): string {
  return path.join(auditRoot, safeName(task.taskId), 'workflow-advisory-audit.jsonl');
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function projectPolicyCliResult(command: string, root: string, changed: boolean, policy: unknown, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    schema: 'ccpanes.project-policy-cli-result.v1',
    command,
    path: projectPolicyPath(root),
    changed,
    policy,
    ...extra
  }, null, 2)}\n`;
}

export function gitStateForTask(task: CurrentTask): GitState {
  const exists = fs.existsSync(task.worktreeRoot);
  const hasGitMarker = fs.existsSync(`${task.worktreeRoot}/.git`);
  if (hasGitMarker) {
    const gitState = readGitState(task.worktreeRoot);
    if (gitState.root !== null && normalizeForComparison(gitState.root) === normalizeForComparison(task.worktreeRoot)) {
      return gitState;
    }
  }
  return {
    root: exists ? task.worktreeRoot : null,
    branch: task.branch,
    head: task.head,
    dirty: false,
    statusShort: ''
  };
}

export function cliPathForBootstrapAuthorization(options: RunCliOptions): string | null {
  return options.trustedCliPath ?? process.argv[1] ?? null;
}

export function processExecPathForBootstrapAuthorization(options: RunCliOptions): string | null {
  return options.processExecPath ?? process.execPath ?? null;
}
