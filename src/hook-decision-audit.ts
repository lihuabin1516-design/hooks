import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { HookRunnerResult } from './hook-runner.js';
import { withFileLock, writeTextFileAtomic } from './atomic-file.js';
import { compareRuntimeIdentityToTaskHead, type RuntimeIdentity, type RuntimeTaskHeadComparison } from './runtime-identity.js';
import type { CurrentTask } from './types.js';

export type HookDecisionEventName = 'PreToolUse' | 'PermissionRequest';

export interface HookDecisionAuditContext {
  observedAt: string;
  hookEventName: HookDecisionEventName;
  taskId: string;
  workspace: string;
  worktreeRoot: string;
  sessionId: string | null;
  turnId: string | null;
  toolUseId: string | null;
  runtimeIdentity: RuntimeIdentity;
  runtimeTaskHead: RuntimeTaskHeadComparison;
}

export interface HookDecisionAuditRecord extends HookDecisionAuditContext {
  schema: 'paneforge.hook-decision-audit.v1';
  auditId: string;
  allowed: boolean;
  reason: string;
  targetPath: string | null;
  result: HookRunnerResult;
}

interface HookDecisionAuditPending {
  schema: 'paneforge.hook-decision-audit-pending.v1';
  record: HookDecisionAuditRecord;
}

export interface HookDecisionAuditWriteOptions {
  afterHistoryAppend?: () => Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    if (typeof record[key] === 'string' && record[key].length > 0) return record[key] as string;
  }
  return null;
}

export function createHookDecisionAuditRecord(
  hookEventName: HookDecisionEventName,
  task: CurrentTask,
  event: unknown,
  result: HookRunnerResult,
  runtimeIdentity: RuntimeIdentity,
  now = new Date().toISOString()
): HookDecisionAuditRecord {
  const eventRecord = asRecord(event);
  const decisive = result.dryRun.decisions.find((decision) => decision.action === 'block') ?? result.dryRun.decisions[0];
  return {
    schema: 'paneforge.hook-decision-audit.v1',
    auditId: randomUUID(),
    observedAt: now,
    hookEventName,
    taskId: task.taskId,
    workspace: task.workspace,
    worktreeRoot: task.worktreeRoot,
    sessionId: stringField(eventRecord, 'session_id', 'sessionId'),
    turnId: stringField(eventRecord, 'turn_id', 'turnId'),
    toolUseId: stringField(eventRecord, 'tool_use_id', 'toolUseId'),
    runtimeIdentity,
    runtimeTaskHead: compareRuntimeIdentityToTaskHead(runtimeIdentity, task.head),
    allowed: result.allowed,
    reason: decisive?.reason ?? 'no_hook_decision',
    targetPath: decisive?.targetPath ?? null,
    result
  };
}

export function decisionHistoryPath(snapshotPath: string): string {
  return snapshotPath.toLowerCase().endsWith('.json') ? `${snapshotPath.slice(0, -5)}.jsonl` : `${snapshotPath}.jsonl`;
}

function decisionPendingPath(snapshotPath: string): string {
  return `${snapshotPath}.pending.json`;
}

function snapshotFromRecord(record: HookDecisionAuditRecord): HookRunnerResult & { auditContext: HookDecisionAuditContext } {
  const auditContext: HookDecisionAuditContext = {
    observedAt: record.observedAt,
    hookEventName: record.hookEventName,
    taskId: record.taskId,
    workspace: record.workspace,
    worktreeRoot: record.worktreeRoot,
    sessionId: record.sessionId,
    turnId: record.turnId,
    toolUseId: record.toolUseId,
    runtimeIdentity: record.runtimeIdentity,
    runtimeTaskHead: record.runtimeTaskHead
  };
  return { ...record.result, auditContext };
}

async function lastHistoryAuditId(historyPath: string): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(historyPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  for (const line of text.trimEnd().split(/\r?\n/).reverse()) {
    if (!line) continue;
    try {
      const value = JSON.parse(line) as Partial<HookDecisionAuditRecord>;
      if (value.schema === 'paneforge.hook-decision-audit.v1' && typeof value.auditId === 'string') return value.auditId;
    } catch {
      // A partial final append is preserved; recovery appends a fresh complete line.
    }
  }
  return null;
}

async function appendHistoryRecord(historyPath: string, record: HookDecisionAuditRecord): Promise<void> {
  let separator = '';
  try {
    const handle = await fs.open(historyPath, 'r');
    try {
      const stat = await handle.stat();
      if (stat.size > 0) {
        const last = Buffer.alloc(1);
        await handle.read(last, 0, 1, stat.size - 1);
        if (last[0] !== 0x0a) separator = '\n';
      }
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.appendFile(historyPath, `${separator}${JSON.stringify(record)}\n`, 'utf8');
}

async function reconcilePendingAudit(snapshotPath: string): Promise<void> {
  const pendingPath = decisionPendingPath(snapshotPath);
  let pending: HookDecisionAuditPending;
  try {
    pending = JSON.parse(await fs.readFile(pendingPath, 'utf8')) as HookDecisionAuditPending;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (pending.schema !== 'paneforge.hook-decision-audit-pending.v1'
    || pending.record?.schema !== 'paneforge.hook-decision-audit.v1'
    || typeof pending.record.auditId !== 'string') {
    throw new Error('invalid hook decision audit pending record');
  }
  const historyPath = decisionHistoryPath(snapshotPath);
  if (await lastHistoryAuditId(historyPath) !== pending.record.auditId) {
    await appendHistoryRecord(historyPath, pending.record);
  }
  await writeTextFileAtomic(snapshotPath, `${JSON.stringify(snapshotFromRecord(pending.record), null, 2)}\n`);
  await fs.rm(pendingPath);
}

export async function writeHookDecisionAudit(
  snapshotPath: string,
  record: HookDecisionAuditRecord,
  options: HookDecisionAuditWriteOptions = {}
): Promise<void> {
  const dir = path.dirname(snapshotPath);
  await fs.mkdir(dir, { recursive: true });
  await withFileLock(`${snapshotPath}.lock`, async () => {
    await reconcilePendingAudit(snapshotPath);
    const pending: HookDecisionAuditPending = { schema: 'paneforge.hook-decision-audit-pending.v1', record };
    await writeTextFileAtomic(decisionPendingPath(snapshotPath), `${JSON.stringify(pending, null, 2)}\n`);
    await appendHistoryRecord(decisionHistoryPath(snapshotPath), record);
    await options.afterHistoryAppend?.();
    await writeTextFileAtomic(snapshotPath, `${JSON.stringify(snapshotFromRecord(record), null, 2)}\n`);
    await fs.rm(decisionPendingPath(snapshotPath));
  });
}
