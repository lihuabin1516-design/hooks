/** FastCtx release whose published MCP contract this hook runtime supports. */
export const FASTCTX_SUPPORTED_VERSION = '0.2.6';

/** Tools published by FastCtx 0.2.6. Shell tools are optional at server startup. */
export const FASTCTX_FILE_TOOLS = [
  'inspect_local_file',
  'grep',
  'glob',
  'replace'
] as const;

export const FASTCTX_SHELL_TOOLS = [
  'run',
  'run_background',
  'job_output',
  'job_kill',
  'job_list'
] as const;

/** `read` was the inspection tool name through FastCtx 0.2.4. */
export const FASTCTX_LEGACY_TOOLS = ['read'] as const;

export const FASTCTX_HOOK_TOOL_NAMES = [
  ...FASTCTX_FILE_TOOLS,
  ...FASTCTX_SHELL_TOOLS,
  ...FASTCTX_LEGACY_TOOLS
] as const;

export type FastCtxToolName = typeof FASTCTX_HOOK_TOOL_NAMES[number];

export function fastCtxHookMatcherFragment(): string {
  return `mcp__fastctx__(${FASTCTX_HOOK_TOOL_NAMES.join('|')})`;
}

export function fastCtxToolName(value: string): FastCtxToolName | null {
  const normalized = value.trim().toLowerCase().replace(/-/g, '_').replace(/\./g, '_');
  if (!normalized.startsWith('mcp__fastctx__')) return null;
  const name = normalized.slice('mcp__fastctx__'.length);
  return (FASTCTX_HOOK_TOOL_NAMES as readonly string[]).includes(name)
    ? name as FastCtxToolName
    : null;
}
