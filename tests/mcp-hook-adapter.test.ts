import { describe, expect, test, vi } from 'vitest';
import { dispatchMcpHook } from '../src/mcp-hook-adapter.js';

describe('MCP hook adapter', () => {
  test('passes the complete event to the existing CLI without spawning a command hook', async () => {
    const event = { hook_event_name: 'SessionStart', cwd: 'E:/project', source: 'startup' };
    const runner = vi.fn(async () => '{"continue":true}\n');

    const output = await dispatchMcpHook('session-start', event, 'E:/audits', runner);

    expect(output).toBe('{"continue":true}\n');
    expect(runner).toHaveBeenCalledWith(
      ['session-start', '--resolve-task-from-cwd', '--audit-root', 'E:/audits'],
      JSON.stringify(event),
      expect.objectContaining({ processExecPath: process.execPath })
    );
  });

  test('fails closed when the PreToolUse policy runtime throws', async () => {
    const output = await dispatchMcpHook(
      'hook-enforce',
      { hook_event_name: 'PreToolUse' },
      '',
      vi.fn(async () => { throw new Error('policy unavailable'); })
    );

    expect(JSON.parse(output)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'CC-Panes hook runtime failed: policy unavailable'
      }
    });
  });

  test('fails closed when the PermissionRequest policy runtime throws', async () => {
    const output = await dispatchMcpHook(
      'permission-enforce',
      { hook_event_name: 'PermissionRequest' },
      '',
      vi.fn(async () => { throw new Error('policy unavailable'); })
    );

    expect(JSON.parse(output).hookSpecificOutput.decision).toEqual({
      behavior: 'deny',
      message: 'CC-Panes hook runtime failed: policy unavailable'
    });
  });
});
