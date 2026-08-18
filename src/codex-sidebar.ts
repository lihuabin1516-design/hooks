import { createHash } from 'node:crypto';
import { canonicalizeCcPanesTimezoneTimestamp } from './ccpanes-session-snapshot.js';
import { isCodexThreadId } from './codex-session-identity.js';
import {
  redactCodexSessionArtifactValue,
  sanitizeCodexSessionArtifactExcerpt
} from './codex-session-index.js';
import {
  boundCodexSessionPrivacyInput,
  CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH
} from './codex-session-privacy.js';
import { assertCodexSessionFederationProject } from './session-federation.js';

export type SidebarCandidateSource =
  | 'codex-app'
  | 'codex-cli'
  | 'unknown';
export type SidebarThreadSource =
  | 'user'
  | 'subagent'
  | 'automation'
  | 'unknown';
export type SidebarStorageState = 'active' | 'archived' | 'missing';
export type SidebarProjectRelation =
  | 'owned'
  | 'supporting'
  | 'mentioned'
  | 'ambient'
  | 'unrelated'
  | 'unknown';
export type SidebarActionReason =
  | 'explicitly selected active project CLI thread is readable but hidden'
  | 'live/recent project CLI thread is readable but hidden';

export interface SidebarCandidate {
  threadId: string;
  source: SidebarCandidateSource;
  threadSource: SidebarThreadSource;
  storageState: SidebarStorageState;
  projectRelation: SidebarProjectRelation;
  appReadable: boolean;
  listed: boolean;
  linkedLiveOrRecentLaunch: boolean;
  explicitlySelected: boolean;
  currentName: string | null;
  currentPinned: boolean | null;
  renameCustomized: boolean;
  originalTitle: string;
}

export interface SidebarAction {
  threadId: string;
  currentName: string | null;
  desiredName: string;
  currentPinned: boolean | null;
  desiredPinned: true;
  nameAdapter: 'app-server';
  pinAdapter: 'codex-app-host';
  reason: SidebarActionReason;
}

export interface SidebarPlan {
  schemaVersion: 'hooks.codex-sidebar-plan/v1';
  generatedAt: string;
  project: string;
  actions: SidebarAction[];
  digest: string;
}

export type SidebarPlanWithoutDigest = Omit<SidebarPlan, 'digest'>;

export type SidebarApplyStatus =
  | 'unchanged'
  | 'name-applied'
  | 'thread-missing'
  | 'conflict'
  | 'failed'
  | 'unknown';

export type SidebarApplyEntryError =
  | 'thread-missing'
  | 'before-state-conflict'
  | 'name-not-applied'
  | 'name-outcome-unknown';

export interface SidebarApplyEntry {
  threadId: string;
  previousName: string | null;
  previousPinned: boolean | null;
  desiredName: string;
  finalName: string | null;
  status: SidebarApplyStatus;
  error: SidebarApplyEntryError | null;
}

export interface SidebarPendingHostAction {
  planDigest: string;
  executionDigest: string;
  action: 'set-pinned';
  threadId: string;
  pinned: true;
  previousPinned: boolean | null;
}

export interface SidebarApplyResult {
  schemaVersion: 'hooks.codex-sidebar-apply/v1';
  generatedAt: string;
  planDigest: string;
  executionDigest: string;
  entries: SidebarApplyEntry[];
  pendingHostActions: SidebarPendingHostAction[];
}

export type SidebarApplyExecutionDigestInput = Pick<
  SidebarApplyResult,
  'schemaVersion' | 'generatedAt' | 'planDigest' | 'entries'
>;

export interface CodexAppSidebarSnapshotEntry {
  threadId: string;
  listed: boolean;
  readable: boolean;
  pinned: boolean | null;
}

export interface CodexAppSidebarSnapshot {
  schemaVersion: 'hooks.codex-app-sidebar-snapshot/v1';
  generatedAt: string;
  threads: CodexAppSidebarSnapshotEntry[];
}

export type SidebarHostReceiptStatus = 'applied' | 'failed';
export type SidebarHostReceiptError = 'host-write-failed';

export interface SidebarHostReceiptEntry {
  threadId: string;
  pinned: true;
  status: SidebarHostReceiptStatus;
  error: SidebarHostReceiptError | null;
}

export interface SidebarHostReceipt {
  schemaVersion: 'hooks.codex-sidebar-host-receipt/v1';
  generatedAt: string;
  planDigest: string;
  executionDigest: string;
  entries: SidebarHostReceiptEntry[];
}

export type SidebarReconciliationStatus =
  | 'reconciled'
  | 'digest-mismatch';
export type SidebarReconciliationEntryStatus =
  | 'digest-mismatch'
  | 'host-failed'
  | 'visible'
  | 'not-visible';

export interface SidebarReconciliationEntry {
  threadId: string;
  status: SidebarReconciliationEntryStatus;
}

export interface SidebarReconciliation {
  schemaVersion: 'hooks.codex-sidebar-reconciliation/v1';
  generatedAt: string;
  planDigest: string;
  receiptPlanDigest: string;
  receiptExecutionDigest: string;
  status: SidebarReconciliationStatus;
  entries: SidebarReconciliationEntry[];
}

export type SidebarRollbackNameAdapter =
  | 'app-server'
  | 'unsupported-clear-name-on-codex-0.147.0';

export interface SidebarRollbackAction {
  threadId: string;
  restoreName: string | null;
  restorePinned: boolean;
  nameAdapter: SidebarRollbackNameAdapter;
  pinAdapter: 'codex-app-host';
}

export interface SidebarRollbackPlan {
  schemaVersion: 'hooks.codex-sidebar-rollback-plan/v1';
  generatedAt: string;
  planDigest: string;
  sourceExecutionDigest: string;
  executable: boolean;
  actions: SidebarRollbackAction[];
  digest: string;
}

export type SidebarRollbackPlanDigestInput = Omit<
  SidebarRollbackPlan,
  'digest'
>;

export interface CreateSidebarPlanInput {
  project: string;
  generatedAt: string;
  candidates: SidebarCandidate[];
}

export interface ApplySidebarPlanInput {
  plan: SidebarPlan;
  confirmDigest: string;
  currentNames: ReadonlyMap<string, string | null>;
  setName: (threadId: string, name: string) => Promise<void>;
  readName: (threadId: string) => Promise<unknown>;
}

export interface CreateSidebarReconciliationInput {
  planDigest: string;
  receipt: SidebarHostReceipt;
  snapshot: CodexAppSidebarSnapshot;
  generatedAt?: string;
}

export interface CreateSidebarRollbackPlanInput {
  applyResult: SidebarApplyResult;
  receipt: SidebarHostReceipt;
  generatedAt?: string;
}

export const CODEX_SIDEBAR_ERROR_CODE = 'CODEX_SIDEBAR' as const;

export type CodexSidebarErrorReason =
  | 'invalid-shape'
  | 'unknown-field'
  | 'unsupported-schema'
  | 'invalid-enum'
  | 'unsafe-identity'
  | 'unsafe-project'
  | 'unsafe-timestamp'
  | 'unsafe-name'
  | 'capacity-exceeded'
  | 'duplicate-thread-id'
  | 'invalid-digest'
  | 'digest-mismatch'
  | 'inconsistent-result';

export class CodexSidebarError extends Error {
  readonly code = CODEX_SIDEBAR_ERROR_CODE;

  constructor(
    readonly field: string,
    readonly reason: CodexSidebarErrorReason
  ) {
    super(`${CODEX_SIDEBAR_ERROR_CODE}: ${field}: ${reason}`);
    this.name = 'CodexSidebarError';
  }
}

const PLAN_SCHEMA_VERSION = 'hooks.codex-sidebar-plan/v1' as const;
const APPLY_SCHEMA_VERSION = 'hooks.codex-sidebar-apply/v1' as const;
const APP_SIDEBAR_SNAPSHOT_SCHEMA_VERSION =
  'hooks.codex-app-sidebar-snapshot/v1' as const;
const HOST_RECEIPT_SCHEMA_VERSION =
  'hooks.codex-sidebar-host-receipt/v1' as const;
const RECONCILIATION_SCHEMA_VERSION =
  'hooks.codex-sidebar-reconciliation/v1' as const;
const ROLLBACK_PLAN_SCHEMA_VERSION =
  'hooks.codex-sidebar-rollback-plan/v1' as const;
const MAX_CANDIDATES = 512;
const MAX_ACTIONS = 512;
const MAX_NAME_CODE_POINTS = 120;
const DEFAULT_TITLE = 'Codex CLI thread';
const NAME_PREFIX = '[CC-Panes] ';
const EXPLICIT_REASON =
  'explicitly selected active project CLI thread is readable but hidden';
const LIVE_REASON =
  'live/recent project CLI thread is readable but hidden';

const CREATE_INPUT_FIELDS: ReadonlySet<string> = new Set([
  'project',
  'generatedAt',
  'candidates'
]);
const CANDIDATE_FIELDS: ReadonlySet<string> = new Set([
  'threadId',
  'source',
  'threadSource',
  'storageState',
  'projectRelation',
  'appReadable',
  'listed',
  'linkedLiveOrRecentLaunch',
  'explicitlySelected',
  'currentName',
  'currentPinned',
  'renameCustomized',
  'originalTitle'
]);
const PLAN_FIELDS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'generatedAt',
  'project',
  'actions',
  'digest'
]);
const ACTION_FIELDS: ReadonlySet<string> = new Set([
  'threadId',
  'currentName',
  'desiredName',
  'currentPinned',
  'desiredPinned',
  'nameAdapter',
  'pinAdapter',
  'reason'
]);
const APPLY_RESULT_FIELDS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'generatedAt',
  'planDigest',
  'executionDigest',
  'entries',
  'pendingHostActions'
]);
const APPLY_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'threadId',
  'previousName',
  'previousPinned',
  'desiredName',
  'finalName',
  'status',
  'error'
]);
const PENDING_HOST_ACTION_FIELDS: ReadonlySet<string> = new Set([
  'planDigest',
  'executionDigest',
  'action',
  'threadId',
  'pinned',
  'previousPinned'
]);
const APP_SIDEBAR_SNAPSHOT_FIELDS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'generatedAt',
  'threads'
]);
const APP_SIDEBAR_SNAPSHOT_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'threadId',
  'listed',
  'readable',
  'pinned'
]);
const HOST_RECEIPT_FIELDS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'generatedAt',
  'planDigest',
  'executionDigest',
  'entries'
]);
const HOST_RECEIPT_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'threadId',
  'pinned',
  'status',
  'error'
]);
const RECONCILIATION_INPUT_FIELDS: ReadonlySet<string> = new Set([
  'planDigest',
  'receipt',
  'snapshot',
  'generatedAt'
]);
const RECONCILIATION_FIELDS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'generatedAt',
  'planDigest',
  'receiptPlanDigest',
  'receiptExecutionDigest',
  'status',
  'entries'
]);
const RECONCILIATION_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'threadId',
  'status'
]);
const ROLLBACK_INPUT_FIELDS: ReadonlySet<string> = new Set([
  'applyResult',
  'receipt',
  'generatedAt'
]);
const ROLLBACK_PLAN_FIELDS: ReadonlySet<string> = new Set([
  'schemaVersion',
  'generatedAt',
  'planDigest',
  'sourceExecutionDigest',
  'executable',
  'actions',
  'digest'
]);
const ROLLBACK_ACTION_FIELDS: ReadonlySet<string> = new Set([
  'threadId',
  'restoreName',
  'restorePinned',
  'nameAdapter',
  'pinAdapter'
]);
const CANDIDATE_SOURCES: ReadonlySet<string> = new Set([
  'codex-app',
  'codex-cli',
  'unknown'
]);
const THREAD_SOURCES: ReadonlySet<string> = new Set([
  'user',
  'subagent',
  'automation',
  'unknown'
]);
const STORAGE_STATES: ReadonlySet<string> = new Set([
  'active',
  'archived',
  'missing'
]);
const PROJECT_RELATIONS: ReadonlySet<string> = new Set([
  'owned',
  'supporting',
  'mentioned',
  'ambient',
  'unrelated',
  'unknown'
]);
const ACTION_REASONS: ReadonlySet<string> = new Set([
  EXPLICIT_REASON,
  LIVE_REASON
]);
const NAME_ADAPTERS: ReadonlySet<string> = new Set(['app-server']);
const PIN_ADAPTERS: ReadonlySet<string> = new Set(['codex-app-host']);
const APPLY_STATUSES: ReadonlySet<string> = new Set([
  'unchanged',
  'name-applied',
  'thread-missing',
  'conflict',
  'failed',
  'unknown'
]);
const APPLY_ENTRY_ERRORS: ReadonlySet<string> = new Set([
  'thread-missing',
  'before-state-conflict',
  'name-not-applied',
  'name-outcome-unknown'
]);
const CONFIRMED_NAME_STATUSES: ReadonlySet<SidebarApplyStatus> = new Set([
  'unchanged',
  'name-applied'
]);
const HOST_RECEIPT_STATUSES: ReadonlySet<string> = new Set([
  'applied',
  'failed'
]);
const HOST_RECEIPT_ERRORS: ReadonlySet<string> = new Set([
  'host-write-failed'
]);
const RECONCILIATION_STATUSES: ReadonlySet<string> = new Set([
  'reconciled',
  'digest-mismatch'
]);
const RECONCILIATION_ENTRY_STATUSES: ReadonlySet<string> = new Set([
  'digest-mismatch',
  'host-failed',
  'visible',
  'not-visible'
]);
const ROLLBACK_NAME_ADAPTERS: ReadonlySet<string> = new Set([
  'app-server',
  'unsupported-clear-name-on-codex-0.147.0'
]);

function invalid(
  field: string,
  reason: CodexSidebarErrorReason
): never {
  throw new CodexSidebarError(field, reason);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(field, 'invalid-shape');
  }
  return value as Record<string, unknown>;
}

function assertKnownFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
  field: string
): void {
  if (Object.keys(value).some((key) => !fields.has(key))) {
    invalid(field, 'unknown-field');
  }
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return invalid(field, 'invalid-shape');
  return value;
}

function nullableBoolean(
  value: unknown,
  field: string
): boolean | null {
  if (value === null) return null;
  return requiredBoolean(value, field);
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string
): T {
  if (typeof value !== 'string' || !allowed.has(value)) {
    return invalid(field, 'invalid-enum');
  }
  return value as T;
}

function safeIdentity(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !isCodexThreadId(value)
  ) {
    return invalid(field, 'unsafe-identity');
  }
  return value;
}

function safeObservedName(
  value: unknown,
  field: string
): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return invalid(field, 'unsafe-name');
  const redacted = redactCodexSessionArtifactValue(value);
  if (
    redacted.value !== value ||
    redacted.changed ||
    value.length > CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH ||
    boundCodexSessionPrivacyInput(value).changed ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    return invalid(field, 'unsafe-name');
  }
  return value;
}

function safeWritableName(value: unknown, field: string): string {
  if (typeof value !== 'string') return invalid(field, 'unsafe-name');
  const redacted = redactCodexSessionArtifactValue(value);
  if (
    redacted.value !== value ||
    redacted.changed ||
    value.length === 0 ||
    value.trim().length === 0 ||
    value.length > CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH ||
    boundCodexSessionPrivacyInput(value).changed ||
    Array.from(value).length > MAX_NAME_CODE_POINTS ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    return invalid(field, 'unsafe-name');
  }
  return value;
}

function canonicalTimestamp(value: unknown, field: string): string {
  const canonical = canonicalizeCcPanesTimezoneTimestamp(value);
  if (!canonical) return invalid(field, 'unsafe-timestamp');
  return canonical;
}

function safeProject(value: unknown, field: string): string {
  if (typeof value !== 'string') return invalid(field, 'unsafe-project');
  try {
    return assertCodexSessionFederationProject(value);
  } catch {
    return invalid(field, 'unsafe-project');
  }
}

function safeDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    return invalid(field, 'invalid-digest');
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

function assertUniqueThreadIds(
  records: readonly { threadId: string }[],
  field: string
): void {
  const seen = new Set<string>();
  for (const item of records) {
    if (seen.has(item.threadId)) invalid(field, 'duplicate-thread-id');
    seen.add(item.threadId);
  }
}

function safeOriginalTitle(value: unknown, field: string): string {
  if (typeof value !== 'string') return invalid(field, 'invalid-shape');
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) return DEFAULT_TITLE;
  const redacted = redactCodexSessionArtifactValue(value);
  if (redacted.changed) return DEFAULT_TITLE;
  return sanitizeCodexSessionArtifactExcerpt(value) ?? DEFAULT_TITLE;
}

function desiredName(originalTitle: string): string {
  return Array.from(`${NAME_PREFIX}${originalTitle}`)
    .slice(0, MAX_NAME_CODE_POINTS)
    .join('');
}

function validateCandidate(
  value: unknown,
  index: number
): SidebarCandidate {
  const field = `candidates[${index}]`;
  const item = record(value, field);
  assertKnownFields(item, CANDIDATE_FIELDS, field);
  return {
    threadId: safeIdentity(item.threadId, `${field}.threadId`),
    source: requiredEnum<SidebarCandidateSource>(
      item.source,
      CANDIDATE_SOURCES,
      `${field}.source`
    ),
    threadSource: requiredEnum<SidebarThreadSource>(
      item.threadSource,
      THREAD_SOURCES,
      `${field}.threadSource`
    ),
    storageState: requiredEnum<SidebarStorageState>(
      item.storageState,
      STORAGE_STATES,
      `${field}.storageState`
    ),
    projectRelation: requiredEnum<SidebarProjectRelation>(
      item.projectRelation,
      PROJECT_RELATIONS,
      `${field}.projectRelation`
    ),
    appReadable: requiredBoolean(
      item.appReadable,
      `${field}.appReadable`
    ),
    listed: requiredBoolean(item.listed, `${field}.listed`),
    linkedLiveOrRecentLaunch: requiredBoolean(
      item.linkedLiveOrRecentLaunch,
      `${field}.linkedLiveOrRecentLaunch`
    ),
    explicitlySelected: requiredBoolean(
      item.explicitlySelected,
      `${field}.explicitlySelected`
    ),
    currentName: safeObservedName(item.currentName, `${field}.currentName`),
    currentPinned: nullableBoolean(
      item.currentPinned,
      `${field}.currentPinned`
    ),
    renameCustomized: requiredBoolean(
      item.renameCustomized,
      `${field}.renameCustomized`
    ),
    originalTitle: safeOriginalTitle(
      item.originalTitle,
      `${field}.originalTitle`
    )
  };
}

function isSelected(candidate: SidebarCandidate): boolean {
  return candidate.source === 'codex-cli' &&
    candidate.threadSource === 'user' &&
    candidate.storageState === 'active' &&
    (
      candidate.projectRelation === 'owned' ||
      candidate.projectRelation === 'supporting'
    ) &&
    candidate.appReadable &&
    !candidate.listed &&
    (
      candidate.linkedLiveOrRecentLaunch ||
      candidate.explicitlySelected
    );
}

function actionFor(candidate: SidebarCandidate): SidebarAction {
  return {
    threadId: candidate.threadId,
    currentName: candidate.currentName,
    desiredName: candidate.currentName !== null &&
      !candidate.renameCustomized
      ? candidate.currentName
      : desiredName(candidate.originalTitle),
    currentPinned: candidate.currentPinned,
    desiredPinned: true,
    nameAdapter: 'app-server',
    pinAdapter: 'codex-app-host',
    reason: candidate.explicitlySelected ? EXPLICIT_REASON : LIVE_REASON
  };
}

function validateAction(value: unknown, index: number): SidebarAction {
  const field = `actions[${index}]`;
  const action = record(value, field);
  assertKnownFields(action, ACTION_FIELDS, field);
  if (action.desiredPinned !== true) {
    invalid(`${field}.desiredPinned`, 'invalid-enum');
  }
  const currentName = safeObservedName(
    action.currentName,
    `${field}.currentName`
  );
  const desiredName = currentName !== null && action.desiredName === currentName
    ? currentName
    : safeWritableName(action.desiredName, `${field}.desiredName`);
  return {
    threadId: safeIdentity(action.threadId, `${field}.threadId`),
    currentName,
    desiredName,
    currentPinned: nullableBoolean(
      action.currentPinned,
      `${field}.currentPinned`
    ),
    desiredPinned: true,
    nameAdapter: requiredEnum<'app-server'>(
      action.nameAdapter,
      NAME_ADAPTERS,
      `${field}.nameAdapter`
    ),
    pinAdapter: requiredEnum<'codex-app-host'>(
      action.pinAdapter,
      PIN_ADAPTERS,
      `${field}.pinAdapter`
    ),
    reason: requiredEnum<SidebarActionReason>(
      action.reason,
      ACTION_REASONS,
      `${field}.reason`
    )
  };
}

function normalizePlanCore(value: unknown): SidebarPlanWithoutDigest {
  const plan = record(value, 'root');
  assertKnownFields(plan, PLAN_FIELDS, 'root');
  if (plan.schemaVersion !== PLAN_SCHEMA_VERSION) {
    invalid('schemaVersion', 'unsupported-schema');
  }
  if (!Array.isArray(plan.actions)) invalid('actions', 'invalid-shape');
  if (plan.actions.length > MAX_ACTIONS) {
    invalid('actions', 'capacity-exceeded');
  }
  const actions = plan.actions
    .map(validateAction);
  assertUniqueThreadIds(actions, 'actions');
  actions
    .sort((left, right) => compareText(left.threadId, right.threadId));
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    generatedAt: canonicalTimestamp(plan.generatedAt, 'generatedAt'),
    project: safeProject(plan.project, 'project'),
    actions
  };
}

function digestNormalizedPlan(plan: SidebarPlanWithoutDigest): string {
  const canonical = canonicalize({
    schemaVersion: plan.schemaVersion,
    generatedAt: plan.generatedAt,
    project: plan.project,
    actions: [...plan.actions].sort((left, right) =>
      compareText(left.threadId, right.threadId)
    )
  });
  return createHash('sha256')
    .update(JSON.stringify(canonical), 'utf8')
    .digest('hex');
}

export function digestSidebarPlan(
  plan: SidebarPlanWithoutDigest | SidebarPlan
): string {
  return digestNormalizedPlan(normalizePlanCore(plan));
}

export function createSidebarPlan(
  input: CreateSidebarPlanInput
): SidebarPlan {
  const rawInput = record(input, 'input');
  assertKnownFields(rawInput, CREATE_INPUT_FIELDS, 'input');
  if (!Array.isArray(rawInput.candidates)) {
    invalid('candidates', 'invalid-shape');
  }
  if (rawInput.candidates.length > MAX_CANDIDATES) {
    invalid('candidates', 'capacity-exceeded');
  }
  const candidates = rawInput.candidates.map(validateCandidate);
  assertUniqueThreadIds(candidates, 'candidates');
  const actions = candidates
    .filter(isSelected)
    .map(actionFor)
    .sort((left, right) => compareText(left.threadId, right.threadId));
  const withoutDigest: SidebarPlanWithoutDigest = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    generatedAt: canonicalTimestamp(
      rawInput.generatedAt,
      'generatedAt'
    ),
    project: safeProject(rawInput.project, 'project'),
    actions
  };
  return {
    ...withoutDigest,
    digest: digestNormalizedPlan(withoutDigest)
  };
}

export function validateSidebarPlan(value: unknown): SidebarPlan {
  const rawPlan = record(value, 'root');
  assertKnownFields(rawPlan, PLAN_FIELDS, 'root');
  const digest = safeDigest(rawPlan.digest, 'digest');
  const normalized = normalizePlanCore(rawPlan);
  const expectedDigest = digestNormalizedPlan(normalized);
  if (digest !== expectedDigest) {
    invalid('digest', 'digest-mismatch');
  }
  return {
    ...normalized,
    digest
  };
}

function expectedApplyError(
  status: SidebarApplyStatus
): SidebarApplyEntryError | null {
  switch (status) {
    case 'unchanged':
    case 'name-applied':
      return null;
    case 'thread-missing':
      return 'thread-missing';
    case 'conflict':
      return 'before-state-conflict';
    case 'failed':
      return 'name-not-applied';
    case 'unknown':
      return 'name-outcome-unknown';
  }
}

function safeApplyDesiredName(
  value: unknown,
  previousName: string | null,
  status: SidebarApplyStatus,
  field: string
): string {
  if (previousName !== null && value === previousName) return previousName;
  if (status === 'thread-missing' || status === 'conflict') {
    const observed = safeObservedName(value, field);
    if (observed === null) return invalid(field, 'unsafe-name');
    return observed;
  }
  return safeWritableName(value, field);
}

function assertApplyEntryInvariant(
  entry: SidebarApplyEntry,
  field: string
): void {
  const {
    previousName,
    desiredName,
    finalName,
    status
  } = entry;
  switch (status) {
    case 'unchanged':
      if (previousName !== desiredName || finalName !== desiredName) {
        invalid(field, 'inconsistent-result');
      }
      return;
    case 'name-applied':
      if (previousName === desiredName || finalName !== desiredName) {
        invalid(field, 'inconsistent-result');
      }
      return;
    case 'thread-missing':
      if (previousName !== null || finalName !== null) {
        invalid(field, 'inconsistent-result');
      }
      return;
    case 'conflict':
    case 'failed':
      if (previousName === desiredName || finalName !== previousName) {
        invalid(field, 'inconsistent-result');
      }
      return;
    case 'unknown':
      if (
        previousName === desiredName ||
        finalName === desiredName ||
        (finalName !== null && finalName === previousName)
      ) {
        invalid(field, 'inconsistent-result');
      }
  }
}

function validateApplyEntry(
  value: unknown,
  index: number
): SidebarApplyEntry {
  const field = `entries[${index}]`;
  const entry = record(value, field);
  assertKnownFields(entry, APPLY_ENTRY_FIELDS, field);
  const status = requiredEnum<SidebarApplyStatus>(
    entry.status,
    APPLY_STATUSES,
    `${field}.status`
  );
  const previousName = safeObservedName(
    entry.previousName,
    `${field}.previousName`
  );
  const error = entry.error === null
    ? null
    : requiredEnum<SidebarApplyEntryError>(
        entry.error,
        APPLY_ENTRY_ERRORS,
        `${field}.error`
      );
  if (error !== expectedApplyError(status)) {
    invalid(`${field}.error`, 'invalid-enum');
  }
  const normalized: SidebarApplyEntry = {
    threadId: safeIdentity(entry.threadId, `${field}.threadId`),
    previousName,
    previousPinned: nullableBoolean(
      entry.previousPinned,
      `${field}.previousPinned`
    ),
    desiredName: safeApplyDesiredName(
      entry.desiredName,
      previousName,
      status,
      `${field}.desiredName`
    ),
    finalName: safeObservedName(entry.finalName, `${field}.finalName`),
    status,
    error
  };
  assertApplyEntryInvariant(normalized, field);
  return normalized;
}

function normalizeApplyExecutionDigestInput(
  value: unknown
): SidebarApplyExecutionDigestInput {
  const result = record(value, 'root');
  assertKnownFields(result, APPLY_RESULT_FIELDS, 'root');
  if (result.schemaVersion !== APPLY_SCHEMA_VERSION) {
    invalid('schemaVersion', 'unsupported-schema');
  }
  if (!Array.isArray(result.entries)) invalid('entries', 'invalid-shape');
  if (result.entries.length > MAX_ACTIONS) {
    invalid('entries', 'capacity-exceeded');
  }
  const entries = result.entries.map(validateApplyEntry);
  assertUniqueThreadIds(entries, 'entries');
  return {
    schemaVersion: APPLY_SCHEMA_VERSION,
    generatedAt: canonicalTimestamp(result.generatedAt, 'generatedAt'),
    planDigest: safeDigest(result.planDigest, 'planDigest'),
    entries
  };
}

function digestNormalizedApplyExecution(
  input: SidebarApplyExecutionDigestInput
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(input)), 'utf8')
    .digest('hex');
}

export function digestSidebarApplyExecution(
  input: SidebarApplyExecutionDigestInput | SidebarApplyResult
): string {
  return digestNormalizedApplyExecution(
    normalizeApplyExecutionDigestInput(input)
  );
}

function validatePendingHostAction(
  value: unknown,
  index: number
): SidebarPendingHostAction {
  const field = `pendingHostActions[${index}]`;
  const action = record(value, field);
  assertKnownFields(action, PENDING_HOST_ACTION_FIELDS, field);
  if (action.action !== 'set-pinned') {
    invalid(`${field}.action`, 'invalid-enum');
  }
  if (action.pinned !== true) {
    invalid(`${field}.pinned`, 'invalid-enum');
  }
  return {
    planDigest: safeDigest(action.planDigest, `${field}.planDigest`),
    executionDigest: safeDigest(
      action.executionDigest,
      `${field}.executionDigest`
    ),
    action: 'set-pinned',
    threadId: safeIdentity(action.threadId, `${field}.threadId`),
    pinned: true,
    previousPinned: nullableBoolean(
      action.previousPinned,
      `${field}.previousPinned`
    )
  };
}

export function validateSidebarApplyResult(
  value: unknown
): SidebarApplyResult {
  const result = record(value, 'root');
  const normalized = normalizeApplyExecutionDigestInput(result);
  const executionDigest = safeDigest(
    result.executionDigest,
    'executionDigest'
  );
  const expectedExecutionDigest =
    digestNormalizedApplyExecution(normalized);
  if (executionDigest !== expectedExecutionDigest) {
    invalid('executionDigest', 'digest-mismatch');
  }
  if (!Array.isArray(result.pendingHostActions)) {
    invalid('pendingHostActions', 'invalid-shape');
  }
  if (result.pendingHostActions.length > MAX_ACTIONS) {
    invalid('pendingHostActions', 'capacity-exceeded');
  }

  const pendingHostActions = result.pendingHostActions
    .map(validatePendingHostAction);
  assertUniqueThreadIds(pendingHostActions, 'pendingHostActions');

  const confirmedEntries = normalized.entries
    .filter((entry) => CONFIRMED_NAME_STATUSES.has(entry.status));
  if (pendingHostActions.length !== confirmedEntries.length) {
    invalid('pendingHostActions', 'inconsistent-result');
  }
  for (let index = 0; index < pendingHostActions.length; index += 1) {
    const pending = pendingHostActions[index]!;
    const entry = confirmedEntries[index]!;
    if (pending.planDigest !== normalized.planDigest) {
      invalid(`pendingHostActions[${index}].planDigest`, 'digest-mismatch');
    }
    if (pending.executionDigest !== executionDigest) {
      invalid(
        `pendingHostActions[${index}].executionDigest`,
        'digest-mismatch'
      );
    }
    if (
      pending.threadId !== entry.threadId ||
      entry.previousPinned !== pending.previousPinned
    ) {
      invalid(`pendingHostActions[${index}]`, 'inconsistent-result');
    }
  }

  return {
    ...normalized,
    executionDigest,
    pendingHostActions
  };
}

function generatedTimestamp(value: unknown, field: string): string {
  return canonicalTimestamp(
    value === undefined ? new Date().toISOString() : value,
    field
  );
}

function validateCodexAppSidebarSnapshotEntry(
  value: unknown,
  index: number
): CodexAppSidebarSnapshotEntry {
  const field = `threads[${index}]`;
  const thread = record(value, field);
  assertKnownFields(thread, APP_SIDEBAR_SNAPSHOT_ENTRY_FIELDS, field);
  return {
    threadId: safeIdentity(thread.threadId, `${field}.threadId`),
    listed: requiredBoolean(thread.listed, `${field}.listed`),
    readable: requiredBoolean(thread.readable, `${field}.readable`),
    pinned: nullableBoolean(thread.pinned, `${field}.pinned`)
  };
}

export function validateCodexAppSidebarSnapshot(
  value: unknown
): CodexAppSidebarSnapshot {
  const snapshot = record(value, 'root');
  assertKnownFields(snapshot, APP_SIDEBAR_SNAPSHOT_FIELDS, 'root');
  if (snapshot.schemaVersion !== APP_SIDEBAR_SNAPSHOT_SCHEMA_VERSION) {
    invalid('schemaVersion', 'unsupported-schema');
  }
  if (!Array.isArray(snapshot.threads)) {
    invalid('threads', 'invalid-shape');
  }
  if (snapshot.threads.length > MAX_ACTIONS) {
    invalid('threads', 'capacity-exceeded');
  }
  const threads = snapshot.threads.map(validateCodexAppSidebarSnapshotEntry);
  assertUniqueThreadIds(threads, 'threads');
  return {
    schemaVersion: APP_SIDEBAR_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: canonicalTimestamp(snapshot.generatedAt, 'generatedAt'),
    threads
  };
}

function expectedHostReceiptError(
  status: SidebarHostReceiptStatus
): SidebarHostReceiptError | null {
  return status === 'applied' ? null : 'host-write-failed';
}

function validateSidebarHostReceiptEntry(
  value: unknown,
  index: number
): SidebarHostReceiptEntry {
  const field = `entries[${index}]`;
  const entry = record(value, field);
  assertKnownFields(entry, HOST_RECEIPT_ENTRY_FIELDS, field);
  if (entry.pinned !== true) {
    invalid(`${field}.pinned`, 'invalid-enum');
  }
  const status = requiredEnum<SidebarHostReceiptStatus>(
    entry.status,
    HOST_RECEIPT_STATUSES,
    `${field}.status`
  );
  const error = entry.error === null
    ? null
    : requiredEnum<SidebarHostReceiptError>(
        entry.error,
        HOST_RECEIPT_ERRORS,
        `${field}.error`
      );
  if (error !== expectedHostReceiptError(status)) {
    invalid(`${field}.error`, 'invalid-enum');
  }
  return {
    threadId: safeIdentity(entry.threadId, `${field}.threadId`),
    pinned: true,
    status,
    error
  };
}

export function validateSidebarHostReceipt(
  value: unknown
): SidebarHostReceipt {
  const receipt = record(value, 'root');
  assertKnownFields(receipt, HOST_RECEIPT_FIELDS, 'root');
  if (receipt.schemaVersion !== HOST_RECEIPT_SCHEMA_VERSION) {
    invalid('schemaVersion', 'unsupported-schema');
  }
  if (!Array.isArray(receipt.entries)) {
    invalid('entries', 'invalid-shape');
  }
  if (receipt.entries.length > MAX_ACTIONS) {
    invalid('entries', 'capacity-exceeded');
  }
  const entries = receipt.entries.map(validateSidebarHostReceiptEntry);
  assertUniqueThreadIds(entries, 'entries');
  return {
    schemaVersion: HOST_RECEIPT_SCHEMA_VERSION,
    generatedAt: canonicalTimestamp(receipt.generatedAt, 'generatedAt'),
    planDigest: safeDigest(receipt.planDigest, 'planDigest'),
    executionDigest: safeDigest(
      receipt.executionDigest,
      'executionDigest'
    ),
    entries
  };
}

function validateSidebarReconciliationEntry(
  value: unknown,
  index: number
): SidebarReconciliationEntry {
  const field = `entries[${index}]`;
  const entry = record(value, field);
  assertKnownFields(entry, RECONCILIATION_ENTRY_FIELDS, field);
  return {
    threadId: safeIdentity(entry.threadId, `${field}.threadId`),
    status: requiredEnum<SidebarReconciliationEntryStatus>(
      entry.status,
      RECONCILIATION_ENTRY_STATUSES,
      `${field}.status`
    )
  };
}

export function validateSidebarReconciliation(
  value: unknown
): SidebarReconciliation {
  const result = record(value, 'root');
  assertKnownFields(result, RECONCILIATION_FIELDS, 'root');
  if (result.schemaVersion !== RECONCILIATION_SCHEMA_VERSION) {
    invalid('schemaVersion', 'unsupported-schema');
  }
  if (!Array.isArray(result.entries)) invalid('entries', 'invalid-shape');
  if (result.entries.length > MAX_ACTIONS) {
    invalid('entries', 'capacity-exceeded');
  }
  const planDigest = safeDigest(result.planDigest, 'planDigest');
  const receiptPlanDigest = safeDigest(
    result.receiptPlanDigest,
    'receiptPlanDigest'
  );
  const receiptExecutionDigest = safeDigest(
    result.receiptExecutionDigest,
    'receiptExecutionDigest'
  );
  const status = requiredEnum<SidebarReconciliationStatus>(
    result.status,
    RECONCILIATION_STATUSES,
    'status'
  );
  const entries = result.entries.map(validateSidebarReconciliationEntry);
  assertUniqueThreadIds(entries, 'entries');

  const digestMatches = planDigest === receiptPlanDigest;
  if (
    (digestMatches && status !== 'reconciled') ||
    (!digestMatches && status !== 'digest-mismatch')
  ) {
    invalid('status', 'inconsistent-result');
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (
      (digestMatches && entry.status === 'digest-mismatch') ||
      (!digestMatches && entry.status !== 'digest-mismatch')
    ) {
      invalid(`entries[${index}].status`, 'inconsistent-result');
    }
  }

  return {
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    generatedAt: canonicalTimestamp(result.generatedAt, 'generatedAt'),
    planDigest,
    receiptPlanDigest,
    receiptExecutionDigest,
    status,
    entries
  };
}

export function createSidebarReconciliation(
  input: CreateSidebarReconciliationInput
): SidebarReconciliation {
  const rawInput = record(input, 'input');
  assertKnownFields(rawInput, RECONCILIATION_INPUT_FIELDS, 'input');
  const planDigest = safeDigest(rawInput.planDigest, 'planDigest');
  const receipt = validateSidebarHostReceipt(rawInput.receipt);
  const snapshot = validateCodexAppSidebarSnapshot(rawInput.snapshot);
  const digestMatches = planDigest === receipt.planDigest;
  const freshSnapshot =
    Date.parse(snapshot.generatedAt) >= Date.parse(receipt.generatedAt);
  const snapshotByThreadId = new Map(
    snapshot.threads.map((thread) => [thread.threadId, thread])
  );
  const entries: SidebarReconciliationEntry[] = receipt.entries.map((entry) => {
    if (!digestMatches) {
      return { threadId: entry.threadId, status: 'digest-mismatch' };
    }
    if (entry.status === 'failed') {
      return { threadId: entry.threadId, status: 'host-failed' };
    }
    const thread = snapshotByThreadId.get(entry.threadId);
    return {
      threadId: entry.threadId,
      status: freshSnapshot &&
        thread?.listed === true &&
        thread.readable === true &&
        thread.pinned === true
        ? 'visible'
        : 'not-visible'
    };
  });

  return validateSidebarReconciliation({
    schemaVersion: RECONCILIATION_SCHEMA_VERSION,
    generatedAt: generatedTimestamp(rawInput.generatedAt, 'generatedAt'),
    planDigest,
    receiptPlanDigest: receipt.planDigest,
    receiptExecutionDigest: receipt.executionDigest,
    status: digestMatches ? 'reconciled' : 'digest-mismatch',
    entries
  });
}

function safeRollbackName(
  value: unknown,
  field: string
): string | null {
  if (value === null) return null;
  if (value === '') return invalid(field, 'unsafe-name');
  const name = safeObservedName(value, field);
  if (name === null) return invalid(field, 'unsafe-name');
  return name;
}

function validateSidebarRollbackAction(
  value: unknown,
  index: number
): SidebarRollbackAction {
  const field = `actions[${index}]`;
  const action = record(value, field);
  assertKnownFields(action, ROLLBACK_ACTION_FIELDS, field);
  const restoreName = safeRollbackName(
    action.restoreName,
    `${field}.restoreName`
  );
  const nameAdapter = requiredEnum<SidebarRollbackNameAdapter>(
    action.nameAdapter,
    ROLLBACK_NAME_ADAPTERS,
    `${field}.nameAdapter`
  );
  if (
    (restoreName === null &&
      nameAdapter !== 'unsupported-clear-name-on-codex-0.147.0') ||
    (restoreName !== null && nameAdapter !== 'app-server')
  ) {
    invalid(`${field}.nameAdapter`, 'inconsistent-result');
  }
  return {
    threadId: safeIdentity(action.threadId, `${field}.threadId`),
    restoreName,
    restorePinned: requiredBoolean(
      action.restorePinned,
      `${field}.restorePinned`
    ),
    nameAdapter,
    pinAdapter: requiredEnum<'codex-app-host'>(
      action.pinAdapter,
      PIN_ADAPTERS,
      `${field}.pinAdapter`
    )
  };
}

function normalizeSidebarRollbackPlanDigestInput(
  value: unknown
): SidebarRollbackPlanDigestInput {
  const plan = record(value, 'root');
  assertKnownFields(plan, ROLLBACK_PLAN_FIELDS, 'root');
  if (plan.schemaVersion !== ROLLBACK_PLAN_SCHEMA_VERSION) {
    invalid('schemaVersion', 'unsupported-schema');
  }
  if (!Array.isArray(plan.actions)) invalid('actions', 'invalid-shape');
  if (plan.actions.length > MAX_ACTIONS) {
    invalid('actions', 'capacity-exceeded');
  }
  const executable = requiredBoolean(plan.executable, 'executable');
  const actions = plan.actions.map(validateSidebarRollbackAction);
  assertUniqueThreadIds(actions, 'actions');
  const expectedExecutable = actions.every(
    (action) => action.nameAdapter === 'app-server'
  );
  if (executable !== expectedExecutable) {
    invalid('executable', 'inconsistent-result');
  }
  return {
    schemaVersion: ROLLBACK_PLAN_SCHEMA_VERSION,
    generatedAt: canonicalTimestamp(plan.generatedAt, 'generatedAt'),
    planDigest: safeDigest(plan.planDigest, 'planDigest'),
    sourceExecutionDigest: safeDigest(
      plan.sourceExecutionDigest,
      'sourceExecutionDigest'
    ),
    executable,
    actions
  };
}

function digestNormalizedSidebarRollbackPlan(
  plan: SidebarRollbackPlanDigestInput
): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(plan)), 'utf8')
    .digest('hex');
}

export function digestSidebarRollbackPlan(
  plan: SidebarRollbackPlanDigestInput | SidebarRollbackPlan
): string {
  return digestNormalizedSidebarRollbackPlan(
    normalizeSidebarRollbackPlanDigestInput(plan)
  );
}

export function validateSidebarRollbackPlan(
  value: unknown
): SidebarRollbackPlan {
  const plan = record(value, 'root');
  const normalized = normalizeSidebarRollbackPlanDigestInput(plan);
  const digest = safeDigest(plan.digest, 'digest');
  const expectedDigest = digestNormalizedSidebarRollbackPlan(normalized);
  if (digest !== expectedDigest) {
    invalid('digest', 'digest-mismatch');
  }
  return {
    ...normalized,
    digest
  };
}

export function createSidebarRollbackPlan(
  input: CreateSidebarRollbackPlanInput
): SidebarRollbackPlan {
  const rawInput = record(input, 'input');
  assertKnownFields(rawInput, ROLLBACK_INPUT_FIELDS, 'input');
  const applyResult = validateSidebarApplyResult(rawInput.applyResult);
  const receipt = validateSidebarHostReceipt(rawInput.receipt);

  if (applyResult.entries.some((entry) => entry.status === 'unknown')) {
    invalid('applyResult.entries', 'inconsistent-result');
  }
  if (receipt.planDigest !== applyResult.planDigest) {
    invalid('receipt.planDigest', 'digest-mismatch');
  }
  if (receipt.executionDigest !== applyResult.executionDigest) {
    invalid('receipt.executionDigest', 'digest-mismatch');
  }
  if (Date.parse(receipt.generatedAt) < Date.parse(applyResult.generatedAt)) {
    invalid('receipt.generatedAt', 'inconsistent-result');
  }
  if (receipt.entries.length !== applyResult.pendingHostActions.length) {
    invalid('receipt.entries', 'inconsistent-result');
  }
  for (let index = 0; index < receipt.entries.length; index += 1) {
    const receiptEntry = receipt.entries[index]!;
    const pending = applyResult.pendingHostActions[index]!;
    if (receiptEntry.threadId !== pending.threadId) {
      invalid(`receipt.entries[${index}]`, 'inconsistent-result');
    }
    if (pending.planDigest !== applyResult.planDigest) {
      invalid(
        `applyResult.pendingHostActions[${index}].planDigest`,
        'digest-mismatch'
      );
    }
  }

  const confirmedEntries = applyResult.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => CONFIRMED_NAME_STATUSES.has(entry.status));
  const actions = confirmedEntries.map(({ entry, index }) => {
    if (entry.previousPinned === null) {
      invalid(
        `applyResult.entries[${index}].previousPinned`,
        'inconsistent-result'
      );
    }
    return {
      threadId: entry.threadId,
      restoreName: entry.previousName,
      restorePinned: entry.previousPinned,
      nameAdapter: entry.previousName === null
        ? 'unsupported-clear-name-on-codex-0.147.0' as const
        : 'app-server' as const,
      pinAdapter: 'codex-app-host' as const
    };
  }).reverse();

  const rollbackCore: SidebarRollbackPlanDigestInput = {
    schemaVersion: ROLLBACK_PLAN_SCHEMA_VERSION,
    generatedAt: generatedTimestamp(rawInput.generatedAt, 'generatedAt'),
    planDigest: applyResult.planDigest,
    sourceExecutionDigest: applyResult.executionDigest,
    executable: actions.every((action) => action.nameAdapter === 'app-server'),
    actions
  };
  return validateSidebarRollbackPlan({
    ...rollbackCore,
    digest: digestNormalizedSidebarRollbackPlan(rollbackCore)
  });
}

function applyEntry(
  action: SidebarAction,
  previousName: string | null,
  finalName: string | null,
  status: SidebarApplyStatus
): SidebarApplyEntry {
  return {
    threadId: action.threadId,
    previousName,
    previousPinned: action.currentPinned,
    desiredName: action.desiredName,
    finalName,
    status,
    error: expectedApplyError(status)
  };
}

async function rereadName(
  input: ApplySidebarPlanInput,
  threadId: string
): Promise<{ known: true; name: string | null } | { known: false }> {
  try {
    const value = await input.readName(threadId);
    try {
      return {
        known: true,
        name: safeObservedName(value, 'readName')
      };
    } catch {
      return { known: false };
    }
  } catch {
    return { known: false };
  }
}

export async function applySidebarPlan(
  input: ApplySidebarPlanInput
): Promise<SidebarApplyResult> {
  const plan = validateSidebarPlan(input.plan);
  if (plan.digest !== input.confirmDigest) {
    invalid('confirmDigest', 'digest-mismatch');
  }

  const beforeStates = new Map<
    string,
    { present: false } | { present: true; name: string | null }
  >();
  for (const action of plan.actions) {
    if (!input.currentNames.has(action.threadId)) {
      beforeStates.set(action.threadId, { present: false });
      continue;
    }
    beforeStates.set(
      action.threadId,
      {
        present: true,
        name: safeObservedName(
          input.currentNames.get(action.threadId),
          'currentNames'
        )
      }
    );
  }

  const entries: SidebarApplyEntry[] = [];
  for (const action of plan.actions) {
    const beforeState = beforeStates.get(action.threadId)!;
    if (!beforeState.present) {
      entries.push(applyEntry(action, null, null, 'thread-missing'));
      continue;
    }
    const previousName = beforeState.name;
    if (
      previousName !== action.currentName &&
      previousName !== action.desiredName
    ) {
      entries.push(
        applyEntry(action, previousName, previousName, 'conflict')
      );
      continue;
    }
    if (previousName === action.desiredName) {
      entries.push(
        applyEntry(action, previousName, previousName, 'unchanged')
      );
      continue;
    }

    try {
      await input.setName(action.threadId, action.desiredName);
    } catch {
      // A rejected write can still have committed; the reread owns classification.
    }
    const observed = await rereadName(input, action.threadId);
    if (!observed.known) {
      entries.push(applyEntry(action, previousName, null, 'unknown'));
    } else if (observed.name === action.desiredName) {
      entries.push(
        applyEntry(action, previousName, observed.name, 'name-applied')
      );
    } else if (observed.name === previousName) {
      entries.push(
        applyEntry(action, previousName, observed.name, 'failed')
      );
    } else {
      entries.push(
        applyEntry(action, previousName, observed.name, 'unknown')
      );
    }
  }

  const generatedAt = new Date().toISOString();
  const executionCore: SidebarApplyExecutionDigestInput = {
    schemaVersion: APPLY_SCHEMA_VERSION,
    generatedAt,
    planDigest: plan.digest,
    entries
  };
  const executionDigest =
    digestNormalizedApplyExecution(executionCore);
  return validateSidebarApplyResult({
    ...executionCore,
    executionDigest,
    pendingHostActions: entries
      .filter((entry) => CONFIRMED_NAME_STATUSES.has(entry.status))
      .map((entry) => ({
        planDigest: plan.digest,
        executionDigest,
        action: 'set-pinned',
        threadId: entry.threadId,
        pinned: true,
        previousPinned: entry.previousPinned
      }))
  });
}
