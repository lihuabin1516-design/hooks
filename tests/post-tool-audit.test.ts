import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { appendPostToolUseAudit, createPostToolUseAuditRecord } from '../src/post-tool-audit.js';
import type { CurrentTask } from '../src/types.js';
import type { RuntimeIdentity } from '../src/runtime-identity.js';

let tempRoot: string;

const runtimeIdentity: RuntimeIdentity = {
  schema: 'paneforge.runtime-identity.v1',
  packageName: 'paneforge-hooks-tooling',
  packageVersion: '0.1.0',
  gitCommit: 'abc123',
  gitDirty: false,
  buildSha256: 'E'.repeat(64),
  builtAt: '2026-09-15T00:00:00.000Z',
  source: 'build-manifest'
};

function task(root: string): CurrentTask {
  return {
    schema: 'paneforge.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'paneforge',
    projectPath: root,
    worktreeRoot: root,
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'audit fixture task'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paneforge-post-audit-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createPostToolUseAuditRecord', () => {
  test('summarizes PostToolUse input and response without blocking Codex', () => {
    const record = createPostToolUseAuditRecord(task(tempRoot), {
      hook_event_name: 'PostToolUse',
      cwd: tempRoot,
      tool_name: 'Bash',
      tool_use_id: 'toolu-1',
      tool_input: { command: 'npm test' },
      tool_response: { exit_code: 0, stdout: 'ok' }
    }, runtimeIdentity);

    expect(record).toMatchObject({
      schema: 'paneforge.post-tool-use-audit.v1',
      taskId: 'task-alpha',
      cwd: tempRoot,
      toolName: 'Bash',
      toolUseId: 'toolu-1',
      runtimeIdentity,
      inputSummary: { command: 'npm test' },
      responseSummary: { exit_code: 0, stdout: 'ok' }
    });
    expect(record.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('truncates long response fields', () => {
    const record = createPostToolUseAuditRecord(task(tempRoot), {
      hook_event_name: 'PostToolUse',
      cwd: tempRoot,
      tool_name: 'Bash',
      tool_response: { stdout: 'x'.repeat(3000) }
    });

    expect(JSON.stringify(record.responseSummary).length).toBeLessThan(1300);
    expect(JSON.stringify(record.responseSummary)).toContain('[truncated');
  });

  test('omits FastCtx image payloads while retaining useful content metadata', () => {
    const record = createPostToolUseAuditRecord(task(tempRoot), {
      hook_event_name: 'PostToolUse',
      cwd: tempRoot,
      tool_name: 'mcp__fastctx__inspect_local_file',
      tool_response: {
        content: [{ type: 'image', data: 'A'.repeat(4096), mimeType: 'image/png' }]
      }
    }, runtimeIdentity);

    expect(record.responseSummary).toEqual({
      content: [{
        type: 'image',
        data: '[omitted image data: 4096 chars]',
        mimeType: 'image/png'
      }]
    });
    expect(JSON.stringify(record.responseSummary)).not.toContain('AAAA');
  });
});

describe('appendPostToolUseAudit', () => {
  test('appends JSONL records without overwriting previous entries', async () => {
    const auditPath = path.join(tempRoot, 'audit.jsonl');
    const first = createPostToolUseAuditRecord(task(tempRoot), { hook_event_name: 'PostToolUse', cwd: tempRoot, tool_name: 'Bash', tool_response: 'one' });
    const second = createPostToolUseAuditRecord(task(tempRoot), { hook_event_name: 'PostToolUse', cwd: tempRoot, tool_name: 'Bash', tool_response: 'two' });

    await appendPostToolUseAudit(auditPath, first);
    await appendPostToolUseAudit(auditPath, second);

    const lines = (await fs.readFile(auditPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).responseSummary).toBe('one');
    expect(JSON.parse(lines[1]).responseSummary).toBe('two');
  });
});
