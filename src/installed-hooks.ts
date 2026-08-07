import fs from 'node:fs/promises';
import path from 'node:path';

export type ExpectedHookEvent = 'SessionStart' | 'PreToolUse' | 'PermissionRequest' | 'PostToolUse' | 'Stop';

export interface ExpectedHooksInput {
  prototypeRoot: string;
  auditRoot: string;
}

export interface ExpectedHookDefinition {
  event: ExpectedHookEvent;
  commandToken: string;
  requiredMatcherTokens: string[];
  trustStateKey: string;
}

export interface InstalledHookDiscovery {
  event: ExpectedHookEvent;
  installed: boolean;
  matcher: string | null;
  command: string | null;
}

export interface InstalledHooksCheck {
  name: string;
  status: 'pass' | 'fail';
  evidence: string;
}

export interface InstalledHooksVerification {
  schema: 'ccpanes.installed-hooks.verify.v1';
  mode: 'read-only';
  checkedAt: string;
  hooksJsonPath: string;
  configTomlPath: string | null;
  prototypeRoot: string;
  auditRoot: string;
  passed: boolean;
  discovered: InstalledHookDiscovery[];
  checks: InstalledHooksCheck[];
  failures: string[];
}

export interface VerifyInstalledHooksInput {
  hooksJsonPath: string;
  prototypeRoot: string;
  auditRoot: string;
  configTomlPath?: string | null;
  now?: string;
}

function cliPath(prototypeRoot: string): string {
  return path.join(prototypeRoot, 'dist', 'src', 'cli.js');
}

function commandFor(prototypeRoot: string, command: string, auditRoot: string): string {
  return `node "${cliPath(prototypeRoot)}" ${command} --resolve-task-from-cwd --audit-root "${auditRoot}"`;
}

export function expectedHookDefinitions(): ExpectedHookDefinition[] {
  return [
    { event: 'SessionStart', commandToken: 'session-start', requiredMatcherTokens: ['startup', 'resume', 'clear', 'compact'], trustStateKey: 'session_start' },
    { event: 'PreToolUse', commandToken: 'hook-enforce', requiredMatcherTokens: ['apply_patch', 'Bash', 'mcp__fastctx__'], trustStateKey: 'pre_tool_use' },
    { event: 'PermissionRequest', commandToken: 'permission-enforce', requiredMatcherTokens: ['apply_patch', 'Bash', 'mcp__fastctx__'], trustStateKey: 'permission_request' },
    { event: 'PostToolUse', commandToken: 'post-enforce', requiredMatcherTokens: ['apply_patch', 'Bash', 'mcp__fastctx__'], trustStateKey: 'post_tool_use' },
    { event: 'Stop', commandToken: 'stop-check', requiredMatcherTokens: [], trustStateKey: 'stop' }
  ];
}

export function buildExpectedHooksConfig(input: ExpectedHooksInput): { hooks: Record<string, unknown> } {
  return {
    hooks: {
      SessionStart: [
        {
          matcher: '^(startup|resume|clear|compact)$',
          hooks: [
            {
              type: 'command',
              command: commandFor(input.prototypeRoot, 'session-start', input.auditRoot),
              commandWindows: commandFor(input.prototypeRoot, 'session-start', input.auditRoot),
              timeout: 10,
              statusMessage: 'CC-Panes task lifecycle context',
              additionalContextLimit: 1200
            }
          ]
        }
      ],
      PreToolUse: [
        {
          matcher: '^(apply_patch|Edit|Write|Bash|shell|shell_command|functions\\.shell_command|mcp__fastctx__(read|grep|glob|replace))$',
          hooks: [
            {
              type: 'command',
              command: commandFor(input.prototypeRoot, 'hook-enforce', input.auditRoot),
              commandWindows: commandFor(input.prototypeRoot, 'hook-enforce', input.auditRoot),
              timeout: 10,
              statusMessage: 'CC-Panes task boundary check'
            }
          ]
        }
      ],
      PermissionRequest: [
        {
          matcher: '^(apply_patch|Edit|Write|Bash|shell|shell_command|functions\\.shell_command|mcp__fastctx__(read|grep|glob|replace))$',
          hooks: [
            {
              type: 'command',
              command: commandFor(input.prototypeRoot, 'permission-enforce', input.auditRoot),
              commandWindows: commandFor(input.prototypeRoot, 'permission-enforce', input.auditRoot),
              timeout: 10,
              statusMessage: 'CC-Panes permission request boundary check'
            }
          ]
        }
      ],
      PostToolUse: [
        {
          matcher: '^(apply_patch|Edit|Write|Bash|shell|shell_command|functions\\.shell_command|mcp__fastctx__(read|grep|glob|replace))$',
          hooks: [
            {
              type: 'command',
              command: commandFor(input.prototypeRoot, 'post-enforce', input.auditRoot),
              commandWindows: commandFor(input.prototypeRoot, 'post-enforce', input.auditRoot),
              timeout: 10,
              statusMessage: 'CC-Panes post tool audit'
            }
          ]
        }
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: commandFor(input.prototypeRoot, 'stop-check', input.auditRoot),
              commandWindows: commandFor(input.prototypeRoot, 'stop-check', input.auditRoot),
              timeout: 10,
              statusMessage: 'CC-Panes completion gate reminder'
            }
          ]
        }
      ]
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function normalizeText(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function firstGroupForEvent(hooksRoot: Record<string, unknown>, event: ExpectedHookEvent): Record<string, unknown> | null {
  const groups = hooksRoot[event];
  if (!Array.isArray(groups) || groups.length === 0) return null;
  return asRecord(groups[0]);
}

function firstCommandForGroup(group: Record<string, unknown> | null): string | null {
  if (!group) return null;
  const handlers = group.hooks;
  if (!Array.isArray(handlers) || handlers.length === 0) return null;
  const handler = asRecord(handlers[0]);
  return typeof handler.command === 'string'
    ? handler.command
    : typeof handler.commandWindows === 'string'
      ? handler.commandWindows
      : null;
}

function matcherForGroup(group: Record<string, unknown> | null): string | null {
  if (!group) return null;
  return typeof group.matcher === 'string' ? group.matcher : null;
}

function addCheck(checks: InstalledHooksCheck[], failures: string[], name: string, ok: boolean, evidence: string): void {
  checks.push({ name, status: ok ? 'pass' : 'fail', evidence });
  if (!ok) failures.push(`${name}: ${evidence}`);
}

export async function verifyInstalledHooks(input: VerifyInstalledHooksInput): Promise<InstalledHooksVerification> {
  const hooksJson = JSON.parse(await fs.readFile(input.hooksJsonPath, 'utf8'));
  const hooksRoot = asRecord(asRecord(hooksJson).hooks);
  const definitions = expectedHookDefinitions();
  const discovered: InstalledHookDiscovery[] = [];
  const checks: InstalledHooksCheck[] = [];
  const failures: string[] = [];
  const normalizedCli = normalizeText(cliPath(input.prototypeRoot));
  const normalizedAuditRoot = normalizeText(input.auditRoot);

  for (const definition of definitions) {
    const group = firstGroupForEvent(hooksRoot, definition.event);
    const command = firstCommandForGroup(group);
    const matcher = matcherForGroup(group);
    const installed = Boolean(group && command);
    discovered.push({ event: definition.event, installed, matcher, command });
    addCheck(checks, failures, `${definition.event} installed`, installed, command ?? 'missing');
    if (!command) continue;

    const normalizedCommand = normalizeText(command);
    addCheck(checks, failures, `${definition.event} command token`, normalizedCommand.includes(definition.commandToken), command);
    addCheck(checks, failures, `${definition.event} cli path`, normalizedCommand.includes(normalizedCli), command);
    addCheck(checks, failures, `${definition.event} audit-root`, normalizedCommand.includes(normalizedAuditRoot), command);

    if (definition.requiredMatcherTokens.length > 0) {
      const matcherText = matcher ?? '';
      for (const token of definition.requiredMatcherTokens) {
        addCheck(checks, failures, `${definition.event} matcher ${token}`, matcherText.includes(token), matcherText || 'missing matcher');
      }
    }

    if (definition.event === 'SessionStart') {
      const limit = asRecord((asRecord(group).hooks as unknown[] | undefined)?.[0]).additionalContextLimit;
      addCheck(checks, failures, 'SessionStart additionalContextLimit', typeof limit === 'number' && limit > 0, String(limit));
    }
  }

  if (input.configTomlPath) {
    const configText = normalizeText(await fs.readFile(input.configTomlPath, 'utf8'));
    for (const definition of definitions) {
      const hasTrust = configText.includes(definition.trustStateKey) && configText.includes('trusted_hash');
      addCheck(checks, failures, `${definition.event} trusted hash`, hasTrust, definition.trustStateKey);
    }
  }

  return {
    schema: 'ccpanes.installed-hooks.verify.v1',
    mode: 'read-only',
    checkedAt: input.now ?? new Date().toISOString(),
    hooksJsonPath: input.hooksJsonPath,
    configTomlPath: input.configTomlPath ?? null,
    prototypeRoot: input.prototypeRoot,
    auditRoot: input.auditRoot,
    passed: failures.length === 0,
    discovered,
    checks,
    failures
  };
}
