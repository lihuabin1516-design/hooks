import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookInstallPlan } from '../src/hook-install-plan.js';
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
    notes: 'hook-install-plan fixture task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-install-plan-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createHookInstallPlan', () => {
  test('creates a review-only plan for codex and ccpanes surfaces', async () => {
    const upstreamHook = path.join(tempRoot, 'skills-hub-hook.exe');
    await fs.writeFile(upstreamHook, 'fixture upstream binary bytes', 'utf8');

    const plan = await createHookInstallPlan({
      task: task(),
      prototypeRoot: 'D:/cc-pane/tool/experiments/ccpanes-task-probe',
      target: 'both',
      upstreamHookPath: upstreamHook,
      now: '2026-08-06T00:00:03.000Z'
    });

    expect(plan.schema).toBe('ccpanes.hook-install-plan.v1');
    expect(plan.mode).toBe('review-only');
    expect(plan.target).toBe('both');
    expect(plan.createdAt).toBe('2026-08-06T00:00:03.000Z');
    expect(plan.upstreamHook.sha256).toMatch(/^[A-F0-9]{64}$/);
    expect(plan.shadowCommand).toContain('hook-shadow');
    expect(plan.shadowCommand).toContain(upstreamHook.replace(/\\/g, '/'));
    expect(plan.proposedConfigChanges.map((change) => change.surface)).toEqual(['codex', 'ccpanes']);
    expect(plan.proposedConfigChanges[0].action).toBe('review_patch_only');
    expect(plan.proposedConfigChanges[0].patchCandidate).toContain('hook-shadow');
  });
});
