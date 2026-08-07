import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookShadowAudit } from '../src/hook-shadow.js';
import type { CurrentTask } from '../src/types.js';

let tempRoot: string;

function task(): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: path.join(tempRoot, 'project-alpha'),
    worktreeRoot: path.join(tempRoot, 'project-alpha'),
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'hook-shadow fixture task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-shadow-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createHookShadowAudit', () => {
  test('records dry-run runner result and upstream hook metadata without executing upstream', async () => {
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');

    const audit = await createHookShadowAudit({
      task: task(),
      event: {
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: path.join(tempRoot, 'project-alpha', 'src', 'a.ts') }
      },
      upstreamHookPath: upstreamHook,
      now: '2026-08-06T00:00:02.000Z'
    });

    expect(audit.schema).toBe('ccpanes.hook-shadow-audit.v1');
    expect(audit.mode).toBe('shadow');
    expect(audit.createdAt).toBe('2026-08-06T00:00:02.000Z');
    expect(audit.upstreamHook).toMatchObject({
      path: upstreamHook,
      exists: true,
      size: 29
    });
    expect(audit.upstreamHook?.sha256).toMatch(/^[A-F0-9]{64}$/);
    expect(audit.runner.schema).toBe('ccpanes.hook-runner-result.v1');
    expect(audit.runner.allowed).toBe(true);
  });
});
