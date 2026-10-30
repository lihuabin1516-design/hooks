import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { dispatchMcpHook, MCP_HOOK_COMMANDS } from './mcp-hook-adapter.js';
import { createRuntimeIdentityReport, getRuntimeIdentity } from './runtime-identity.js';

const auditRoot = process.env.GZL_HOOK_AUDIT_ROOT;
if (!auditRoot) throw new Error('GZL_HOOK_AUDIT_ROOT is required');

const runtimeIdentity = getRuntimeIdentity();
const server = new McpServer({ name: 'gzl-hooks', version: runtimeIdentity.packageVersion });

server.registerTool('runtime_identity', {
  description: 'Report the loaded PaneForge hook build identity and optionally compare it with an expected task HEAD.',
  inputSchema: z.object({
    expectedTaskHead: z.string().min(1).optional()
  })
}, async ({ expectedTaskHead }) => ({
  content: [{
    type: 'text',
    text: `${JSON.stringify(createRuntimeIdentityReport(runtimeIdentity, expectedTaskHead ?? null), null, 2)}\n`
  }]
}));

server.registerTool('dispatch', {
  description: 'Dispatch a Codex lifecycle event through the installed PaneForge workflow hooks.',
  inputSchema: z.object({
    command: z.enum(MCP_HOOK_COMMANDS),
    event: z.record(z.string(), z.unknown())
  })
}, async ({ command, event }) => ({
  content: [{ type: 'text', text: await dispatchMcpHook(command, event, auditRoot, undefined, runtimeIdentity) }]
}));

await server.connect(new StdioServerTransport());
