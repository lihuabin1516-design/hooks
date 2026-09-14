import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { dispatchMcpHook, MCP_HOOK_COMMANDS } from './mcp-hook-adapter.js';

const auditRoot = process.env.GZL_HOOK_AUDIT_ROOT;
if (!auditRoot) throw new Error('GZL_HOOK_AUDIT_ROOT is required');

const server = new McpServer({ name: 'gzl-hooks', version: '0.1.0' });

server.registerTool('dispatch', {
  description: 'Dispatch a Codex lifecycle event through the installed CC-Panes workflow hooks.',
  inputSchema: z.object({
    command: z.enum(MCP_HOOK_COMMANDS),
    event: z.record(z.string(), z.unknown())
  })
}, async ({ command, event }) => ({
  content: [{ type: 'text', text: await dispatchMcpHook(command, event, auditRoot) }]
}));

await server.connect(new StdioServerTransport());
