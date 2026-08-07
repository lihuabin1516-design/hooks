import fs from 'node:fs/promises';
import path from 'node:path';

export type ExpectedHookEvent = 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PermissionRequest' | 'PostToolUse' | 'Stop';

export interface ExpectedHooksInput {
  prototypeRoot: string;
  auditRoot: string;
}

export interface ExpectedHookDefinition {
  event: ExpectedHookEvent;
  name: string;
  commandToken: string;
  requiredCommandTokens?: string[];
  requiredMatcherTokens: string[];
  trustStateKey: string;
  requiresPrototypeCli?: boolean;
  requiresAuditRoot?: boolean;
  trustRequired?: boolean;
}

export interface InstalledHookDiscovery {
  event: ExpectedHookEvent;
  name: string;
  installed: boolean;
  matcher: string | null;
  command: string | null;
  groupIndex: number | null;
  hookIndex: number | null;
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

const skillsHubHookPath = 'C:\\Users\\AI001\\skills-hub\\bin\\skills-hub-hook.exe';
const ccPanesCodexHookPath = 'D:\\cc-pane\\cc-pane-main\\src-tauri\\binaries\\cc-panes-cli-hook.exe';

function executableCommand(executablePath: string, args: string[] = []): string {
  const command = `"${executablePath}"`;
  return args.length > 0 ? `${command} ${args.join(' ')}` : command;
}

function codexWindowsCommand(command: string): string {
  return `cmd.exe /d /s /c '${command}'`;
}

function ccPanesPromptBeforeCommand(): string {
  return codexWindowsCommand(`${executableCommand(ccPanesCodexHookPath, ['prompt-before'])} 2>nul`);
}

export function expectedHookDefinitions(): ExpectedHookDefinition[] {
  return [
    { event: 'SessionStart', name: 'SessionStart', commandToken: 'session-start', requiredMatcherTokens: ['startup', 'resume', 'clear', 'compact'], trustStateKey: 'session_start' },
    {
      event: 'UserPromptSubmit',
      name: 'UserPromptSubmit skills-hub',
      commandToken: 'skills-hub-hook.exe',
      requiredCommandTokens: ['skills-hub-hook.exe'],
      requiredMatcherTokens: [],
      trustStateKey: 'user_prompt_submit',
      requiresPrototypeCli: false,
      requiresAuditRoot: false
    },
    {
      event: 'UserPromptSubmit',
      name: 'UserPromptSubmit cc-panes prompt-before',
      commandToken: 'cc-panes-cli-hook.exe',
      requiredCommandTokens: [ccPanesCodexHookPath, 'cc-panes-cli-hook.exe', 'prompt-before'],
      requiredMatcherTokens: [],
      trustStateKey: 'user_prompt_submit',
      requiresPrototypeCli: false,
      requiresAuditRoot: false,
      trustRequired: false
    },
    { event: 'PreToolUse', name: 'PreToolUse', commandToken: 'hook-enforce', requiredMatcherTokens: ['apply_patch', 'Bash', 'mcp__fastctx__'], trustStateKey: 'pre_tool_use' },
    { event: 'PermissionRequest', name: 'PermissionRequest', commandToken: 'permission-enforce', requiredMatcherTokens: ['apply_patch', 'Bash', 'mcp__fastctx__'], trustStateKey: 'permission_request' },
    { event: 'PostToolUse', name: 'PostToolUse', commandToken: 'post-enforce', requiredMatcherTokens: ['apply_patch', 'Bash', 'mcp__fastctx__'], trustStateKey: 'post_tool_use' },
    { event: 'Stop', name: 'Stop', commandToken: 'stop-check', requiredMatcherTokens: [], trustStateKey: 'stop' }
  ];
}

export function buildExpectedHooksConfig(input: ExpectedHooksInput): { hooks: Record<string, unknown> } {
  return {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: executableCommand(skillsHubHookPath),
              commandWindows: executableCommand(skillsHubHookPath),
              timeout: 5,
              statusMessage: 'Routing cold skills'
            }
          ]
        },
        {
          hooks: [
            {
              type: 'command',
              command: ccPanesPromptBeforeCommand(),
              commandWindows: ccPanesPromptBeforeCommand(),
              timeout: 10,
              statusMessage: 'CC-Panes plan lifecycle intake'
            }
          ]
        }
      ],
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

interface InstalledHookCandidate {
  matcher: string | null;
  command: string;
  groupIndex: number;
  hookIndex: number;
  handler: Record<string, unknown>;
}

function groupsForEvent(hooksRoot: Record<string, unknown>, event: ExpectedHookEvent): Record<string, unknown>[] {
  const groups = hooksRoot[event];
  if (!Array.isArray(groups) || groups.length === 0) return [];
  return groups.map((group) => asRecord(group));
}

function commandForHandler(handler: Record<string, unknown>): string | null {
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

function candidatesForEvent(hooksRoot: Record<string, unknown>, event: ExpectedHookEvent): InstalledHookCandidate[] {
  const candidates: InstalledHookCandidate[] = [];
  for (const [groupIndex, group] of groupsForEvent(hooksRoot, event).entries()) {
    const handlers = group.hooks;
    if (!Array.isArray(handlers)) continue;
    for (const [hookIndex, handlerValue] of handlers.entries()) {
      const handler = asRecord(handlerValue);
      const command = commandForHandler(handler);
      if (!command) continue;
      candidates.push({
        matcher: matcherForGroup(group),
        command,
        groupIndex,
        hookIndex,
        handler
      });
    }
  }
  return candidates;
}

function requiredCommandTokens(definition: ExpectedHookDefinition): string[] {
  return definition.requiredCommandTokens ?? [definition.commandToken];
}

function matchingCandidate(candidates: InstalledHookCandidate[], definition: ExpectedHookDefinition): InstalledHookCandidate | null {
  const tokens = requiredCommandTokens(definition).map((token) => normalizeText(token));
  return candidates.find((candidate) => {
    const normalizedCommand = normalizeText(candidate.command);
    return tokens.every((token) => normalizedCommand.includes(token));
  }) ?? null;
}

function trustSectionHasTrustedHash(configText: string, stateKey: string): boolean {
  const keyIndex = configText.indexOf(stateKey);
  if (keyIndex < 0) return false;
  const nextSection = configText.indexOf('\n[', keyIndex + stateKey.length);
  const section = configText.slice(keyIndex, nextSection < 0 ? undefined : nextSection);
  return section.includes('trusted_hash');
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
  const matchedDefinitions: Array<{ definition: ExpectedHookDefinition; candidate: InstalledHookCandidate }> = [];

  for (const definition of definitions) {
    const candidates = candidatesForEvent(hooksRoot, definition.event);
    const candidate = matchingCandidate(candidates, definition);
    const installed = Boolean(candidate);
    const name = definition.name;
    discovered.push({
      event: definition.event,
      name,
      installed,
      matcher: candidate?.matcher ?? null,
      command: candidate?.command ?? null,
      groupIndex: candidate?.groupIndex ?? null,
      hookIndex: candidate?.hookIndex ?? null
    });
    addCheck(
      checks,
      failures,
      `${name} installed`,
      installed,
      candidate
        ? `group=${candidate.groupIndex} hook=${candidate.hookIndex} command=${candidate.command}`
        : candidates.length > 0
          ? `no command matched required tokens: ${requiredCommandTokens(definition).join(', ')}`
          : 'missing'
    );
    if (!candidate) continue;
    matchedDefinitions.push({ definition, candidate });

    const normalizedCommand = normalizeText(candidate.command);
    for (const token of requiredCommandTokens(definition)) {
      addCheck(checks, failures, `${name} command token ${token}`, normalizedCommand.includes(normalizeText(token)), candidate.command);
    }
    if (definition.requiresPrototypeCli !== false) {
      addCheck(checks, failures, `${name} cli path`, normalizedCommand.includes(normalizedCli), candidate.command);
    }
    if (definition.requiresAuditRoot !== false) {
      addCheck(checks, failures, `${name} audit-root`, normalizedCommand.includes(normalizedAuditRoot), candidate.command);
    }

    if (definition.requiredMatcherTokens.length > 0) {
      const matcherText = candidate.matcher ?? '';
      for (const token of definition.requiredMatcherTokens) {
        addCheck(checks, failures, `${name} matcher ${token}`, matcherText.includes(token), matcherText || 'missing matcher');
      }
    }

    if (definition.event === 'SessionStart') {
      const limit = candidate.handler.additionalContextLimit;
      addCheck(checks, failures, 'SessionStart additionalContextLimit', typeof limit === 'number' && limit > 0, String(limit));
    }
  }

  if (input.configTomlPath) {
    const configText = normalizeText(await fs.readFile(input.configTomlPath, 'utf8'));
    for (const { definition, candidate } of matchedDefinitions) {
      const stateKey = `${definition.trustStateKey}:${candidate.groupIndex}:${candidate.hookIndex}`;
      const hasTrust = trustSectionHasTrustedHash(configText, stateKey);
      if (definition.trustRequired === false) {
        checks.push({
          name: `${definition.name} trusted hash advisory`,
          status: 'pass',
          evidence: hasTrust ? `${stateKey} present` : `${stateKey} not required`
        });
      } else {
        addCheck(checks, failures, `${definition.name} trusted hash`, hasTrust, stateKey);
      }
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
