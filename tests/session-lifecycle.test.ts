import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createSessionStartHookOutput, createStopCheckHookOutput } from '../src/session-lifecycle.js';
import type { CurrentTask } from '../src/types.js';

function task(root: string): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: root,
    worktreeRoot: root,
    mainRepoRoot: null,
    branch: 'feature/task-alpha',
    head: 'abc123',
    owner: { leaderSessionId: 'leader-1', paneId: 'pane-1', layoutId: 'layout-1' },
    phase: 'verify',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'lifecycle fixture task'
  };
}

describe('SessionStart lifecycle output', () => {
  test('creates compact Codex additionalContext for the current task', () => {
    const root = 'D:/workspace/project-alpha';
    const output = createSessionStartHookOutput({
      task: task(root),
      taskPath: path.join(root, '.ccpanes-task', 'current-task.json'),
      auditRoot: 'D:/workspace/audits'
    });

    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(output.hookSpecificOutput.additionalContext).toContain('ccpanes-task-probe');
    expect(output.hookSpecificOutput.additionalContext).toContain('taskId: task-alpha');
    expect(output.hookSpecificOutput.additionalContext).toContain('phase: verify');
    expect(output.hookSpecificOutput.additionalContext).toContain('current-task.json');
    expect(output.hookSpecificOutput.additionalContext).toContain('post-tool-use-audit.jsonl');
    expect(output.hookSpecificOutput.additionalContext.length).toBeLessThan(1800);
  });
});

describe('Stop lifecycle output', () => {
  test('creates a non-blocking verification reminder without continuation decision', () => {
    const root = 'D:/workspace/project-alpha';
    const output = createStopCheckHookOutput({
      task: task(root),
      taskPath: path.join(root, '.ccpanes-task', 'current-task.json'),
      auditRoot: 'D:/workspace/audits'
    });

    expect(output.continue).toBe(true);
    expect(output).not.toHaveProperty('decision');
    expect(output).not.toHaveProperty('stopReason');
    expect(output.systemMessage).toContain('task-alpha');
    expect(output.systemMessage).toContain('npm test');
    expect(output.systemMessage).toContain('verify-acceptance');
    expect(output.systemMessage.length).toBeLessThan(1200);
  });
});
