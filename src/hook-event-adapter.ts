import type { HookDryRunBatchInput } from './hook-batch.js';
import { analyzeShellCommand } from './hook-shell-analyzer.js';
import { fastCtxToolName } from './fastctx-contract.js';
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
    const fastCtxTool = fastCtxToolName(normalized);
    if (fastCtxTool === 'inspect_local_file' || fastCtxTool === 'read' || fastCtxTool === 'job_output' || fastCtxTool === 'job_list') return 'read';
    if (fastCtxTool === 'grep') return 'grep';
    if (fastCtxTool === 'glob') return 'glob';
    if (fastCtxTool === 'replace') return 'write';
    if (fastCtxTool === 'run' || fastCtxTool === 'run_background' || fastCtxTool === 'job_kill') return 'shell';
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

function extractPathsFromPatch(patch: unknown): string[] {
  if (typeof patch !== 'string') return [];
  const paths = [...patch.matchAll(/^\*\*\* (?:Update File|Add File|Delete File|Move to):\s*(.+?)\s*$/gm)]
    .map((match) => match[1]?.trim())
    .filter((targetPath): targetPath is string => Boolean(targetPath));
  return [...new Set(paths)];
}

function extractCommandText(input: Record<string, unknown>, tool: HookCall['tool']): string | undefined {
  if (typeof input.command === 'string') return input.command;
  if (tool === 'apply_patch' && typeof input.patch === 'string') return input.patch;
  return undefined;
}

function extractTargetPaths(input: Record<string, unknown>, tool: HookCall['tool']): string[] {
  if (tool === 'apply_patch') {
    return extractPathsFromPatch(input.patch ?? input.command);
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
  const rawTool = record.tool ?? record.tool_name ?? record.name;
  const tool = normalizeToolName(rawTool);
  if (!tool || !allTools.has(tool)) throw new Error('unsupported hook event: missing tool');
  const fastCtxTool = typeof rawTool === 'string' ? fastCtxToolName(rawTool) : null;
  if (tool === 'shell' && typeof record.command === 'string') {
    return analyzeShellCommand({
      command: record.command,
      cwd: typeof record.cwd === 'string' ? record.cwd : (fallbackCwd ?? process.cwd())
    });
  }
  if (fastCtxTool === 'run' || fastCtxTool === 'run_background') {
    throw new Error(`unsupported hook event: ${fastCtxTool} requires command`);
  }
  if (fastCtxTool === 'job_kill') {
    return [{
      tool: 'shell',
      targetPath: typeof record.cwd === 'string' ? record.cwd : (fallbackCwd ?? process.cwd()),
      writes: true
    }];
  }
  const targetPaths = extractTargetPaths(record, tool);
  if (targetPaths.length === 0) {
    const command = extractCommandText(record, tool);
    return [{ tool, targetPath: null, writes: inferWrites(tool, record.writes), ...(command ? { command } : {}) }];
  }
  const command = extractCommandText(record, tool);
  return targetPaths.map((targetPath) => ({ tool, targetPath, writes: inferWrites(tool, record.writes), ...(command ? { command } : {}) }));
}

function adaptGenericEvent(task: CurrentTask, record: Record<string, unknown>): HookDryRunBatchInput | null {
  if (record.schema !== 'paneforge.hook-event.v1') return null;
  if (!Array.isArray(record.calls)) throw new Error('unsupported hook event: calls must be array');
  const fallbackCwd = typeof record.cwd === 'string' ? record.cwd : task.worktreeRoot;
  return {
    schema: 'paneforge.hook-dry-run-batch.v1',
    task,
    calls: record.calls.flatMap((call) => adaptCall(call, fallbackCwd))
  };
}

function adaptSingleToolEvent(task: CurrentTask, record: Record<string, unknown>): HookDryRunBatchInput {
  const rawTool = record.tool_name ?? record.tool ?? record.name;
  const tool = normalizeToolName(rawTool);
  if (!tool) throw new Error('unsupported hook event: missing tool');
  const fastCtxTool = typeof rawTool === 'string' ? fastCtxToolName(rawTool) : null;
  const input = asRecord(record.tool_input ?? record.arguments ?? record.input ?? record);
  if (tool === 'shell' && typeof input.command === 'string') {
    return {
      schema: 'paneforge.hook-dry-run-batch.v1',
      task,
      calls: analyzeShellCommand({
        command: input.command,
        cwd: typeof input.cwd === 'string' ? input.cwd : (typeof record.cwd === 'string' ? record.cwd : task.worktreeRoot)
      })
    };
  }
  if (fastCtxTool === 'run' || fastCtxTool === 'run_background') {
    throw new Error(`unsupported hook event: ${fastCtxTool} requires command`);
  }
  if (fastCtxTool === 'job_kill') {
    return {
      schema: 'paneforge.hook-dry-run-batch.v1',
      task,
      calls: [{
        tool: 'shell',
        targetPath: typeof input.cwd === 'string' ? input.cwd : (typeof record.cwd === 'string' ? record.cwd : task.worktreeRoot),
        writes: true
      }]
    };
  }
  const targetPaths = extractTargetPaths(input, tool);
  const command = extractCommandText(input, tool);
  const calls = targetPaths.length === 0
    ? [{ tool, targetPath: null, writes: inferWrites(tool, input.writes), ...(command ? { command } : {}) }]
    : targetPaths.map((targetPath) => ({ tool, targetPath, writes: inferWrites(tool, input.writes), ...(command ? { command } : {}) }));
  return {
    schema: 'paneforge.hook-dry-run-batch.v1',
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
