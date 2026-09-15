import { describe, expect, test, vi } from 'vitest';
import { dispatchMcpHook } from '../src/mcp-hook-adapter.js';
import { createRuntimeIdentityReport, type RuntimeIdentity } from '../src/runtime-identity.js';

const runtimeIdentity: RuntimeIdentity = {
  schema: 'ccpanes.runtime-identity.v1',
  packageName: 'ccpanes-hooks-tooling',
  packageVersion: '0.1.0',
  gitCommit: 'abc123',
  gitDirty: false,
  buildSha256: 'C'.repeat(64),
  builtAt: '2026-09-15T00:00:00.000Z',
  source: 'build-manifest'
};

describe('MCP hook adapter', () => {
  test('exposes runtime identity as a structured read-only MCP report', () => {
    expect(createRuntimeIdentityReport(runtimeIdentity, 'def456')).toMatchObject({
      schema: 'ccpanes.runtime-identity-report.v1',
      runtimeIdentity,
      taskHeadComparison: {
        status: 'mismatch',
        reason: 'runtime_commit_does_not_match_task_head'
      }
    });
  });
  test('passes the complete event to the existing CLI without spawning a command hook', async () => {
    const event = { hook_event_name: 'SessionStart', cwd: 'E:/project', source: 'startup' };
    const runner = vi.fn(async () => '{"continue":true}\n');

    const output = await dispatchMcpHook('session-start', event, 'E:/audits', runner, runtimeIdentity);

    expect(output).toBe('{"continue":true}\n');
    expect(runner).toHaveBeenCalledWith(
      ['session-start', '--resolve-task-from-cwd', '--audit-root', 'E:/audits'],
      JSON.stringify(event),
      expect.objectContaining({ processExecPath: process.execPath, runtimeIdentity })
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
