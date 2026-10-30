import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHookDecisionAuditRecord, writeHookDecisionAudit } from '../src/hook-decision-audit.js';
import { runHookEventDryRun } from '../src/hook-runner.js';
import type { RuntimeIdentity } from '../src/runtime-identity.js';
import type { CurrentTask } from '../src/types.js';

let tempRoot: string;

const runtimeIdentity: RuntimeIdentity = {
  schema: 'paneforge.runtime-identity.v1',
  packageName: 'paneforge-hooks-tooling',
  packageVersion: '0.1.0',
  gitCommit: 'abc123',
  gitDirty: false,
  buildSha256: 'A'.repeat(64),
  builtAt: '2026-09-15T00:00:00.000Z',
  source: 'build-manifest'
};

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paneforge-hook-audit-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function task(): CurrentTask {
  return {
    schema: 'paneforge.task-selection.v1',
    taskId: 'audit-recovery',
    workspace: 'test',
    projectPath: tempRoot,
    worktreeRoot: tempRoot,
    mainRepoRoot: null,
    branch: null,
    head: 'abc123',
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '2026-09-15T00:00:00.000Z',
    updatedAt: '2026-09-15T00:00:00.000Z',
    source: 'manual-import',
    notes: 'audit recovery fixture'
  };
}

function record(toolUseId: string) {
  const currentTask = task();
  const event = {
    hook_event_name: 'PreToolUse',
    cwd: tempRoot,
    tool_name: 'mcp__fastctx__inspect_local_file',
    tool_use_id: toolUseId,
    tool_input: { file_path: path.join(tempRoot, 'README.md') }
  };
  return createHookDecisionAuditRecord(
    'PreToolUse',
    currentTask,
    event,
    runHookEventDryRun(currentTask, event),
    runtimeIdentity
  );
}

describe('hook decision audit recovery', () => {
  test('reconciles history and snapshot after a failure between the two writes', async () => {
    const snapshotPath = path.join(tempRoot, 'hook-enforce-audit.json');
    const interrupted = record('interrupted');
    await expect(writeHookDecisionAudit(snapshotPath, interrupted, {
      afterHistoryAppend: async () => { throw new Error('synthetic crash'); }
    })).rejects.toThrow('synthetic crash');

    await expect(fs.stat(`${snapshotPath}.pending.json`)).resolves.toBeTruthy();
    const next = record('next');
    await writeHookDecisionAudit(snapshotPath, next);

    const history = (await fs.readFile(snapshotPath.replace(/\.json$/, '.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
    expect(history.map((entry) => entry.auditId)).toEqual([interrupted.auditId, next.auditId]);
    expect(snapshot.auditContext.toolUseId).toBe('next');
    await expect(fs.stat(`${snapshotPath}.pending.json`)).rejects.toThrow();
  });
});
