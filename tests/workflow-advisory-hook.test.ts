import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  appendWorkflowAdvisoryAudit,
  createWorkflowAdvisory,
  parseWorkflowAdvisoryHookEvent,
  WORKFLOW_ADVISORY_CONTEXT_LIMIT
} from '../src/workflow-advisory-hook.js';
import type { CurrentTask } from '../src/types.js';

let tempRoot: string;

function task(root: string): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-advisory',
    workspace: 'hooks',
    projectPath: root,
    worktreeRoot: root,
    mainRepoRoot: null,
    branch: 'main',
    head: 'fixture-head',
    owner: { leaderSessionId: 'leader-1', paneId: null, layoutId: null },
    phase: 'build',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:01.000Z',
    source: 'manual-import',
    notes: 'workflow advisory fixture'
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-workflow-advisory-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('workflow advisory hook', () => {
  test('parses an official Codex UserPromptSubmit event', () => {
    expect(parseWorkflowAdvisoryHookEvent({
      hook_event_name: 'UserPromptSubmit',
      cwd: tempRoot,
      prompt: '实现生产级缓存并补充测试'
    })).toEqual({
      cwd: tempRoot,
      prompt: '实现生产级缓存并补充测试'
    });
  });

  test('treats malformed or unsupported events as non-applicable', () => {
    expect(parseWorkflowAdvisoryHookEvent(null)).toBeNull();
    expect(parseWorkflowAdvisoryHookEvent({
      hook_event_name: 'PreToolUse',
      cwd: tempRoot,
      prompt: '修改代码'
    })).toBeNull();
    expect(parseWorkflowAdvisoryHookEvent({
      hook_event_name: 'UserPromptSubmit',
      cwd: tempRoot,
      prompt: '   '
    })).toBeNull();
  });

  test('emits bounded production-grade additional context for a code prompt', () => {
    const result = createWorkflowAdvisory({
      task: task(tempRoot),
      event: {
        hook_event_name: 'UserPromptSubmit',
        cwd: tempRoot,
        prompt: '扩展 hook runtime，要求生产级实现并更新测试'
      },
      now: '2026-08-14T01:00:00.000Z'
    });

    expect(result.output).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit'
      }
    });
    const context = result.output?.hookSpecificOutput.additionalContext ?? '';
    expect(context).toContain('ccpanes.workflow-advisory.v1');
    expect(context).toContain('ccpanes.implementation-standard.v1');
    expect(context).toContain('level: production-grade');
    expect(context).toContain('optimizationTarget: unnecessary-complexity');
    expect(context).toContain('authority: advisory only');
    expect(context.length).toBeLessThanOrEqual(WORKFLOW_ADVISORY_CONTEXT_LIMIT);
    expect(result.audit).toMatchObject({
      schema: 'ccpanes.workflow-advisory-audit.v1',
      taskId: 'task-advisory',
      routeId: 'production-gate',
      injected: true,
      reason: 'implementation_standard_available',
      promptLength: '扩展 hook runtime，要求生产级实现并更新测试'.length,
      contextLength: context.length
    });
  });

  test('does not inject context for documentation routes but records the decision', () => {
    const prompt = '只更新 README 文档，不修改代码';
    const result = createWorkflowAdvisory({
      task: task(tempRoot),
      event: {
        hook_event_name: 'UserPromptSubmit',
        cwd: tempRoot,
        prompt
      },
      now: '2026-08-14T01:00:00.000Z'
    });

    expect(result.output).toBeNull();
    expect(result.audit).toMatchObject({
      routeId: 'documentation',
      injected: false,
      reason: 'implementation_standard_not_applicable',
      promptSha256: createHash('sha256').update(prompt, 'utf8').digest('hex').toUpperCase()
    });
  });

  test('rejects an event cwd outside the task worktree', () => {
    const result = createWorkflowAdvisory({
      task: task(tempRoot),
      event: {
        hook_event_name: 'UserPromptSubmit',
        cwd: path.join(path.dirname(tempRoot), 'outside'),
        prompt: '修改代码'
      }
    });

    expect(result).toEqual({ output: null, audit: null });
  });

  test('appends privacy-preserving JSONL audit without raw prompt text', async () => {
    const prompt = '实现生产级队列 TOKEN_SHOULD_NOT_BE_STORED';
    const result = createWorkflowAdvisory({
      task: task(tempRoot),
      event: {
        hook_event_name: 'UserPromptSubmit',
        cwd: tempRoot,
        prompt
      },
      now: '2026-08-14T01:00:00.000Z'
    });
    const auditPath = path.join(tempRoot, 'audits', 'workflow-advisory-audit.jsonl');
    if (!result.audit) throw new Error('expected advisory audit');

    await appendWorkflowAdvisoryAudit(auditPath, result.audit);
    const text = await fs.readFile(auditPath, 'utf8');
    const record = JSON.parse(text.trim());

    expect(record.promptSha256).toBe(
      createHash('sha256').update(prompt, 'utf8').digest('hex').toUpperCase()
    );
    expect(text).not.toContain(prompt);
    expect(text).not.toContain('TOKEN_SHOULD_NOT_BE_STORED');
  });
});
