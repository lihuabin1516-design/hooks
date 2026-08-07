import type { HookDryRunBatchInput } from './hook-batch.js';
import { analyzeShellCommand } from './hook-shell-analyzer.js';
import type { CurrentTask, HookCall } from './types.js';

const readTools = new Set(['read', 'grep', 'glob']);
const writeTools = new Set(['edit', 'write', 'apply_patch', 'shell']);
const allTools = new Set([...readTools, ...writeTools]);

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, unknown>;
}

function normalizeToolName(value: unknown): HookCall['tool'] | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/-/g, '_').replace(/\./g, '_');
  if (normalized === 'bash' || normalized === 'shell_command' || normalized === 'functions_shell_command') return 'shell';
  if (normalized.startsWith('mcp__')) {
    if (normalized.endsWith('__read')) return 'read';
    if (normalized.endsWith('__grep')) return 'grep';
    if (normalized.endsWith('__glob')) return 'glob';
    if (normalized.endsWith('__replace')) return 'write';
    if (/(^|__)(write|edit|delete|remove|move|copy)(_|$)/.test(normalized)) return 'write';
    if (/(^|__)(read|search|find|list|grep|glob)(_|$)/.test(normalized)) return 'read';
  }
  if (normalized === 'edit' || normalized === 'write' || normalized === 'apply_patch' || normalized === 'shell' || normalized === 'read' || normalized === 'grep' || normalized === 'glob') {
    return normalized;
  }
  return null;
}

function inferWrites(tool: HookCall['tool'], explicitWrites: unknown): boolean {
  if (typeof explicitWrites === 'boolean') return explicitWrites;
  return writeTools.has(tool);
}

function extractPathFromPatch(patch: unknown): string | null {
  if (typeof patch !== 'string') return null;
  const patterns = [
    /^\*\*\* Update File: (.+)$/m,
    /^\*\*\* Add File: (.+)$/m,
    /^\*\*\* Delete File: (.+)$/m
  ];
  for (const pattern of patterns) {
    const match = patch.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function extractTargetPaths(input: Record<string, unknown>, tool: HookCall['tool']): string[] {
  if (tool === 'apply_patch') {
    const patchPath = extractPathFromPatch(input.patch ?? input.command);
    return patchPath ? [patchPath] : [];
  }
  const paths: string[] = [];
  for (const key of ['targetPath', 'path', 'file_path', 'filePath', 'cwd']) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) paths.push(value);
  }
  const files = input.files;
  if (Array.isArray(files)) {
    for (const file of files) {
      const fileRecord = asRecord(file);
      for (const key of ['path', 'file_path', 'filePath', 'targetPath']) {
        const value = fileRecord[key];
        if (typeof value === 'string' && value.length > 0) paths.push(value);
      }
    }
  }
  return [...new Set(paths)];
}

function adaptCall(value: unknown, fallbackCwd: string | null): HookCall[] {
  const record = asRecord(value);
  const tool = normalizeToolName(record.tool ?? record.tool_name ?? record.name);
  if (!tool || !allTools.has(tool)) throw new Error('unsupported hook event: missing tool');
  if (tool === 'shell' && typeof record.command === 'string') {
    return analyzeShellCommand({
      command: record.command,
      cwd: typeof record.cwd === 'string' ? record.cwd : (fallbackCwd ?? process.cwd())
    });
  }
  const targetPaths = extractTargetPaths(record, tool);
  if (targetPaths.length === 0) {
    return [{ tool, targetPath: null, writes: inferWrites(tool, record.writes) }];
  }
  return targetPaths.map((targetPath) => ({ tool, targetPath, writes: inferWrites(tool, record.writes) }));
}

function adaptGenericEvent(task: CurrentTask, record: Record<string, unknown>): HookDryRunBatchInput | null {
  if (record.schema !== 'ccpanes.hook-event.v1') return null;
  if (!Array.isArray(record.calls)) throw new Error('unsupported hook event: calls must be array');
  const fallbackCwd = typeof record.cwd === 'string' ? record.cwd : task.worktreeRoot;
  return {
    schema: 'ccpanes.hook-dry-run-batch.v1',
    task,
    calls: record.calls.flatMap((call) => adaptCall(call, fallbackCwd))
  };
}

function adaptSingleToolEvent(task: CurrentTask, record: Record<string, unknown>): HookDryRunBatchInput {
  const tool = normalizeToolName(record.tool_name ?? record.tool ?? record.name);
  if (!tool) throw new Error('unsupported hook event: missing tool');
  const input = asRecord(record.tool_input ?? record.arguments ?? record.input ?? record);
  if (tool === 'shell' && typeof input.command === 'string') {
    return {
      schema: 'ccpanes.hook-dry-run-batch.v1',
      task,
      calls: analyzeShellCommand({
        command: input.command,
        cwd: typeof input.cwd === 'string' ? input.cwd : (typeof record.cwd === 'string' ? record.cwd : task.worktreeRoot)
      })
    };
  }
  const targetPaths = extractTargetPaths(input, tool);
  const calls = targetPaths.length === 0
    ? [{ tool, targetPath: null, writes: inferWrites(tool, input.writes) }]
    : targetPaths.map((targetPath) => ({ tool, targetPath, writes: inferWrites(tool, input.writes) }));
  return {
    schema: 'ccpanes.hook-dry-run-batch.v1',
    task,
    calls
  };
}

export function adaptHookEventToBatch(task: CurrentTask, event: unknown): HookDryRunBatchInput {
  const record = asRecord(event);
  const generic = adaptGenericEvent(task, record);
  if (generic) return generic;
  return adaptSingleToolEvent(task, record);
}
