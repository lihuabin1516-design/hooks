import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isCodexThreadId } from './codex-session-identity.js';
import { isCodexPathInside } from './codex-session-path.js';

export const DEFAULT_CODEX_CONTEXT_SOFT_THRESHOLD_TOKENS = 220_000;
export const DEFAULT_CODEX_CONTEXT_HARD_THRESHOLD_TOKENS = 240_000;
export const DEFAULT_CODEX_CONTEXT_MAX_TAIL_BYTES = 8 * 1024 * 1024;
export const DEFAULT_CODEX_CONTEXT_STALE_AFTER_MS = 15 * 60 * 1000;

export type CodexContextAvailability = 'available' | 'unavailable';
export type CodexContextPressure = 'normal' | 'soft' | 'hard' | 'unknown';
export type CodexContextAction =
  | 'continue'
  | 'update-context'
  | 'rotate-context-and-checkpoint'
  | 'reconcile-after-compaction'
  | 'inspect';
export type CodexContextCompactionSignal =
  | 'none'
  | 'heuristic-token-drop';
export type CodexContextThresholdMode = 'absolute' | 'scaled';
export type CodexContextFreshness = 'fresh' | 'stale' | 'unknown';
export type CodexContextDiagnostic =
  | 'state-db-unavailable'
  | 'thread-not-found'
  | 'rollout-path-missing'
  | 'rollout-outside-codex-root'
  | 'rollout-unavailable'
  | 'token-count-event-not-found'
  | 'invalid-json-lines-skipped'
  | 'invalid-token-count-event';

export interface CodexContextPressureResult {
  schemaVersion: 'hooks.codex-context-pressure/v1';
  availability: CodexContextAvailability;
  source: 'codex-rollout-token-count';
  threadRef: string | null;
  rolloutRef: string | null;
  observedAt: string;
  tokenEventAt: string | null;
  freshness: CodexContextFreshness;
  ageMs: number | null;
  contextTokens: number | null;
  modelContextWindow: number | null;
  remainingTokens: number | null;
  percentUsed: number | null;
  thresholdMode: CodexContextThresholdMode | null;
  softThresholdTokens: number | null;
  hardThresholdTokens: number | null;
  pressure: CodexContextPressure;
  compactionSignal: CodexContextCompactionSignal;
  checkpointRequired: boolean;
  action: CodexContextAction;
  diagnostics: CodexContextDiagnostic[];
}

export interface ProbeCodexContextPressureInput {
  codexRoot?: string;
  stateDb?: string;
  threadId?: string | null;
  softThresholdTokens?: number;
  hardThresholdTokens?: number;
  maxTailBytes?: number;
  staleAfterMs?: number;
  now?: Date;
}

export interface CodexContextPressureCliOptions {
  codexRoot: string;
  stateDb: string;
  threadId: string | null;
  softThresholdTokens: number;
  hardThresholdTokens: number;
  maxTailBytes: number;
  staleAfterMs: number;
}

interface StateThreadRow {
  id: unknown;
  rollout_path: unknown;
}

interface TokenCountObservation {
  contextTokens: number;
  modelContextWindow: number;
  timestamp: string | null;
}

function digestRef(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`;
}

function positiveInteger(
  value: number,
  field: string
): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function validateThresholds(
  softThresholdTokens: number,
  hardThresholdTokens: number
): void {
  positiveInteger(softThresholdTokens, 'soft threshold');
  positiveInteger(hardThresholdTokens, 'hard threshold');
  if (hardThresholdTokens <= softThresholdTokens) {
    throw new Error('hard threshold must be greater than soft threshold');
  }
}

function unavailableResult(input: {
  now: Date;
  threadId: string | null;
  rolloutPath: string | null;
  diagnostics: CodexContextDiagnostic[];
}): CodexContextPressureResult {
  return {
    schemaVersion: 'hooks.codex-context-pressure/v1',
    availability: 'unavailable',
    source: 'codex-rollout-token-count',
    threadRef: input.threadId ? digestRef(input.threadId) : null,
    rolloutRef: input.rolloutPath ? digestRef(input.rolloutPath) : null,
    observedAt: input.now.toISOString(),
    tokenEventAt: null,
    freshness: 'unknown',
    ageMs: null,
    contextTokens: null,
    modelContextWindow: null,
    remainingTokens: null,
    percentUsed: null,
    thresholdMode: null,
    softThresholdTokens: null,
    hardThresholdTokens: null,
    pressure: 'unknown',
    compactionSignal: 'none',
    checkpointRequired: false,
    action: 'inspect',
    diagnostics: [...new Set(input.diagnostics)]
  };
}

function resolveThreadRow(
  stateDb: string,
  requestedThreadId: string | null
): StateThreadRow | null {
  const db = new DatabaseSync(stateDb, { readOnly: true });
  try {
    if (requestedThreadId) {
      return db.prepare(
        'select id, rollout_path from threads ' +
        'where id = ? and rollout_path is not null limit 1'
      ).get(requestedThreadId) as StateThreadRow | undefined ?? null;
    }
    return db.prepare(
      'select id, rollout_path from threads ' +
      'where rollout_path is not null ' +
      'order by updated_at desc limit 1'
    ).get() as StateThreadRow | undefined ?? null;
  } finally {
    db.close();
  }
}

async function trustedRolloutPath(
  codexRoot: string,
  rolloutPath: string
): Promise<
  | { status: 'trusted'; path: string }
  | { status: 'outside' }
  | { status: 'unavailable' }
> {
  const absoluteCodexRoot = path.resolve(codexRoot);
  const absoluteRollout = path.resolve(rolloutPath);
  const lexicalAllowed =
    isCodexPathInside(path.join(absoluteCodexRoot, 'sessions'), absoluteRollout) ||
    isCodexPathInside(
      path.join(absoluteCodexRoot, 'archived_sessions'),
      absoluteRollout
    );
  if (!lexicalAllowed) return { status: 'outside' };
  let realRoot: string;
  let realRollout: string;
  try {
    [realRoot, realRollout] = await Promise.all([
      fs.realpath(absoluteCodexRoot),
      fs.realpath(absoluteRollout)
    ]);
  } catch {
    return { status: 'unavailable' };
  }
  const realAllowed =
    isCodexPathInside(path.join(realRoot, 'sessions'), realRollout) ||
    isCodexPathInside(path.join(realRoot, 'archived_sessions'), realRollout);
  return realAllowed
    ? { status: 'trusted', path: realRollout }
    : { status: 'outside' };
}

async function readTailLines(
  filePath: string,
  maxTailBytes: number
): Promise<string[]> {
  const stat = await fs.stat(filePath);
  const start = Math.max(0, stat.size - maxTailBytes);
  const length = stat.size - start;
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    return text.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  } finally {
    await handle.close();
  }
}

function safeNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

function safePositiveInteger(value: unknown): number | null {
  const parsed = safeNonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function parseTokenCountObservations(lines: string[]): {
  observations: TokenCountObservation[];
  diagnostics: CodexContextDiagnostic[];
} {
  const observations: TokenCountObservation[] = [];
  const diagnostics: CodexContextDiagnostic[] = [];
  for (const line of lines) {
    let root: Record<string, unknown>;
    try {
      root = JSON.parse(line) as Record<string, unknown>;
    } catch {
      diagnostics.push('invalid-json-lines-skipped');
      continue;
    }
    const payload = root.payload && typeof root.payload === 'object'
      ? root.payload as Record<string, unknown>
      : null;
    if (
      root.type !== 'event_msg' ||
      payload?.type !== 'token_count'
    ) {
      continue;
    }
    const info = payload.info && typeof payload.info === 'object'
      ? payload.info as Record<string, unknown>
      : null;
    const usage = info?.last_token_usage &&
      typeof info.last_token_usage === 'object'
      ? info.last_token_usage as Record<string, unknown>
      : null;
    const contextTokens = safeNonNegativeInteger(usage?.input_tokens);
    const modelContextWindow = safePositiveInteger(
      payload.model_context_window
    ) ?? safePositiveInteger(info?.model_context_window);
    if (contextTokens === null || modelContextWindow === null) {
      diagnostics.push('invalid-token-count-event');
      continue;
    }
    const timestamp = typeof root.timestamp === 'string' &&
      Number.isFinite(Date.parse(root.timestamp))
      ? new Date(root.timestamp).toISOString()
      : null;
    observations.push({
      contextTokens,
      modelContextWindow,
      timestamp
    });
  }
  return {
    observations,
    diagnostics: [...new Set(diagnostics)]
  };
}

function effectiveThresholds(
  modelContextWindow: number,
  requestedSoft: number,
  requestedHard: number
): {
  mode: CodexContextThresholdMode;
  soft: number;
  hard: number;
} {
  if (modelContextWindow >= requestedHard) {
    return {
      mode: 'absolute',
      soft: requestedSoft,
      hard: requestedHard
    };
  }
  const soft = Math.max(1, Math.floor(modelContextWindow * 0.85));
  const hard = Math.max(soft + 1, Math.floor(modelContextWindow * 0.93));
  return {
    mode: 'scaled',
    soft,
    hard: Math.min(modelContextWindow, hard)
  };
}

function compactionSignal(
  observations: TokenCountObservation[],
  softThresholdTokens: number
): CodexContextCompactionSignal {
  const current = observations.at(-1);
  const previous = observations.at(-2);
  if (!current || !previous) return 'none';
  const drop = previous.contextTokens - current.contextTokens;
  const materialDrop = Math.max(
    8_192,
    Math.floor(previous.contextTokens * 0.2)
  );
  return previous.contextTokens >= softThresholdTokens &&
    current.contextTokens <= Math.floor(previous.contextTokens * 0.75) &&
    drop >= materialDrop
    ? 'heuristic-token-drop'
    : 'none';
}

function pressureFor(
  contextTokens: number,
  softThresholdTokens: number,
  hardThresholdTokens: number
): Exclude<CodexContextPressure, 'unknown'> {
  if (contextTokens >= hardThresholdTokens) return 'hard';
  if (contextTokens >= softThresholdTokens) return 'soft';
  return 'normal';
}

function actionFor(
  pressure: Exclude<CodexContextPressure, 'unknown'>,
  compaction: CodexContextCompactionSignal
): {
  action: Exclude<CodexContextAction, 'inspect'>;
  checkpointRequired: boolean;
} {
  if (pressure === 'hard') {
    return {
      action: 'rotate-context-and-checkpoint',
      checkpointRequired: true
    };
  }
  if (pressure === 'soft') {
    return {
      action: 'update-context',
      checkpointRequired: true
    };
  }
  if (compaction !== 'none') {
    return {
      action: 'reconcile-after-compaction',
      checkpointRequired: true
    };
  }
  return {
    action: 'continue',
    checkpointRequired: false
  };
}

export async function probeCodexContextPressure(
  input: ProbeCodexContextPressureInput = {}
): Promise<CodexContextPressureResult> {
  const now = input.now ?? new Date();
  const codexRoot = path.resolve(
    input.codexRoot ?? path.join(os.homedir(), '.codex')
  );
  const stateDb = path.resolve(
    input.stateDb ?? path.join(codexRoot, 'state_5.sqlite')
  );
  const requestedThreadId = input.threadId ?? null;
  const softThresholdTokens = input.softThresholdTokens ??
    DEFAULT_CODEX_CONTEXT_SOFT_THRESHOLD_TOKENS;
  const hardThresholdTokens = input.hardThresholdTokens ??
    DEFAULT_CODEX_CONTEXT_HARD_THRESHOLD_TOKENS;
  const maxTailBytes = positiveInteger(
    input.maxTailBytes ?? DEFAULT_CODEX_CONTEXT_MAX_TAIL_BYTES,
    'max tail bytes'
  );
  const staleAfterMs = positiveInteger(
    input.staleAfterMs ?? DEFAULT_CODEX_CONTEXT_STALE_AFTER_MS,
    'stale after milliseconds'
  );
  validateThresholds(softThresholdTokens, hardThresholdTokens);
  if (
    requestedThreadId !== null &&
    !isCodexThreadId(requestedThreadId)
  ) {
    throw new Error('invalid Codex thread id');
  }

  let row: StateThreadRow | null;
  try {
    row = resolveThreadRow(stateDb, requestedThreadId);
  } catch {
    return unavailableResult({
      now,
      threadId: requestedThreadId,
      rolloutPath: null,
      diagnostics: ['state-db-unavailable']
    });
  }
  if (!row) {
    return unavailableResult({
      now,
      threadId: requestedThreadId,
      rolloutPath: null,
      diagnostics: ['thread-not-found']
    });
  }

  const threadId = typeof row.id === 'string' ? row.id : requestedThreadId;
  const rawRolloutPath = typeof row.rollout_path === 'string' &&
    row.rollout_path.trim().length > 0
    ? row.rollout_path
    : null;
  if (!rawRolloutPath) {
    return unavailableResult({
      now,
      threadId,
      rolloutPath: null,
      diagnostics: ['rollout-path-missing']
    });
  }

  const rolloutAdmission = await trustedRolloutPath(
    codexRoot,
    rawRolloutPath
  );
  if (rolloutAdmission.status !== 'trusted') {
    return unavailableResult({
      now,
      threadId,
      rolloutPath: rawRolloutPath,
      diagnostics: [
        rolloutAdmission.status === 'outside'
          ? 'rollout-outside-codex-root'
          : 'rollout-unavailable'
      ]
    });
  }
  const rolloutPath = rolloutAdmission.path;

  let lines: string[];
  try {
    lines = await readTailLines(rolloutPath, maxTailBytes);
  } catch {
    return unavailableResult({
      now,
      threadId,
      rolloutPath,
      diagnostics: ['rollout-unavailable']
    });
  }
  const parsed = parseTokenCountObservations(lines);
  const current = parsed.observations.at(-1);
  if (!current) {
    return unavailableResult({
      now,
      threadId,
      rolloutPath,
      diagnostics: [
        ...parsed.diagnostics,
        'token-count-event-not-found'
      ]
    });
  }

  const thresholds = effectiveThresholds(
    current.modelContextWindow,
    softThresholdTokens,
    hardThresholdTokens
  );
  const pressure = pressureFor(
    current.contextTokens,
    thresholds.soft,
    thresholds.hard
  );
  const compacted = compactionSignal(
    parsed.observations,
    thresholds.soft
  );
  const decision = actionFor(pressure, compacted);
  const ageMs = current.timestamp
    ? Math.max(0, now.getTime() - Date.parse(current.timestamp))
    : null;

  return {
    schemaVersion: 'hooks.codex-context-pressure/v1',
    availability: 'available',
    source: 'codex-rollout-token-count',
    threadRef: threadId ? digestRef(threadId) : null,
    rolloutRef: digestRef(rolloutPath),
    observedAt: now.toISOString(),
    tokenEventAt: current.timestamp,
    freshness: ageMs === null
      ? 'unknown'
      : ageMs <= staleAfterMs
        ? 'fresh'
        : 'stale',
    ageMs,
    contextTokens: current.contextTokens,
    modelContextWindow: current.modelContextWindow,
    remainingTokens: Math.max(
      0,
      current.modelContextWindow - current.contextTokens
    ),
    percentUsed: Math.round(
      (current.contextTokens / current.modelContextWindow) * 10_000
    ) / 100,
    thresholdMode: thresholds.mode,
    softThresholdTokens: thresholds.soft,
    hardThresholdTokens: thresholds.hard,
    pressure,
    compactionSignal: compacted,
    checkpointRequired: decision.checkpointRequired,
    action: decision.action,
    diagnostics: parsed.diagnostics
  };
}

const CLI_OPTION_KINDS = {
  '--codex-root': 'value',
  '--state-db': 'value',
  '--thread-id': 'value',
  '--soft-tokens': 'value',
  '--hard-tokens': 'value',
  '--max-tail-bytes': 'value',
  '--stale-after-ms': 'value'
} as const;

type CliOption = keyof typeof CLI_OPTION_KINDS;

function parseCliInteger(
  values: Map<CliOption, string>,
  option: CliOption,
  fallback: number
): number {
  const raw = values.get(option);
  if (raw === undefined) return fallback;
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new Error(`invalid value for ${option}`);
  }
  return positiveInteger(Number(raw), option);
}

export function parseCodexContextPressureCliOptions(
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): CodexContextPressureCliOptions {
  const values = new Map<CliOption, string>();
  for (let index = 0; index < args.length;) {
    const option = args[index];
    if (!option.startsWith('--')) {
      throw new Error(`unexpected positional argument: ${option}`);
    }
    if (!Object.hasOwn(CLI_OPTION_KINDS, option)) {
      throw new Error(`unknown option: ${option}`);
    }
    const typedOption = option as CliOption;
    if (values.has(typedOption)) {
      throw new Error(`duplicate option: ${typedOption}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--') || !value.trim()) {
      throw new Error(`missing value for ${typedOption}`);
    }
    values.set(typedOption, value);
    index += 2;
  }

  const codexRoot = path.resolve(
    values.get('--codex-root') ?? path.join(os.homedir(), '.codex')
  );
  const stateDb = path.resolve(
    values.get('--state-db') ?? path.join(codexRoot, 'state_5.sqlite')
  );
  const threadId = values.get('--thread-id') ??
    (env.CODEX_THREAD_ID?.trim() || null);
  if (threadId !== null && !isCodexThreadId(threadId)) {
    throw new Error('invalid Codex thread id');
  }
  const softThresholdTokens = parseCliInteger(
    values,
    '--soft-tokens',
    DEFAULT_CODEX_CONTEXT_SOFT_THRESHOLD_TOKENS
  );
  const hardThresholdTokens = parseCliInteger(
    values,
    '--hard-tokens',
    DEFAULT_CODEX_CONTEXT_HARD_THRESHOLD_TOKENS
  );
  validateThresholds(softThresholdTokens, hardThresholdTokens);

  return {
    codexRoot,
    stateDb,
    threadId,
    softThresholdTokens,
    hardThresholdTokens,
    maxTailBytes: parseCliInteger(
      values,
      '--max-tail-bytes',
      DEFAULT_CODEX_CONTEXT_MAX_TAIL_BYTES
    ),
    staleAfterMs: parseCliInteger(
      values,
      '--stale-after-ms',
      DEFAULT_CODEX_CONTEXT_STALE_AFTER_MS
    )
  };
}
