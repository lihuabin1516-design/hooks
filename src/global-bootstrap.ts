import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveCurrentTaskBindingFromCwd } from './current-task.js';
import { readGitState, readGitTopology, GitTopologyError } from './git-state.js';
import { normalizeForComparison } from './paths.js';
import { findTaskBinding, readTaskBindingRegistry } from './task-binding-registry.js';

export type BootstrapStatus =
  | 'READY'
  | 'MISSING_TASK_BINDING'
  | 'REGISTRY_MISSING'
  | 'REGISTRY_INVALID'
  | 'CONTEXT_MISSING';

export type ContextParseStatus = 'parsed' | 'missing' | 'invalid' | 'read_error';
export type ContextGenerationKind = 'current' | 'previous' | 'previous2';
export type BootstrapNextGate = 'MCP_DISCOVERY';

export interface BootstrapInput {
  cwd: string;
  registryPath?: string | null;
}

export interface BootstrapContextGeneration {
  kind: ContextGenerationKind;
  path: string;
  exists: boolean;
  observedAt: string;
  sha256: string | null;
  parseStatus: ContextParseStatus;
  parseReason?: string | null;
}

export interface BootstrapTaskBinding {
  status: 'resolved';
  source: 'registry' | 'local-current-task';
  taskId: string;
  projectPath: string;
  worktreeRoot: string;
  handoffPath: string;
  contextPath: string;
  coordinatorNamespace: string | null;
}

export interface BootstrapTaskScope {
  taskId: string;
  projectPath: string;
  worktreeRoot: string;
  phase: string | null;
  objective: string | null;
  auditDir: string | null;
  currentContextPath: string;
  previousContextPath: string;
  previous2ContextPath: string;
}

export interface BootstrapWorktree {
  cwd: string;
  root: string | null;
  gitRoot: string | null;
  gitCommonDir: string | null;
  gitBranch: string | null;
  gitHead: string | null;
  gitDirty: boolean | null;
  gitStatusShort: string | null;
  currentContextPath: string;
  previousContextPath: string;
  previous2ContextPath: string;
}

export interface BootstrapResult {
  schema: 'ccpanes.bootstrap.v1';
  status: BootstrapStatus;
  cwd: string;
  taskId: string | null;
  projectPath: string | null;
  worktreeRoot: string | null;
  handoff: {
    path: string | null;
    exists: boolean;
  };
  context: {
    path: string | null;
    exists: boolean;
    kind?: ContextGenerationKind;
    observedAt?: string;
    sha256?: string | null;
    parseStatus?: ContextParseStatus;
    parseReason?: string | null;
  };
  coordinatorNamespace: string | null;
  reason: string;
  contextGenerations: BootstrapContextGeneration[];
  verifiedFacts: string[];
  unverifiedAssumptions: string[];
  currentBlockers: string[];
  taskScope: BootstrapTaskScope | null;
  protectedPaths: string[];
  recentAcceptanceEvidence: string[];
  taskBinding: BootstrapTaskBinding | null;
  worktree: BootstrapWorktree;
  auditDir: string | null;
  nextGate: BootstrapNextGate;
}

interface ParsedContextSnapshot {
  generation: number;
  taskId: string;
  projectPath: string;
  worktreeRoot: string;
  phase: string;
  objective: string;
  auditDir: string | null;
  progress: string[];
  blockers: string[];
  nextSteps: string[];
  increments: string[];
  evidence: string[];
}

interface ContextRecord extends BootstrapContextGeneration {
  parsed: ParsedContextSnapshot | null;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').toUpperCase();
}

function nowIso(): string {
  return new Date().toISOString();
}

function readErrorReason(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === 'string' && code.length > 0) return code;
    const name = (error as Error).name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return 'read_error';
}

async function exists(file: string | null): Promise<boolean> {
  if (!file) return false;
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSection(text: string, heading: string): string | null {
  const pattern = new RegExp(
    `(?:^|\\r?\\n)${escapeRegExp(heading)}\\r?\\n([\\s\\S]*?)(?=\\r?\\n##\\s|\\r?\\n#\\s|$)`
  );
  return pattern.exec(text)?.[1] ?? null;
}

function bulletsFromSection(text: string, heading: string): string[] {
  const section = extractSection(text, heading);
  if (!section) return [];
  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

function scalarFromSection(text: string, heading: string, key: string): string | null {
  const section = extractSection(text, heading);
  if (!section) return null;
  const match = new RegExp(`^\\- ${escapeRegExp(key)}:\\s*(.+)$`, 'm').exec(section);
  return match?.[1]?.trim() ?? null;
}

function parseContextSnapshot(text: string): ParsedContextSnapshot | null {
  const requiredHeadings = [
    '# 上下文压缩后先读 `context.md`',
    '## 0. 快照元信息',
    '## 1. 当前任务',
    '## 2. 当前进度',
    '## 3. 当前卡点',
    '## 4. 下一步',
    '## 5. 上下文快照保留策略',
    '## 6. 避坑点',
    '## 7. 上下文压缩后的恢复步骤',
    '## 8. 本轮增量',
    '## 9. 更新检查清单',
    '## 10. 验证证据'
  ] as const;

  for (const heading of requiredHeadings) {
    if (!text.includes(heading)) return null;
  }
  if (!/^schema:\s*ccpanes\.context\.v1\s*$/m.test(text)) return null;
  if (!/^retentionPolicy:\s*current-plus-two-previous\s*$/m.test(text)) return null;

  const generationMatch = /^snapshotGeneration:\s*([1-9][0-9]*)\s*$/m.exec(text);
  if (!generationMatch) return null;
  const generation = Number(generationMatch[1]);
  if (!Number.isSafeInteger(generation)) return null;

  const taskId = scalarFromSection(text, '## 1. 当前任务', 'taskId');
  const projectPath = scalarFromSection(text, '## 1. 当前任务', 'projectPath');
  const worktreeRoot = scalarFromSection(text, '## 1. 当前任务', 'worktreeRoot');
  const phase = scalarFromSection(text, '## 1. 当前任务', 'phase');
  const objective = scalarFromSection(text, '## 1. 当前任务', 'objective');
  if (!taskId || !projectPath || !worktreeRoot || !phase || !objective) return null;

  return {
    generation,
    taskId,
    projectPath,
    worktreeRoot,
    phase,
    objective,
    auditDir: scalarFromSection(text, '## 1. 当前任务', 'auditDir'),
    progress: bulletsFromSection(text, '## 2. 当前进度'),
    blockers: bulletsFromSection(text, '## 3. 当前卡点'),
    nextSteps: bulletsFromSection(text, '## 4. 下一步'),
    increments: bulletsFromSection(text, '## 8. 本轮增量'),
    evidence: bulletsFromSection(text, '## 10. 验证证据')
  };
}

async function readContextRecord(kind: ContextGenerationKind, filePath: string): Promise<ContextRecord> {
  const observedAt = nowIso();
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const hash = sha256(text);
    const parsed = parseContextSnapshot(text);
    if (!parsed) {
      return {
        kind,
        path: filePath,
        exists: true,
        observedAt,
        sha256: hash,
        parseStatus: 'invalid',
        parseReason: 'parse_failed',
        parsed: null
      };
    }
    return {
      kind,
      path: filePath,
      exists: true,
      observedAt,
      sha256: hash,
      parseStatus: 'parsed',
      parseReason: null,
      parsed
    };
  } catch (error) {
    const code = readErrorReason(error);
    if (code === 'ENOENT') {
      return {
        kind,
        path: filePath,
        exists: false,
        observedAt,
        sha256: null,
        parseStatus: 'missing',
        parseReason: 'ENOENT',
        parsed: null
      };
    }
    return {
      kind,
      path: filePath,
      exists: true,
      observedAt,
      sha256: null,
      parseStatus: 'read_error',
      parseReason: code,
      parsed: null
    };
  }
}

async function readContextGenerations(root: string): Promise<{
  current: ContextRecord;
  previous: ContextRecord;
  previous2: ContextRecord;
}> {
  const resolvedRoot = path.resolve(root);
  return {
    current: await readContextRecord('current', path.join(resolvedRoot, 'context.md')),
    previous: await readContextRecord('previous', path.join(resolvedRoot, 'context.prev.md')),
    previous2: await readContextRecord('previous2', path.join(resolvedRoot, 'context.prev2.md'))
  };
}

function canonicalContextPaths(worktreeRoot: string): {
  current: string;
  previous: string;
  previous2: string;
} {
  return {
    current: path.join(worktreeRoot, 'context.md'),
    previous: path.join(worktreeRoot, 'context.prev.md'),
    previous2: path.join(worktreeRoot, 'context.prev2.md')
  };
}

function canonicalTaskPath(worktreeRoot: string): string {
  return path.join(worktreeRoot, '.ccpanes-task', 'current-task.json');
}

function isCanonicalPathMatch(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right);
}

function uniquePaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const key = normalizeForComparison(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

interface FailureExtrasInput {
  protectedPaths: string[];
  taskBinding: BootstrapTaskBinding | null;
  auditDir: string | null;
}

function createFailureWorktree(cwd: string, currentContextPath: string, previousContextPath: string, previous2ContextPath: string): BootstrapWorktree {
  return {
    cwd: path.resolve(cwd),
    root: null,
    gitRoot: null,
    gitCommonDir: null,
    gitBranch: null,
    gitHead: null,
    gitDirty: null,
    gitStatusShort: null,
    currentContextPath,
    previousContextPath,
    previous2ContextPath
  };
}

function createFailureExtras(
  cwd: string,
  currentContextPath: string,
  previousContextPath: string,
  previous2ContextPath: string,
  input: FailureExtrasInput
): Omit<
  BootstrapResult,
  'schema' | 'status' | 'cwd' | 'taskId' | 'projectPath' | 'worktreeRoot' | 'handoff' | 'context' | 'coordinatorNamespace' | 'reason' | 'contextGenerations' | 'nextGate'
> {
  return {
    verifiedFacts: [],
    unverifiedAssumptions: [],
    currentBlockers: [],
    taskScope: null,
    protectedPaths: uniquePaths(input.protectedPaths),
    recentAcceptanceEvidence: [],
    taskBinding: input.taskBinding,
    worktree: createFailureWorktree(cwd, currentContextPath, previousContextPath, previous2ContextPath),
    auditDir: input.auditDir
  };
}

function createFailureResult(
  input: BootstrapInput,
  status: BootstrapStatus,
  binding: BootstrapTaskBinding | null,
  handoffExists: boolean,
  generations: {
    current: ContextRecord;
    previous: ContextRecord;
    previous2: ContextRecord;
  },
  reason: string,
  failureInput: FailureExtrasInput
): BootstrapResult {
  return buildResult(
    input,
    status,
    binding,
    handoffExists,
    generations,
    reason,
    createFailureExtras(
      input.cwd,
      generations.current.path,
      generations.previous.path,
      generations.previous2.path,
      failureInput
    )
  );
}

function buildResult(
  input: BootstrapInput,
  status: BootstrapStatus,
  binding: BootstrapTaskBinding | null,
  handoffExists: boolean,
  generations: {
    current: ContextRecord;
    previous: ContextRecord;
    previous2: ContextRecord;
  },
  reason: string,
  extras: Omit<
    BootstrapResult,
    'schema' | 'status' | 'cwd' | 'taskId' | 'projectPath' | 'worktreeRoot' | 'handoff' | 'context' | 'coordinatorNamespace' | 'reason' | 'contextGenerations' | 'nextGate'
  >
): BootstrapResult {
  const current = generations.current;
  return {
    schema: 'ccpanes.bootstrap.v1',
    status,
    cwd: path.resolve(input.cwd),
    taskId: binding?.taskId ?? null,
    projectPath: binding?.projectPath ?? null,
    worktreeRoot: binding?.worktreeRoot ?? null,
    handoff: {
      path: binding?.handoffPath ?? null,
      exists: handoffExists
    },
    context: {
      kind: current.kind,
      path: current.path,
      exists: current.exists,
      observedAt: current.observedAt,
      sha256: current.sha256,
      parseStatus: current.parseStatus,
      parseReason: current.parseReason
    },
    coordinatorNamespace: binding?.coordinatorNamespace ?? null,
    reason,
    contextGenerations: [
      {
        kind: generations.current.kind,
        path: generations.current.path,
        exists: generations.current.exists,
        observedAt: generations.current.observedAt,
        sha256: generations.current.sha256,
        parseStatus: generations.current.parseStatus,
        parseReason: generations.current.parseReason
      },
      {
        kind: generations.previous.kind,
        path: generations.previous.path,
        exists: generations.previous.exists,
        observedAt: generations.previous.observedAt,
        sha256: generations.previous.sha256,
        parseStatus: generations.previous.parseStatus,
        parseReason: generations.previous.parseReason
      },
      {
        kind: generations.previous2.kind,
        path: generations.previous2.path,
        exists: generations.previous2.exists,
        observedAt: generations.previous2.observedAt,
        sha256: generations.previous2.sha256,
        parseStatus: generations.previous2.parseStatus,
        parseReason: generations.previous2.parseReason
      }
    ],
    verifiedFacts: extras.verifiedFacts,
    unverifiedAssumptions: extras.unverifiedAssumptions,
    currentBlockers: extras.currentBlockers,
    taskScope: extras.taskScope,
    protectedPaths: extras.protectedPaths,
    recentAcceptanceEvidence: extras.recentAcceptanceEvidence,
    taskBinding: extras.taskBinding,
    worktree: extras.worktree,
    auditDir: extras.auditDir,
    nextGate: 'MCP_DISCOVERY'
  };
}

function collectHistoricalUnverifiedAssumptions(records: ContextRecord[]): string[] {
  const assumptions: string[] = [];
  for (const record of records) {
    if (record.parseStatus !== 'parsed' || !record.parsed) continue;
    assumptions.push(
      ...record.parsed.progress,
      ...record.parsed.nextSteps,
      ...record.parsed.increments,
      ...record.parsed.blockers,
      ...record.parsed.evidence
    );
  }
  return assumptions;
}

function compareNonNullValues(values: ReadonlyArray<string | null>): boolean {
  const normalized = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    normalized.add(normalizeForComparison(value));
  }
  return normalized.size <= 1;
}

function compareAuditDirValues(values: ReadonlyArray<string | null>): boolean {
  let observedValue: string | null = null;
  let sawValue = false;
  let sawMissing = false;
  for (const value of values) {
    if (!value) {
      sawMissing = true;
      continue;
    }
    const normalized = normalizeForComparison(value);
    if (!sawValue) {
      observedValue = normalized;
      sawValue = true;
      continue;
    }
    if (observedValue !== normalized) return false;
  }
  if (!sawValue) return true;
  return !sawMissing;
}

function failureReasonFromParseStatus(kind: ContextGenerationKind, parseStatus: ContextParseStatus): string {
  switch (parseStatus) {
    case 'missing':
      return kind === 'current' ? 'current_context_missing' : 'context_generation_conflict';
    case 'invalid':
      return kind === 'current' ? 'current_context_invalid' : 'context_generation_invalid';
    case 'read_error':
      return kind === 'current' ? 'current_context_read_error' : 'context_generation_read_error';
    case 'parsed':
      return 'context_generation_conflict';
    default:
      return 'context_generation_conflict';
  }
}

function safeGitTopology(cwd: string): ReturnType<typeof readGitTopology> | null {
  try {
    return readGitTopology(cwd);
  } catch (error) {
    if (error instanceof GitTopologyError) return null;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function safeGitState(cwd: string): ReturnType<typeof readGitState> | null {
  try {
    return readGitState(cwd);
  } catch (error) {
    if (error instanceof GitTopologyError) return null;
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function resolveBootstrap(input: BootstrapInput): Promise<BootstrapResult> {
  const requestedRegistry = input.registryPath
    ? path.resolve(input.registryPath)
    : path.join(os.homedir(), '.cc-panes', 'task-bindings.json');
  const registryCandidates = input.registryPath
    ? [requestedRegistry]
    : [requestedRegistry, path.join(path.resolve(input.cwd), '.ccpanes-task', 'task-bindings.json')];

  let registry;
  let registryFound = false;
  for (const registryPath of registryCandidates) {
    try {
      registry = await readTaskBindingRegistry(registryPath);
      registryFound = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const generations = await readContextGenerations(input.cwd);
        return createFailureResult(
          input,
          'REGISTRY_INVALID',
          null,
          false,
          generations,
          'task_binding_registry_invalid',
          {
            protectedPaths: [
              generations.current.path,
              generations.previous.path,
              generations.previous2.path
            ],
            taskBinding: null,
            auditDir: null
          }
        );
      }
    }
  }

  let binding: BootstrapTaskBinding | null = null;
  let bindingSource: BootstrapTaskBinding['source'] | null = null;

    if (!registryFound || !registry) {
      const local = await resolveCurrentTaskBindingFromCwd(input.cwd);
      if (local.check.status === 'matched' && local.candidate) {
      binding = {
        status: 'resolved',
        source: 'local-current-task',
        taskId: local.candidate.task.taskId,
        worktreeRoot: local.candidate.task.worktreeRoot,
        projectPath: local.candidate.task.projectPath,
        handoffPath: path.join(local.candidate.task.worktreeRoot, 'HANDOFF.md'),
        contextPath: path.join(local.candidate.task.worktreeRoot, 'context.md'),
        coordinatorNamespace: null
      };
      bindingSource = 'local-current-task';
      } else {
        const generations = await readContextGenerations(input.cwd);
        return createFailureResult(
          input,
          'REGISTRY_MISSING',
          null,
          false,
          generations,
          'task_binding_registry_missing',
          {
            protectedPaths: [
              generations.current.path,
              generations.previous.path,
              generations.previous2.path
            ],
            taskBinding: null,
            auditDir: null
          }
        );
      }
  } else {
    const registryBinding = findTaskBinding(registry, input.cwd);
    binding = registryBinding
      ? {
        status: 'resolved',
        source: 'registry',
        taskId: registryBinding.taskId,
        projectPath: registryBinding.projectPath,
        worktreeRoot: registryBinding.worktreeRoot,
        handoffPath: registryBinding.handoffPath,
        contextPath: registryBinding.contextPath,
        coordinatorNamespace: registryBinding.coordinatorNamespace
      }
      : null;
    bindingSource = binding?.source ?? null;
    if (!binding) {
      const generations = await readContextGenerations(input.cwd);
      return createFailureResult(
        input,
        'MISSING_TASK_BINDING',
        null,
        false,
        generations,
        'no_exact_worktree_binding',
        {
          protectedPaths: [
            generations.current.path,
            generations.previous.path,
            generations.previous2.path
          ],
          taskBinding: null,
          auditDir: null
        }
      );
    }
  }

  if (!binding || !bindingSource) {
    throw new Error('bootstrap binding resolution failed unexpectedly');
  }

  const worktreeRoot = path.resolve(binding.worktreeRoot);
  const currentContextPath = path.join(worktreeRoot, 'context.md');
  const previousContextPath = path.join(worktreeRoot, 'context.prev.md');
  const previous2ContextPath = path.join(worktreeRoot, 'context.prev2.md');
  const canonicalCurrentTaskPath = canonicalTaskPath(worktreeRoot);
  const handoffExists = await exists(binding.handoffPath);
  if (!handoffExists) {
    const generations = await readContextGenerations(worktreeRoot);
    return createFailureResult(
      input,
      'CONTEXT_MISSING',
      binding,
      false,
      generations,
      'handoff_missing',
      {
        protectedPaths: [
          binding.projectPath,
          binding.worktreeRoot,
          binding.handoffPath,
          currentContextPath,
          previousContextPath,
          previous2ContextPath,
          canonicalCurrentTaskPath
        ],
        taskBinding: binding,
        auditDir: null
      }
    );
  }

  if (!isCanonicalPathMatch(binding.contextPath, currentContextPath)) {
    const generations = {
      current: await readContextRecord('current', currentContextPath),
      previous: await readContextRecord('previous', previousContextPath),
      previous2: await readContextRecord('previous2', previous2ContextPath)
    };
    return createFailureResult(
      input,
      'MISSING_TASK_BINDING',
      binding,
      handoffExists,
      generations,
      'binding_context_path_mismatch',
      {
        protectedPaths: [],
        taskBinding: binding,
        auditDir: null
      }
    );
  }

  const generations = {
    current: await readContextRecord('current', currentContextPath),
    previous: await readContextRecord('previous', previousContextPath),
    previous2: await readContextRecord('previous2', previous2ContextPath)
  };

  if (generations.current.parseStatus !== 'parsed' || !generations.current.parsed) {
    return createFailureResult(
      input,
      'CONTEXT_MISSING',
      binding,
      handoffExists,
      generations,
      failureReasonFromParseStatus(generations.current.kind, generations.current.parseStatus),
      {
        protectedPaths: [
          binding.projectPath,
          binding.worktreeRoot,
          binding.handoffPath,
          currentContextPath,
          previousContextPath,
          previous2ContextPath,
          canonicalCurrentTaskPath
        ],
        taskBinding: binding,
        auditDir: null
      }
    );
  }

  if (
    generations.previous.parseStatus === 'invalid' ||
    generations.previous.parseStatus === 'read_error' ||
    generations.previous2.parseStatus === 'invalid' ||
    generations.previous2.parseStatus === 'read_error'
  ) {
    const reason =
      generations.previous.parseStatus === 'read_error' || generations.previous2.parseStatus === 'read_error'
        ? 'context_generation_read_error'
        : 'context_generation_invalid';
    return createFailureResult(
      input,
      'CONTEXT_MISSING',
      binding,
      handoffExists,
      generations,
      reason,
      {
        protectedPaths: [
          binding.projectPath,
          binding.worktreeRoot,
          binding.handoffPath,
          currentContextPath,
          previousContextPath,
          previous2ContextPath,
          canonicalCurrentTaskPath
        ],
        taskBinding: binding,
        auditDir: null
      }
    );
  }

  if (generations.previous.parseStatus === 'missing' && generations.previous2.parseStatus === 'parsed') {
    return createFailureResult(
      input,
      'CONTEXT_MISSING',
      binding,
      handoffExists,
      generations,
      'context_generation_conflict',
      {
        protectedPaths: [
          binding.projectPath,
          binding.worktreeRoot,
          binding.handoffPath,
          currentContextPath,
          previousContextPath,
          previous2ContextPath,
          canonicalCurrentTaskPath
        ],
        taskBinding: binding,
        auditDir: null
      }
    );
  }

  const current = generations.current.parsed;
  const previous = generations.previous.parsed;
  const previous2 = generations.previous2.parsed;

  if (
    current.taskId !== binding.taskId ||
    current.projectPath !== binding.projectPath ||
    current.worktreeRoot !== binding.worktreeRoot
  ) {
    return createFailureResult(
      input,
      'CONTEXT_MISSING',
      binding,
      handoffExists,
      generations,
      'context_generation_conflict',
      {
        protectedPaths: [
          binding.projectPath,
          binding.worktreeRoot,
          binding.handoffPath,
          currentContextPath,
          previousContextPath,
          previous2ContextPath,
          canonicalCurrentTaskPath
        ],
        taskBinding: binding,
        auditDir: null
      }
    );
  }

  const commonTaskValues = {
    taskId: [binding.taskId, current.taskId, previous?.taskId ?? null, previous2?.taskId ?? null],
    projectPath: [binding.projectPath, current.projectPath, previous?.projectPath ?? null, previous2?.projectPath ?? null],
    worktreeRoot: [binding.worktreeRoot, current.worktreeRoot, previous?.worktreeRoot ?? null, previous2?.worktreeRoot ?? null],
    auditDir: [current.auditDir, previous?.auditDir ?? null, previous2?.auditDir ?? null]
  } as const;

  if (
    !compareNonNullValues(commonTaskValues.taskId) ||
    !compareNonNullValues(commonTaskValues.projectPath) ||
    !compareNonNullValues(commonTaskValues.worktreeRoot) ||
    !compareAuditDirValues(commonTaskValues.auditDir)
  ) {
    return createFailureResult(
      input,
      'CONTEXT_MISSING',
      binding,
      handoffExists,
      generations,
      'context_generation_conflict',
      {
        protectedPaths: [
          binding.projectPath,
          binding.worktreeRoot,
          binding.handoffPath,
          currentContextPath,
          previousContextPath,
          previous2ContextPath,
          canonicalCurrentTaskPath
        ],
        taskBinding: binding,
        auditDir: null
      }
    );
  }

  if (previous && previous.generation !== current.generation - 1) {
    return createFailureResult(
      input,
      'CONTEXT_MISSING',
      binding,
      handoffExists,
      generations,
      'context_generation_conflict',
      {
        protectedPaths: [
          binding.projectPath,
          binding.worktreeRoot,
          binding.handoffPath,
          currentContextPath,
          previousContextPath,
          previous2ContextPath,
          canonicalCurrentTaskPath
        ],
        taskBinding: binding,
        auditDir: null
      }
    );
  }

  if (!previous && previous2) {
    return createFailureResult(
      input,
      'CONTEXT_MISSING',
      binding,
      handoffExists,
      generations,
      'context_generation_conflict',
      {
        protectedPaths: [
          binding.projectPath,
          binding.worktreeRoot,
          binding.handoffPath,
          currentContextPath,
          previousContextPath,
          previous2ContextPath,
          canonicalCurrentTaskPath
        ],
        taskBinding: binding,
        auditDir: null
      }
    );
  }

  if (previous2 && previous2.generation !== current.generation - 2) {
    return createFailureResult(
      input,
      'CONTEXT_MISSING',
      binding,
      handoffExists,
      generations,
      'context_generation_conflict',
      {
        protectedPaths: [
          binding.projectPath,
          binding.worktreeRoot,
          binding.handoffPath,
          currentContextPath,
          previousContextPath,
          previous2ContextPath,
          canonicalCurrentTaskPath
        ],
        taskBinding: binding,
        auditDir: null
      }
    );
  }

  const gitTopology = safeGitTopology(input.cwd);
  const gitState = safeGitState(input.cwd);
  const verifiedFacts = [
    `binding.taskId matches current context.md: ${binding.taskId}`,
    `binding.worktreeRoot matches current context.md: ${binding.worktreeRoot}`,
    `binding.projectPath matches current context.md: ${binding.projectPath}`,
    `current context.md parsed as generation ${current.generation}`,
    `context.prev.md ${previous ? `parsed as generation ${previous.generation}` : 'missing and tolerated'}`,
    `context.prev2.md ${previous2 ? `parsed as generation ${previous2.generation}` : 'missing and tolerated'}`
  ];
  if (gitState) {
    verifiedFacts.push(
      gitState.root ? `git root resolved: ${gitState.root}` : 'git root unavailable',
      gitState.branch ? `git branch resolved: ${gitState.branch}` : 'git branch unavailable',
      gitState.head ? `git head resolved: ${gitState.head}` : 'git head unavailable'
    );
  } else {
    verifiedFacts.push('git state unavailable');
  }

  const unverifiedAssumptions = [
    ...current.progress,
    ...current.nextSteps,
    ...current.increments,
    ...(previous ? [
      ...previous.progress,
      ...previous.nextSteps,
      ...previous.increments,
      ...previous.blockers,
      ...previous.evidence
    ] : []),
    ...(previous2 ? [
      ...previous2.progress,
      ...previous2.nextSteps,
      ...previous2.increments,
      ...previous2.blockers,
      ...previous2.evidence
    ] : [])
  ].filter((line) => line.length > 0);

  const currentBlockers = current.blockers.filter((line) => line.toLowerCase() !== 'none');
  const recentAcceptanceEvidence = current.evidence;
  const auditDir = current.auditDir;
  const taskScope: BootstrapTaskScope = {
    taskId: current.taskId,
    projectPath: current.projectPath,
    worktreeRoot: current.worktreeRoot,
    phase: current.phase,
    objective: current.objective,
    auditDir,
    currentContextPath,
    previousContextPath,
    previous2ContextPath
  };
  const protectedPaths = uniquePaths([
    binding.projectPath,
    binding.worktreeRoot,
    binding.handoffPath,
    currentContextPath,
    previousContextPath,
    previous2ContextPath,
    canonicalCurrentTaskPath
  ]);
  const taskBinding: BootstrapTaskBinding = {
    status: 'resolved',
    source: bindingSource,
    taskId: binding.taskId,
    projectPath: binding.projectPath,
    worktreeRoot: binding.worktreeRoot,
    handoffPath: binding.handoffPath,
    contextPath: binding.contextPath,
    coordinatorNamespace: binding.coordinatorNamespace
  };

  return buildResult(
    input,
    'READY',
    taskBinding,
    handoffExists,
    {
      current: generations.current,
      previous: generations.previous,
      previous2: generations.previous2
    },
    bindingSource === 'local-current-task'
      ? 'local_current_task_binding_resolved'
      : 'exact_worktree_binding_and_context_chain_resolved',
    {
      verifiedFacts,
      unverifiedAssumptions,
      currentBlockers,
      taskScope,
      protectedPaths,
      recentAcceptanceEvidence,
      taskBinding,
      worktree: {
        cwd: path.resolve(input.cwd),
        root: gitTopology?.worktreeRoot ?? gitState?.root ?? null,
        gitRoot: gitTopology?.worktreeRoot ?? gitState?.root ?? null,
        gitCommonDir: gitTopology?.commonDir ?? null,
        gitBranch: gitState?.branch ?? null,
        gitHead: gitState?.head ?? null,
        gitDirty: gitState?.dirty ?? null,
        gitStatusShort: gitState?.statusShort ?? null,
        currentContextPath,
        previousContextPath,
        previous2ContextPath
      },
      auditDir
    }
  );
}
