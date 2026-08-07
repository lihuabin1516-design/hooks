import fs from 'node:fs/promises';
import path from 'node:path';
import type { CurrentTask } from './types.js';

const MAX_SUMMARY_CHARS = 1200;

export interface PostToolUseAuditRecord {
  schema: 'ccpanes.post-tool-use-audit.v1';
  taskId: string;
  workspace: string;
  worktreeRoot: string;
  cwd: string | null;
  toolName: string | null;
  toolUseId: string | null;
  observedAt: string;
  inputSummary: unknown;
  responseSummary: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function truncateText(value: string): string {
  if (value.length <= MAX_SUMMARY_CHARS) return value;
  return `${value.slice(0, MAX_SUMMARY_CHARS)}...[truncated ${value.length - MAX_SUMMARY_CHARS} chars]`;
}

export function summarizeHookValue(value: unknown): unknown {
  if (typeof value === 'string') return truncateText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => summarizeHookValue(item));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      output[key] = summarizeHookValue(nested);
    }
    const encoded = JSON.stringify(output);
    if (encoded.length > MAX_SUMMARY_CHARS) {
      return truncateText(encoded);
    }
    return output;
  }
  return String(value);
}

export function createPostToolUseAuditRecord(task: CurrentTask, event: unknown): PostToolUseAuditRecord {
  const record = asRecord(event);
  return {
    schema: 'ccpanes.post-tool-use-audit.v1',
    taskId: task.taskId,
    workspace: task.workspace,
    worktreeRoot: task.worktreeRoot,
    cwd: typeof record.cwd === 'string' ? record.cwd : null,
    toolName: typeof record.tool_name === 'string' ? record.tool_name : null,
    toolUseId: typeof record.tool_use_id === 'string' ? record.tool_use_id : null,
    observedAt: new Date().toISOString(),
    inputSummary: summarizeHookValue(record.tool_input),
    responseSummary: summarizeHookValue(record.tool_response)
  };
}

export async function appendPostToolUseAudit(auditPath: string, record: PostToolUseAuditRecord): Promise<void> {
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  await fs.appendFile(auditPath, `${JSON.stringify(record)}\n`, 'utf8');
}
