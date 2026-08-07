import path from 'node:path';
import type { HookCall } from './types.js';

export interface ShellCommandInput {
  command: string;
  cwd: string;
}

const readOnlyPrefixes = [
  /^npm\s+(test|t|run\s+(test|typecheck|lint|check))(\s|$)/i,
  /^pnpm\s+(test|run\s+(test|typecheck|lint|check))(\s|$)/i,
  /^yarn\s+(test|run\s+(test|typecheck|lint|check))(\s|$)/i,
  /^git\s+(status|diff|log|show|rev-parse|branch)(\s|$)/i,
  /^get-filehash(\s|$)/i,
  /^get-childitem(\s|$)/i
];

function tokenize(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
  }
  return tokens;
}

function normalizeShellPath(candidate: string, cwd: string): string {
  const trimmed = candidate.trim().replace(/^["'`]|["'`]$/g, '');
  const looksAbsolute = /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('\\');
  const resolved = looksAbsolute ? trimmed : path.resolve(cwd, trimmed);
  return resolved.replace(/\\/g, '/');
}

function call(command: string, targetPath: string | null, writes: boolean, policyReason?: string): HookCall {
  return {
    tool: 'shell',
    targetPath,
    writes,
    command,
    ...(policyReason ? { policyReason } : {})
  };
}

function classifyPolicy(command: string): string | null {
  if (/\bgit\s+reset\b[\s\S]*\s--hard(\s|$)/i.test(command)) return 'destructive_git_reset_hard';
  if (/\bgit\s+clean\b/i.test(command)) return 'destructive_git_clean';
  if (/\bgit\s+push(\s|$)/i.test(command)) return 'external_publication_git_push';
  if (/\bnpm\s+(install|i|add)\b[\s\S]*(\s|^)-g(\s|$)/i.test(command)) return 'global_dependency_install';
  if (/\bpnpm\s+(add|install)\b[\s\S]*(\s|^)-g(\s|$)/i.test(command)) return 'global_dependency_install';
  if (/\byarn\s+global\s+add\b/i.test(command)) return 'global_dependency_install';
  if (/\bpip\s+install\b[\s\S]*(\s|^)--user(\s|$)/i.test(command)) return 'global_dependency_install';
  if (/\brm\s+-[^\s]*[rR][fF]?[^\s]*(\s|$)/i.test(command)) return 'destructive_file_removal';
  if (/\b(remove-item|del|erase|rd|rmdir)\b[\s\S]*(\s|^)-(recurse|r)(\s|$)/i.test(command)) return 'destructive_file_removal';
  if (/\b(node|python|py)\s+(-e|-c)\b[\s\S]*(fs\.|require\(['"]fs['"]\)|open\(|unlink|writefile|appendfile|rmsync|rename|copyfile)/i.test(command)) {
    return 'interpreter_filesystem_mutation';
  }
  return null;
}

function extractRedirectionTargets(command: string, cwd: string): string[] {
  const targets: string[] = [];
  const pattern = /(?:^|[^>])(?:>>|>)\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(command)) !== null) {
    const target = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (target) targets.push(normalizeShellPath(target, cwd));
  }
  return targets;
}

function extractPowerShellTargets(command: string, cwd: string): string[] {
  const tokens = tokenize(command);
  const targets: string[] = [];
  const writeCommands = new Set([
    'set-content', 'sc',
    'add-content', 'ac',
    'out-file',
    'new-item', 'ni',
    'remove-item', 'rm', 'del', 'erase', 'rd', 'rmdir',
    'move-item', 'mi', 'mv',
    'copy-item', 'cp'
  ]);
  const pathFlags = new Set(['-path', '-literalpath', '-filepath', '-destination', '-destinationpath']);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]?.toLowerCase();
    if (!writeCommands.has(token)) continue;

    for (let next = index + 1; next < tokens.length; next += 1) {
      const current = tokens[next]?.toLowerCase();
      if (pathFlags.has(current) && tokens[next + 1]) {
        targets.push(normalizeShellPath(tokens[next + 1], cwd));
        next += 1;
      }
    }

    if (targets.length === 0) {
      const positional = tokens.slice(index + 1).find((candidate) => candidate && !candidate.startsWith('-'));
      if (positional) targets.push(normalizeShellPath(positional, cwd));
    }
  }

  return targets;
}

function extractPackageManagerWriteTarget(command: string, cwd: string): string | null {
  if (/^npm\s+(install|i|add)(\s|$)/i.test(command)) return cwd;
  if (/^pnpm\s+(install|add)(\s|$)/i.test(command)) return cwd;
  if (/^yarn\s+(add|install)(\s|$)/i.test(command)) return cwd;
  return null;
}

export function analyzeShellCommand(input: ShellCommandInput): HookCall[] {
  const command = input.command.trim();
  const cwd = normalizeShellPath(input.cwd, process.cwd());
  const policyReason = classifyPolicy(command);
  if (policyReason) return [call(command, cwd, true, policyReason)];

  if (readOnlyPrefixes.some((pattern) => pattern.test(command))) {
    return [call(command, cwd, false)];
  }

  const targets = [
    ...extractRedirectionTargets(command, cwd),
    ...extractPowerShellTargets(command, cwd)
  ];

  const packageWriteTarget = extractPackageManagerWriteTarget(command, cwd);
  if (packageWriteTarget) targets.push(packageWriteTarget);

  if (targets.length > 0) {
    return targets.map((targetPath) => call(command, targetPath, true));
  }

  if (/\b(set-content|add-content|out-file|new-item|remove-item|move-item|copy-item|apply_patch)\b|(?:^|[^>])(?:>>|>)/i.test(command)) {
    return [call(command, null, true)];
  }

  return [call(command, cwd, false)];
}
