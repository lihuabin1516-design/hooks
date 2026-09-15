import { fileURLToPath } from 'node:url';
import { appendCliRuntimeError, runCli } from './cli.js';
import { getRuntimeIdentity, type RuntimeIdentity } from './runtime-identity.js';

export const MCP_HOOK_COMMANDS = [
  'session-start',
  'workflow-advisory',
  'hook-enforce',
  'permission-enforce',
  'post-enforce',
  'stop-check'
] as const;

export type McpHookCommand = typeof MCP_HOOK_COMMANDS[number];

type CliRunner = typeof runCli;

function runtimeFailureOutput(command: McpHookCommand, error: unknown): string {
  const message = `CC-Panes hook runtime failed: ${error instanceof Error ? error.message : String(error)}`;
  if (command === 'hook-enforce') {
    return `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: message
      }
    })}\n`;
  }
  if (command === 'permission-enforce') {
    return `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message }
      }
    })}\n`;
  }
  return `${JSON.stringify({ systemMessage: message })}\n`;
}

export async function dispatchMcpHook(
  command: McpHookCommand,
  event: Record<string, unknown>,
  auditRoot: string,
  runner: CliRunner = runCli,
  runtimeIdentity: RuntimeIdentity = getRuntimeIdentity()
): Promise<string> {
  const args = [command, '--resolve-task-from-cwd', '--audit-root', auditRoot];
  try {
    return await runner(args, JSON.stringify(event), {
      trustedCliPath: fileURLToPath(new URL('./cli.js', import.meta.url)),
      processExecPath: process.execPath,
      runtimeIdentity
    });
  } catch (error) {
    appendCliRuntimeError(args, error, runtimeIdentity);
    return runtimeFailureOutput(command, error);
  }
}
