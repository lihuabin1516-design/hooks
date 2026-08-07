import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { analyzeStopCheckEvent, createSessionStartHookOutput, createStopCheckHookOutput } from '../src/session-lifecycle.js';
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

function writeTranscript(lines: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccpanes-stop-transcript-'));
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return file;
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

  test('detects edited completion claims and emits a targeted reminder', () => {
    const root = 'D:/workspace/project-alpha';
    const transcriptPath = writeTranscript([
      { type: 'user', message: { content: [{ type: 'text', text: '修复 src/foo.ts' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/foo.ts' } }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '已修复，测试通过。' }] } }
    ]);
    const stopAnalysis = analyzeStopCheckEvent({ transcript_path: transcriptPath });
    const output = createStopCheckHookOutput({
      task: task(root),
      taskPath: path.join(root, '.ccpanes-task', 'current-task.json'),
      auditRoot: 'D:/workspace/audits',
      stopAnalysis
    });

    expect(stopAnalysis).toMatchObject({
      transcriptRead: true,
      parsed: true,
      hasEditToolUse: true,
      hasCompletionClaim: true,
      hasNotVerified: false,
      targetedReminder: true
    });
    expect(output.systemMessage).toContain('targeted verification reminder');
    expect(output.systemMessage).toContain('claim-specific checks');
    expect(output.systemMessage).toContain('NOT_VERIFIED');
  });

  test('keeps NOT_VERIFIED claims on the generic reminder path', () => {
    const transcriptPath = writeTranscript([
      { type: 'user', message: { content: [{ type: 'text', text: '修改 src/foo.ts' }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: 'src/foo.ts' } }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'NOT_VERIFIED: 缺少 npm test 证据。' }] } }
    ]);
    const stopAnalysis = analyzeStopCheckEvent({ transcript_path: transcriptPath });
    const output = createStopCheckHookOutput({
      task: task('D:/workspace/project-alpha'),
      taskPath: 'D:/workspace/project-alpha/.ccpanes-task/current-task.json',
      stopAnalysis
    });

    expect(stopAnalysis.hasNotVerified).toBe(true);
    expect(stopAnalysis.targetedReminder).toBe(false);
    expect(output.systemMessage).not.toContain('targeted verification reminder');
    expect(output.systemMessage).toContain('verify-acceptance');
  });

  test('falls back to the generic reminder when transcript is missing or unparsed', () => {
    const stopAnalysis = analyzeStopCheckEvent({ transcript_path: path.join(os.tmpdir(), 'missing-transcript.jsonl') });
    const output = createStopCheckHookOutput({
      task: task('D:/workspace/project-alpha'),
      taskPath: 'D:/workspace/project-alpha/.ccpanes-task/current-task.json',
      stopAnalysis
    });

    expect(stopAnalysis.targetedReminder).toBe(false);
    expect(output.systemMessage).not.toContain('targeted verification reminder');
    expect(output.systemMessage).toContain('npm run smoke');
  });
});
