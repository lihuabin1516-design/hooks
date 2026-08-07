import { describe, expect, test } from 'vitest';
import { adaptHookEventToBatch } from '../src/hook-event-adapter.js';
import type { CurrentTask } from '../src/types.js';

function task(): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: 'D:/cc-pane/project-alpha',
    worktreeRoot: 'D:/cc-pane/project-alpha',
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'adapter fixture task'
  };
}

describe('adaptHookEventToBatch', () => {
  test('adapts generic hook event schema', () => {
    const batch = adaptHookEventToBatch(task(), {
      schema: 'ccpanes.hook-event.v1',
      calls: [
        { tool: 'read', targetPath: 'D:/cc-pane/project-alpha/src/a.ts' },
        { tool: 'write', targetPath: 'D:/cc-pane/project-alpha/src/a.ts' }
      ]
    });

    expect(batch.schema).toBe('ccpanes.hook-dry-run-batch.v1');
    expect(batch.task.taskId).toBe('task-alpha');
    expect(batch.calls).toEqual([
      { tool: 'read', targetPath: 'D:/cc-pane/project-alpha/src/a.ts', writes: false },
      { tool: 'write', targetPath: 'D:/cc-pane/project-alpha/src/a.ts', writes: true }
    ]);
  });

  test('adapts Claude-like tool event', () => {
    const batch = adaptHookEventToBatch(task(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'D:/cc-pane/project-alpha/src/a.ts' }
    });

    expect(batch.calls).toEqual([
      { tool: 'edit', targetPath: 'D:/cc-pane/project-alpha/src/a.ts', writes: true }
    ]);
  });

  test('adapts Codex-like tool event', () => {
    const batch = adaptHookEventToBatch(task(), {
      event: 'tool_call',
      tool: 'shell',
      arguments: { cwd: 'D:/cc-pane/project-alpha', command: 'npm test' }
    });

    expect(batch.calls).toEqual([
      { tool: 'shell', targetPath: 'D:/cc-pane/project-alpha', writes: false, command: 'npm test' }
    ]);
  });

  test('adapts Codex Bash command and extracts shell write target', () => {
    const batch = adaptHookEventToBatch(task(), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/cc-pane/project-alpha',
      tool_name: 'Bash',
      tool_input: { command: 'Set-Content -Path C:/Users/AI001/.codex/config.toml -Value x' }
    });

    expect(batch.calls).toEqual([
      { tool: 'shell', targetPath: 'C:/Users/AI001/.codex/config.toml', writes: true, command: 'Set-Content -Path C:/Users/AI001/.codex/config.toml -Value x' }
    ]);
  });

  test('adapts FastCtx read files as multiple non-write calls', () => {
    const batch = adaptHookEventToBatch(task(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__fastctx__read',
      tool_input: {
        files: [
          { path: 'D:/cc-pane/project-alpha/src/a.ts' },
          { path: 'D:/cc-pane/project-alpha/src/b.ts' }
        ]
      }
    });

    expect(batch.calls).toEqual([
      { tool: 'read', targetPath: 'D:/cc-pane/project-alpha/src/a.ts', writes: false },
      { tool: 'read', targetPath: 'D:/cc-pane/project-alpha/src/b.ts', writes: false }
    ]);
  });

  test('adapts FastCtx replace as a write call', () => {
    const batch = adaptHookEventToBatch(task(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__fastctx__replace',
      tool_input: { path: 'D:/cc-pane/project-alpha/src' }
    });

    expect(batch.calls).toEqual([
      { tool: 'write', targetPath: 'D:/cc-pane/project-alpha/src', writes: true }
    ]);
  });

  test('adapts functions.shell_command as shell command', () => {
    const batch = adaptHookEventToBatch(task(), {
      hook_event_name: 'PreToolUse',
      cwd: 'D:/cc-pane/project-alpha',
      tool_name: 'functions.shell_command',
      tool_input: { command: 'git push origin HEAD' }
    });

    expect(batch.calls).toEqual([
      {
        tool: 'shell',
        targetPath: 'D:/cc-pane/project-alpha',
        writes: true,
        command: 'git push origin HEAD',
        policyReason: 'external_publication_git_push'
      }
    ]);
  });

  test('extracts target path from apply_patch text', () => {
    const batch = adaptHookEventToBatch(task(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: {
        patch: '*** Begin Patch\n*** Update File: D:/cc-pane/project-alpha/src/a.ts\n@@\n-old\n+new\n*** End Patch\n'
      }
    });

    expect(batch.calls[0]).toEqual({
      tool: 'apply_patch',
      targetPath: 'D:/cc-pane/project-alpha/src/a.ts',
      writes: true,
      command: '*** Begin Patch\n*** Update File: D:/cc-pane/project-alpha/src/a.ts\n@@\n-old\n+new\n*** End Patch\n'
    });
  });

  test('extracts target path from Codex apply_patch command field', () => {
    const batch = adaptHookEventToBatch(task(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: {
        command: '*** Begin Patch\n*** Add File: D:/cc-pane/project-alpha/src/from-command.ts\n+export const value = 1;\n*** End Patch\n'
      }
    });

    expect(batch.calls[0]).toEqual({
      tool: 'apply_patch',
      targetPath: 'D:/cc-pane/project-alpha/src/from-command.ts',
      writes: true,
      command: '*** Begin Patch\n*** Add File: D:/cc-pane/project-alpha/src/from-command.ts\n+export const value = 1;\n*** End Patch\n'
    });
  });

  test('rejects events without a recognizable tool', () => {
    expect(() => adaptHookEventToBatch(task(), { event: 'unknown' })).toThrow('unsupported hook event: missing tool');
  });
});
