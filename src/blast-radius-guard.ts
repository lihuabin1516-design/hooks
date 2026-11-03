import fs from 'node:fs';
import path from 'node:path';

export type BlastRadiusPlatform = 'windows' | 'linux' | 'macos' | 'unknown';
export type BlastRadiusSeverity = 'block' | 'warn';
export type BlastRadiusVerdict = 'allow' | BlastRadiusSeverity;

export interface BlastRadiusHazard {
  code: string;
  severity: BlastRadiusSeverity;
  evidence: string;
  detail: string;
}

export interface BlastRadiusSummary {
  target: string;
  exists: boolean;
  isDir: boolean;
  files: number;
  dirs: number;
  bytes: number;
  reparsePoints: number;
  truncated: boolean;
  unreadable: number;
  note: string;
}

export interface BlastRadiusAnalysis {
  schema: 'paneforge.blast-radius-guard.v1';
  verdict: BlastRadiusVerdict;
  platform: BlastRadiusPlatform;
  targets: string[];
  hazards: BlastRadiusHazard[];
  blastRadius: BlastRadiusSummary[];
  unknowns: string[];
}

export interface BlastRadiusInput {
  command: string;
  cwd: string;
  platform?: BlastRadiusPlatform;
  wslContext?: boolean;
}

export function isBlastRadiusAnalysis(value: unknown): value is BlastRadiusAnalysis {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.schema === 'paneforge.blast-radius-guard.v1'
    && (record.verdict === 'allow' || record.verdict === 'warn' || record.verdict === 'block')
    && typeof record.platform === 'string'
    && Array.isArray(record.targets)
    && Array.isArray(record.hazards)
    && Array.isArray(record.blastRadius)
    && Array.isArray(record.unknowns);
}

interface Token {
  value: string;
  quoted: boolean;
}

interface ParsedCommand {
  tokens: Token[];
  ambiguous: boolean;
  reason?: string;
}

interface Intent {
  verb: string | null;
  targets: string[];
  recursive: boolean;
  force: boolean;
  wildcard: boolean;
  destructive: boolean;
  mirror: boolean;
  escalated: boolean;
}

const DELETE_VERBS = new Set([
  'rm', 'rmdir', 'del', 'erase', 'rd', 'remove-item', 'ri', 'unlink', 'shred'
]);
const MOVE_VERBS = new Set([
  'mv', 'move', 'move-item', 'rename', 'rename-item', 'ren', 'xcopy', 'robocopy', 'rsync'
]);
const SHELL_LAUNCHERS = new Set(['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'wsl', 'zsh', 'sudo', 'su', 'doas']);
const PRIVILEGE_ESCALATORS = new Set(['sudo', 'su', 'doas']);
const VARIABLE_PATTERN = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[A-Za-z_][A-Za-z0-9_]*%/;
const CJK_PATTERN = /[\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef\u{20000}-\u{2fa1f}]/u;
const MAX_WALK_ENTRIES = 20_000;

function detectPlatform(): BlastRadiusPlatform {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'linux') return 'linux';
  return 'unknown';
}

function detectWslContext(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'))
      || /microsoft/i.test(process.env.WSL_DISTRO_NAME ?? '');
  } catch {
    return /microsoft/i.test(process.env.WSL_DISTRO_NAME ?? '');
  }
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function normalizeTarget(candidate: string, cwd: string): string {
  const value = candidate.trim().replace(/^["'`]|["'`]$/g, '');
  if (isWindowsPath(value) || isWindowsPath(cwd)) {
    return normalizeSlashes(path.win32.resolve(normalizeSlashes(cwd), value));
  }
  return path.posix.resolve(cwd, value);
}

function tokenize(command: string): ParsedCommand {
  const tokens: Token[] = [];
  let buffer = '';
  let quote: '"' | "'" | null = null;
  let quoted = false;

  const flush = (): void => {
    if (buffer.length > 0 || quoted) tokens.push({ value: buffer, quoted });
    buffer = '';
    quoted = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        if (command[index + 1] && !/\s/.test(command[index + 1])) quoted = true;
        else flush();
      } else if (char === '\\' && quote === '"' && command[index + 1] === '"') {
        buffer += '"';
        index += 1;
      } else {
        buffer += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoted = true;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (char === '\\' && command[index + 1] && /["'\\ ]/.test(command[index + 1])) {
      buffer += command[index + 1];
      index += 1;
      continue;
    }
    buffer += char;
    quoted = false;
  }

  if (quote) return { tokens, ambiguous: true, reason: `unterminated ${quote} quote` };
  flush();
  return { tokens, ambiguous: false };
}

function baseCommand(value: string): string {
  return path.posix.basename(normalizeSlashes(value)).replace(/\.exe$/i, '').toLowerCase();
}

function shellLayers(tokens: Token[]): string[] {
  return tokens.map((token) => baseCommand(token.value)).filter((value) => SHELL_LAUNCHERS.has(value));
}

function unwrap(tokens: Token[]): { inner: string | null; layers: string[] } {
  if (tokens.length === 0) return { inner: null, layers: [] };
  const first = baseCommand(tokens[0].value);
  if (!SHELL_LAUNCHERS.has(first)) return { inner: null, layers: [] };
  let index = 1;
  while (index < tokens.length && /^[-/]/.test(tokens[index].value)) {
    const option = tokens[index].value.toLowerCase();
    index += 1;
    if (['-command', '--command', '-c', '/c', '/k', '-e', '--'].includes(option)) break;
  }
  if (index >= tokens.length) return { inner: null, layers: [first] };
  return {
    inner: tokens.slice(index).map((token) => token.value).join(' '),
    layers: [first]
  };
}

function isFlag(value: string, cmdVerb: boolean): boolean {
  if (value.startsWith('./') || value.startsWith('../')) return false;
  if (value.startsWith('-')) return true;
  if (/^\/[defkqrsty]+$/i.test(value) && cmdVerb) return true;
  return /^\/[defkqrsty]{1,2}$/i.test(value);
}

function extractIntent(parsed: ParsedCommand): Intent {
  const values = parsed.tokens.map((token) => token.value);
  const lower = values.map((value) => value.toLowerCase());
  let verbIndex = -1;
  let verb: string | null = null;
  let isMove = false;

  for (let index = 0; index < lower.length; index += 1) {
    const candidate = baseCommand(lower[index]);
    if (DELETE_VERBS.has(candidate)) {
      verb = candidate;
      verbIndex = index;
      break;
    }
    if (MOVE_VERBS.has(candidate)) {
      verb = candidate;
      verbIndex = index;
      isMove = true;
      break;
    }
  }

  const findIndex = lower.findIndex((value) => baseCommand(value) === 'find');
  if (!verb && findIndex >= 0 && lower.slice(findIndex).includes('-delete')) {
    verb = 'find';
    verbIndex = findIndex;
  }

  const gitIndex = lower.findIndex((value) => baseCommand(value) === 'git');
  if (!verb && gitIndex >= 0 && lower[gitIndex + 1] === 'clean') {
    const flags = lower.slice(gitIndex + 2);
    const hasDryRun = flags.some((value) => value === '-n' || (value.startsWith('-') && !value.startsWith('--') && value.includes('n')));
    const hasForce = flags.some((value) => value === '--force' || value === '-f' || (value.startsWith('-') && !value.startsWith('--') && value.includes('f')));
    if (hasForce && !hasDryRun) {
      verb = 'git clean -f';
      verbIndex = gitIndex + 1;
    }
  }
  if (!verb && gitIndex >= 0 && lower[gitIndex + 1] === 'worktree' && lower[gitIndex + 2] === 'remove') {
    verb = 'git worktree remove';
    verbIndex = gitIndex + 2;
  }

  const cmdVerb = ['rd', 'del', 'robocopy', 'xcopy', 'move'].includes(verb ?? '');
  const mirror = ['robocopy', 'rsync'].includes(verb ?? '') && lower.some((value) => value === '/mir' || value === '/mirror' || value === '--delete');
  const recursive = lower.some((value) => value === '--recursive' || value === '-recursive' || value === '-recurse' || value === '/s' || value === '/e' || (value.startsWith('-') && !value.startsWith('--') && value.includes('r')) || (cmdVerb && value.toLowerCase() === '/e'))
    || verb === 'find' || verb === 'git clean -f' || verb === 'git worktree remove' || mirror;
  const force = lower.some((value) => value === '--force' || value === '-force' || value === '--delete' || value === '/q' || value === '/f' || value === '/y' || value === '/mir' || value === '/mirror' || (value.startsWith('-') && !value.startsWith('--') && value.includes('f')))
    || verb === 'find' || verb === 'git clean -f' || verb === 'git worktree remove';
  const escalated = verbIndex > 0 && lower.slice(0, verbIndex).some((value) => PRIVILEGE_ESCALATORS.has(baseCommand(value)));

  const targets: string[] = [];
  const predicateValues = new Set(['-name', '-iname', '-path', '-ipath', '-regex', '-iregex', '-newer']);
  let skipNext = false;
  if (verbIndex >= 0) {
    for (const token of parsed.tokens.slice(verbIndex + 1)) {
      const value = token.value;
      const normalized = value.toLowerCase();
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (predicateValues.has(normalized)) {
        skipNext = true;
        continue;
      }
      if (isFlag(value, cmdVerb)) continue;
      targets.push(value);
    }
  }

  return {
    verb,
    targets,
    recursive,
    force,
    wildcard: targets.some((target) => /[*?]/.test(target)),
    destructive: Boolean(verb && (DELETE_VERBS.has(verb) || isMove || verb === 'find' || verb === 'git clean -f' || verb === 'git worktree remove')),
    mirror,
    escalated
  };
}

function isDriveRoot(value: string): boolean {
  const normalized = normalizeSlashes(value);
  if (normalized === '/' || normalized === '\\') return true;
  const withoutTrailingSlash = normalized.replace(/\/$/, '');
  return /^[A-Za-z]:$/.test(withoutTrailingSlash) || /^\/mnt\/[A-Za-z]$/i.test(withoutTrailingSlash);
}

function systemPrefix(value: string): string | null {
  const parts = normalizeSlashes(value).split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const osPrefixes = new Set(['usr', 'etc', 'bin', 'sbin', 'lib', 'lib32', 'lib64', 'libx32', 'boot', 'proc', 'sys', 'dev']);
  const dataPrefixes = new Set(['home', 'var', 'opt', 'srv', 'root']);
  if (osPrefixes.has(parts[0]) && parts.length <= 2) return `/${parts[0]}`;
  if (dataPrefixes.has(parts[0]) && parts.length === 1) return `/${parts[0]}`;
  return null;
}

function macosSpecial(value: string): string | null {
  const parts = normalizeSlashes(value).split('/').filter(Boolean);
  const specials = new Set(['Desktop', 'Documents', 'Downloads', 'Library', 'Movies', 'Music', 'Pictures', 'Public', 'Applications']);
  return parts.length >= 3 && parts[0] === 'Users' && specials.has(parts[2]) ? parts[2] : null;
}

function isAncestor(target: string, cwd: string): boolean {
  const windows = isWindowsPath(target) || isWindowsPath(cwd);
  const api = windows ? path.win32 : path.posix;
  const normalizedTarget = api.normalize(target);
  const normalizedCwd = api.normalize(cwd);
  return normalizedTarget === normalizedCwd || api.relative(normalizedTarget, normalizedCwd) === '' || !api.relative(normalizedTarget, normalizedCwd).startsWith('..') && !api.isAbsolute(api.relative(normalizedTarget, normalizedCwd));
}

function globBase(target: string): string | null {
  if (!/[*?]/.test(target)) return null;
  const normalized = normalizeSlashes(target);
  const segments = normalized.split('/');
  const base: string[] = [];
  for (const segment of segments) {
    if (/[*?]/.test(segment)) break;
    if (VARIABLE_PATTERN.test(segment)) return '';
    base.push(segment);
  }
  const joined = base.join('/');
  if (normalized.startsWith('/') && joined === '') return '/';
  return joined || '';
}

function walkBlastRadius(target: string): BlastRadiusSummary {
  const result: BlastRadiusSummary = {
    target, exists: false, isDir: false, files: 0, dirs: 0, bytes: 0,
    reparsePoints: 0, truncated: false, unreadable: 0, note: ''
  };
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    result.note = 'target does not exist or cannot be inspected';
    return result;
  }
  result.exists = true;
  result.isDir = stat.isDirectory();
  if (!result.isDir) {
    result.files = 1;
    result.bytes = stat.size;
    return result;
  }

  const stack = [target];
  let seen = 0;
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      result.unreadable += 1;
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > MAX_WALK_ENTRIES) {
        result.truncated = true;
        stack.length = 0;
        break;
      }
      const child = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        result.reparsePoints += 1;
        continue;
      }
      try {
        const childStat = fs.lstatSync(child);
        if (childStat.isDirectory()) {
          result.dirs += 1;
          stack.push(child);
        } else {
          result.files += 1;
          result.bytes += childStat.size;
        }
      } catch {
        result.unreadable += 1;
      }
    }
  }
  return result;
}

function isMountPoint(target: string): boolean {
  try {
    const resolved = fs.realpathSync(target);
    const mountInfo = fs.readFileSync('/proc/self/mountinfo', 'utf8');
    for (const line of mountInfo.split(/\r?\n/)) {
      const fields = line.split(' - ', 1)[0]?.split(' ');
      const mountPoint = fields?.[4]?.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)));
      if (mountPoint && path.resolve(mountPoint) === resolved) return true;
    }
  } catch {
    // The portable device check below remains available without Linux mountinfo.
  }
  try {
    const current = fs.statSync(target);
    const parent = fs.statSync(path.dirname(target));
    return current.dev !== parent.dev;
  } catch {
    return false;
  }
}

function caseCollision(target: string, platform: BlastRadiusPlatform): string | null {
  if (platform !== 'windows' && platform !== 'macos') return null;
  const windows = platform === 'windows' || isWindowsPath(target);
  const api = windows ? path.win32 : path.posix;
  const normalized = api.normalize(target);
  const root = windows ? api.parse(normalized).root : '/';
  const relative = api.relative(root, normalized);
  let current = root;
  for (const segment of relative.split(api.sep).filter(Boolean)) {
    let entries: string[];
    try {
      entries = fs.readdirSync(current);
    } catch {
      return null;
    }
    const exact = entries.find((entry) => entry === segment);
    if (exact) {
      current = api.join(current, exact);
      continue;
    }
    const insensitive = entries.find((entry) => entry.toLowerCase() === segment.toLowerCase());
    if (insensitive) return api.join(current, insensitive);
    return null;
  }
  return null;
}

function hazard(code: string, severity: BlastRadiusSeverity, evidence: string, detail: string): BlastRadiusHazard {
  return { code, severity, evidence, detail };
}

function verdictOf(hazards: BlastRadiusHazard[]): BlastRadiusVerdict {
  if (hazards.some((item) => item.severity === 'block')) return 'block';
  if (hazards.some((item) => item.severity === 'warn')) return 'warn';
  return 'allow';
}

function mergeHazards(target: BlastRadiusHazard[], incoming: BlastRadiusHazard[]): void {
  const seen = new Set(target.map((item) => `${item.code}:${item.detail}`));
  for (const item of incoming) {
    const key = `${item.code}:${item.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      target.push(item);
    }
  }
}

function emptyAnalysis(platform: BlastRadiusPlatform): BlastRadiusAnalysis {
  return {
    schema: 'paneforge.blast-radius-guard.v1',
    verdict: 'allow',
    platform,
    targets: [],
    hazards: [],
    blastRadius: [],
    unknowns: []
  };
}

export function analyzeBlastRadiusCommand(input: BlastRadiusInput): BlastRadiusAnalysis {
  const platform = input.platform ?? detectPlatform();
  const wslContext = input.wslContext ?? detectWslContext();
  const result = emptyAnalysis(platform);
  if (!input.command.trim()) return result;
  if (input.command.includes('\0')) {
    result.hazards.push(hazard('H0_AMBIGUOUS', 'block', 'shell-nul-byte', 'command contains a NUL byte'));
    result.verdict = 'block';
    return result;
  }

  const parsed = tokenize(input.command);
  if (parsed.ambiguous) {
    result.hazards.push(hazard('H0_AMBIGUOUS', 'block', 'shell-parse', parsed.reason ?? 'command cannot be parsed unambiguously'));
    result.verdict = 'block';
    return result;
  }

  const outerLayers = shellLayers(parsed.tokens);
  const unwrapped = unwrap(parsed.tokens);
  if (unwrapped.layers.length > 0 && unwrapped.inner !== null) {
    const inner = analyzeBlastRadiusCommand({
      command: unwrapped.inner,
      cwd: input.cwd,
      platform,
      wslContext: wslContext || unwrapped.layers.includes('wsl')
    });
    mergeHazards(result.hazards, inner.hazards);
    result.targets.push(...inner.targets);
    result.blastRadius.push(...inner.blastRadius);
    result.unknowns.push(...inner.unknowns);
    if (outerLayers.some((layer) => ['sudo', 'su', 'doas'].includes(layer)) && inner.verdict !== 'allow') {
      result.hazards.push(hazard('H10_SUDO_DELETE', 'block', 'privilege-escalated-shell', `privileged shell layer: ${outerLayers.join(' -> ')}`));
    }
    if (parsed.tokens.some((token) => token.quoted && (token.value.includes(' ') || CJK_PATTERN.test(token.value)))) {
      result.hazards.push(hazard('H1_QUOTE_CHAIN', 'block', 'nested-shell-quoting', `nested shell layers: ${outerLayers.join(' -> ')}`));
    }
    result.verdict = verdictOf(result.hazards);
    return result;
  }

  const intent = extractIntent(parsed);
  if (!intent.destructive) return result;
  const targets = intent.targets.map((target) => normalizeTarget(target, input.cwd));
  result.targets = targets;
  if (targets.length === 0 && intent.verb !== 'git clean -f') {
    result.hazards.push(hazard('H0_AMBIGUOUS', 'block', 'destructive-command-parser', `no target resolved for ${intent.verb ?? 'command'}`));
  }
  if (intent.escalated) {
    result.hazards.push(hazard('H10_SUDO_DELETE', 'block', 'privilege-escalation', `${intent.verb} runs through sudo/doas/su`));
  }
  if (intent.verb && ['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'wsl', 'zsh'].includes(intent.verb) && intent.destructive) {
    result.hazards.push(hazard('H0_AMBIGUOUS', 'block', 'shell-layer', `cannot safely resolve ${intent.verb} inner command`));
  }

  for (const target of targets) {
    if (isDriveRoot(target)) result.hazards.push(hazard('H2_DRIVE_ROOT', 'block', 'volume-root-delete', `target is a volume root: ${target}`));
    if (VARIABLE_PATTERN.test(target)) result.hazards.push(hazard('H0_AMBIGUOUS', 'block', 'unexpanded-variable', `target contains an unresolved variable: ${target}`));
    if (CJK_PATTERN.test(target) && platform === 'windows') result.hazards.push(hazard('H5_CJK_SILENT_FAIL', 'warn', 'windows-cjk-path', `target contains CJK characters: ${target}`));
    const normalizedTarget = normalizeSlashes(target).toLowerCase();
    if (platform === 'linux' && wslContext && /^\/mnt\/[a-z](?:\/|$)/.test(normalizedTarget) && !/^\/mnt\/[a-z]$/.test(normalizedTarget)) {
      result.hazards.push(hazard('H6_WSL_CROSS_FS', 'warn', 'wsl-windows-mount', `target is on a WSL Windows mount: ${target}`));
    }
    if (isAncestor(target, input.cwd)) result.hazards.push(hazard('H7_ANCESTOR_OF_CWD', 'block', 'cwd-ancestor', `${target} is the current directory or one of its ancestors`));

    const collision = caseCollision(target, platform);
    if (collision && normalizeSlashes(collision) !== normalizeSlashes(target)) {
      result.hazards.push(hazard('H3_CASE_COLLISION', 'block', 'case-insensitive-filesystem', `${target} resolves to ${collision}`));
    }

    if (intent.wildcard && intent.recursive) {
      result.hazards.push(hazard('H8_GLOB_RECURSIVE', 'warn', 'recursive-wildcard', `recursive wildcard target: ${target}`));
      const base = globBase(target);
      if (base === '') result.hazards.push(hazard('H0_AMBIGUOUS', 'block', 'unknown-glob-prefix', `wildcard target has no determinable prefix: ${target}`));
      if (/^(?:[A-Za-z]:)?\/\*$/.test(target)) result.hazards.push(hazard('H2_DRIVE_ROOT', 'block', 'wildcard-volume-root', `wildcard target expands from the filesystem root: ${target}`));
      if (base && isDriveRoot(base)) result.hazards.push(hazard('H2_DRIVE_ROOT', 'block', 'wildcard-volume-root', `wildcard prefix is a volume root: ${base}`));
      if (base && platform === 'linux' && systemPrefix(base)) result.hazards.push(hazard('H11_SYSTEM_PREFIX', 'block', 'wildcard-system-prefix', `wildcard prefix hits ${systemPrefix(base)}`));
    }

    const shouldInspect = intent.recursive || intent.force || intent.mirror;
    if (shouldInspect) {
      const radius = walkBlastRadius(target);
      result.blastRadius.push(radius);
      if (radius.reparsePoints > 0 && intent.recursive) {
        result.hazards.push(hazard('H4_REPARSE_TRAVERSAL', 'block', 'recursive-link-traversal', `${target} contains ${radius.reparsePoints} symbolic link or junction candidates`));
      }
      if (platform === 'linux' && intent.recursive && isMountPoint(target)) {
        result.hazards.push(hazard('H12_MOUNT_POINT', 'block', 'mounted-filesystem', `${target} is a mount point`));
      }
    }

    if (platform === 'linux' && intent.recursive) {
      const prefix = systemPrefix(target);
      if (prefix) result.hazards.push(hazard('H11_SYSTEM_PREFIX', 'block', 'linux-system-prefix', `${target} hits ${prefix}`));
    }
    if (platform === 'macos') {
      const special = macosSpecial(target);
      if (special) result.hazards.push(hazard('H13_MACOS_HOME_SPECIAL', 'block', 'macos-home-special', `${target} hits ${special}`));
    }
  }

  if ((intent.destructive || intent.mirror) && intent.recursive && intent.force) {
    result.hazards.push(hazard('H9_PERMANENT_DELETE', 'warn', 'permanent-delete', `${intent.verb} recursively changes or deletes data outside the recycle bin`));
  }
  if (platform !== 'windows') result.unknowns.push('Windows junction, drive-root and NTFS case semantics were not verified on this host');
  if (platform !== 'linux') result.unknowns.push('Linux mount and system-prefix semantics were not verified on this host');
  if (platform !== 'macos') result.unknowns.push('macOS APFS and home-special-directory semantics were not verified on this host');
  result.verdict = verdictOf(result.hazards);
  return result;
}

export function blastRadiusPolicyReason(analysis: BlastRadiusAnalysis): string | null {
  if (analysis.verdict === 'allow') return null;
  const codes = analysis.hazards.map((item) => item.code).filter((code, index, values) => values.indexOf(code) === index);
  return `blast_radius_guard_${analysis.verdict}:${codes.join(',') || 'unknown'}`;
}
