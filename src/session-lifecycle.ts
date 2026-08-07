import fs from 'node:fs';
import path from 'node:path';
import type { CurrentTask } from './types.js';

export interface LifecycleOutputInput {
  task: CurrentTask;
  taskPath: string;
  auditRoot?: string | null;
  stopAnalysis?: StopCheckAnalysis | null;
}

export interface SessionStartHookOutput {
  hookSpecificOutput: {
    hookEventName: 'SessionStart';
    additionalContext: string;
  };
}

export interface StopCheckHookOutput {
  continue: true;
  systemMessage: string;
}

export interface StopCheckAnalysis {
  transcriptPath: string | null;
  transcriptRead: boolean;
  parsed: boolean;
  hasEditToolUse: boolean;
  hasCompletionClaim: boolean;
  hasNotVerified: boolean;
  targetedReminder: boolean;
  reason: string;
}

const MAX_TRANSCRIPT_TAIL_BYTES = 256 * 1024;
const MAX_TRANSCRIPT_TAIL_LINES = 400;
const completionPattern = /(完成|已修|通过|完工|\bdone\b|\bpassed\b|\bfixed\b|all set|it works|works now|successfully|ready to (merge|ship|publish))/i;
const notVerifiedPattern = /\bNOT_VERIFIED\b/i;
const editToolNames = new Set(['edit', 'write', 'multiedit', 'notebookedit', 'strreplace', 'editnotebook', 'apply_patch']);

function safeName(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function auditDir(auditRoot: string | null | undefined, task: CurrentTask): string | null {
  return auditRoot ? path.join(auditRoot, safeName(task.taskId)) : null;
}

function formatOptional(value: string | null): string {
  return value && value.length > 0 ? value : 'null';
}

function emptyStopAnalysis(reason: string, transcriptPath: string | null = null): StopCheckAnalysis {
  return {
    transcriptPath,
    transcriptRead: false,
    parsed: false,
    hasEditToolUse: false,
    hasCompletionClaim: false,
    hasNotVerified: false,
    targetedReminder: false,
    reason
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null;
}

function readTailText(filePath: string): string | null {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const size = stat.size;
  const length = Math.min(size, MAX_TRANSCRIPT_TAIL_BYTES);
  const start = Math.max(0, size - length);
  const buffer = Buffer.alloc(length);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, start);
  } finally {
    fs.closeSync(fd);
  }
  return buffer.toString('utf8');
}

function parseJsonLines(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .slice(-MAX_TRANSCRIPT_TAIL_LINES)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function contentBlocks(record: Record<string, unknown>): Record<string, unknown>[] {
  const message = asRecord(record.message);
  const content = message.content ?? record.content;
  return Array.isArray(content) ? content.map((item) => asRecord(item)) : [];
}

function hasToolResult(record: Record<string, unknown>): boolean {
  return contentBlocks(record).some((block) => block.type === 'tool_result');
}

function roleOf(record: Record<string, unknown>): string {
  const message = asRecord(record.message);
  return stringField(record, 'role') ?? stringField(record, 'type') ?? stringField(message, 'role') ?? '';
}

function isHumanUser(record: Record<string, unknown>): boolean {
  return roleOf(record) === 'user' && !hasToolResult(record);
}

function isAssistant(record: Record<string, unknown>): boolean {
  return roleOf(record) === 'assistant';
}

function assistantText(record: Record<string, unknown>): string {
  const message = asRecord(record.message);
  const direct = message.content ?? record.content;
  if (typeof direct === 'string') return direct;
  return contentBlocks(record)
    .filter((block) => block.type === 'text')
    .map((block) => stringField(block, 'text') ?? stringField(block, 'content') ?? '')
    .filter((text) => text.length > 0)
    .join('\n');
}

function nestedToolCallNames(record: Record<string, unknown>): string[] {
  const names: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) names.push(value);
  };

  push(record.tool_name);
  for (const block of contentBlocks(record)) {
    if (block.type === 'tool_use' || block.type === 'function_call') {
      push(block.name);
      push(block.tool_name);
    }
  }

  for (const source of [record.tool_calls, asRecord(record.message).tool_calls]) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      const call = asRecord(item);
      push(call.name);
      push(asRecord(call.function).name);
    }
  }
  return names;
}

function isEditToolName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[-.]/g, '_');
  return editToolNames.has(normalized) || normalized.endsWith('__replace') || normalized.endsWith('__write') || normalized.endsWith('__edit');
}

function analyzeParsedTranscript(items: unknown[], transcriptPath: string): StopCheckAnalysis {
  const records = items.map((item) => asRecord(item));
  let lastUserIndex = -1;
  records.forEach((record, index) => {
    if (isHumanUser(record)) lastUserIndex = index;
  });
  const currentTurn = records.slice(lastUserIndex + 1);
  const assistantTexts = currentTurn.map((record) => isAssistant(record) ? assistantText(record) : '').filter((text) => text.trim().length > 0);
  const lastAssistantText = assistantTexts.at(-1) ?? '';
  const hasEditToolUse = currentTurn.flatMap((record) => nestedToolCallNames(record)).some((name) => isEditToolName(name));
  const hasCompletionClaim = completionPattern.test(lastAssistantText);
  const hasNotVerified = notVerifiedPattern.test(lastAssistantText);
  const targetedReminder = hasEditToolUse && hasCompletionClaim && !hasNotVerified;
  return {
    transcriptPath,
    transcriptRead: true,
    parsed: true,
    hasEditToolUse,
    hasCompletionClaim,
    hasNotVerified,
    targetedReminder,
    reason: targetedReminder ? 'edited_completion_claim' : 'no_targeted_completion_claim'
  };
}

export function analyzeStopCheckEvent(event: unknown): StopCheckAnalysis {
  const record = asRecord(event);
  const transcriptPath = stringField(record, 'transcript_path');
  if (!transcriptPath) {
    return emptyStopAnalysis('missing_transcript_path');
  }
  const text = readTailText(transcriptPath);
  if (text === null || text.trim().length === 0) {
    return emptyStopAnalysis('transcript_unreadable_or_empty', transcriptPath);
  }
  const parsed = parseJsonLines(text);
  if (parsed.length === 0) {
    return {
      ...emptyStopAnalysis('transcript_unparsed', transcriptPath),
      transcriptRead: true
    };
  }
  return analyzeParsedTranscript(parsed, transcriptPath);
}

function lifecycleLines(input: LifecycleOutputInput): string[] {
  const auditDirectory = auditDir(input.auditRoot, input.task);
  return [
    'ccpanes-task-probe lifecycle context',
    `taskId: ${input.task.taskId}`,
    `workspace: ${input.task.workspace}`,
    `phase: ${input.task.phase}`,
    `worktreeRoot: ${input.task.worktreeRoot}`,
    `projectPath: ${input.task.projectPath}`,
    `branch: ${formatOptional(input.task.branch)}`,
    `head: ${formatOptional(input.task.head)}`,
    `currentTaskPath: ${input.taskPath}`,
    auditDirectory ? `auditDir: ${auditDirectory}` : 'auditDir: null',
    auditDirectory ? `preToolUseAudit: ${path.join(auditDirectory, 'hook-enforce-audit.json')}` : 'preToolUseAudit: null',
    auditDirectory ? `permissionAudit: ${path.join(auditDirectory, 'permission-enforce-audit.json')}` : 'permissionAudit: null',
    auditDirectory ? `postToolUseAudit: ${path.join(auditDirectory, 'post-tool-use-audit.jsonl')}` : 'postToolUseAudit: null',
    'productionGates: preserve task scope; before completion run targeted checks, inspect diff/status, keep reference repos clean, then record and verify acceptance evidence.'
  ];
}

export function createSessionStartHookOutput(input: LifecycleOutputInput): SessionStartHookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: lifecycleLines(input).join('\n')
    }
  };
}

export function createStopCheckHookOutput(input: LifecycleOutputInput): StopCheckHookOutput {
  const auditDirectory = auditDir(input.auditRoot, input.task);
  const targeted = input.stopAnalysis?.targetedReminder === true;
  const lead = targeted
    ? `ccpanes-task-probe ${input.task.taskId} (${input.task.phase}): targeted verification reminder: this turn appears to include edit/write tool use and a completion claim. Before finalizing, run fresh claim-specific checks, compare the evidence with the claim, inspect diff/status and reference repos, then record-acceptance and verify-acceptance; if proof is missing, state NOT_VERIFIED with the missing proof and next action.`
    : `ccpanes-task-probe ${input.task.taskId} (${input.task.phase}): before claiming completion, run applicable checks such as npm test, npm run typecheck, npm run build, npm run smoke; inspect diff/status and reference repos; then record-acceptance and verify-acceptance.`;
  return {
    continue: true,
    systemMessage: [
      lead,
      `currentTaskPath=${input.taskPath}`,
      auditDirectory ? `auditDir=${auditDirectory}` : 'auditDir=null'
    ].join(' ')
  };
}
