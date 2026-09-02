import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  analyzeStopCheckEvent,
  createSessionStartHookOutput,
  createStopCheckHookOutput,
  createTaskBindingMismatchSessionStartOutput,
  createTaskBindingMismatchStopOutput
} from '../src/session-lifecycle.js';
import type { CurrentTask, TaskBindingCheck } from '../src/types.js';
import type { BootstrapResult } from '../src/global-bootstrap.js';

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

const transcriptDirs = new Set<string>();

function bindingCheck(): TaskBindingCheck {
  return {
    schema: 'ccpanes.task-binding-check.v1',
    status: 'project-root-mismatch',
    reason: 'declared_project_path_or_main_repo_root_does_not_match_git_topology',
    cwd: 'D:/hooks-linked',
    gitRoot: 'D:/hooks-linked',
    gitCommonDir: 'D:/hooks-main/.git',
    canonicalProjectRoot: 'D:/hooks-main',
    taskPath: 'D:/hooks-linked/.ccpanes-task/current-task.json',
    taskFileRoot: 'D:/hooks-linked',
    declaredProjectPath: 'D:/hooks-linked',
    declaredWorktreeRoot: 'D:/hooks-linked',
    declaredMainRepoRoot: 'D:/hooks-linked',
    taskId: 'task-alpha'
  };
}

function writeTranscript(lines: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccpanes-stop-transcript-'));
  transcriptDirs.add(dir);
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return file;
}

afterEach(() => {
  for (const dir of transcriptDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  transcriptDirs.clear();
});

describe('SessionStart lifecycle output', () => {
  test('includes a bounded bootstrap status when supplied', () => {
    const root = 'D:/workspace/project-alpha';
    const bootstrap: BootstrapResult = {
      schema: 'ccpanes.bootstrap.v1',
      status: 'READY',
      cwd: root,
      taskId: 'task-alpha',
      projectPath: root,
      worktreeRoot: root,
      handoff: { path: path.join(root, 'HANDOFF.md'), exists: true },
      context: { path: path.join(root, 'context.md'), exists: true },
      coordinatorNamespace: 'alpha',
      reason: 'exact_worktree_binding_and_context_resolved',
      contextGenerations: [],
      verifiedFacts: [],
      unverifiedAssumptions: [],
      currentBlockers: [],
      taskScope: null,
      protectedPaths: [],
      recentAcceptanceEvidence: [],
      taskBinding: {
        status: 'resolved',
        source: 'registry',
        taskId: 'task-alpha',
        projectPath: root,
        worktreeRoot: root,
        handoffPath: path.join(root, 'HANDOFF.md'),
        contextPath: path.join(root, 'context.md'),
        coordinatorNamespace: 'alpha'
      },
      worktree: {
        cwd: root,
        root,
        gitRoot: root,
        gitCommonDir: path.join(root, '.git'),
        gitBranch: 'feature/task-alpha',
        gitHead: 'abc123',
        gitDirty: false,
        gitStatusShort: '',
        currentContextPath: path.join(root, 'context.md'),
        previousContextPath: path.join(root, 'context.prev.md'),
        previous2ContextPath: path.join(root, 'context.prev2.md')
      },
      auditDir: null,
      nextGate: 'MCP_DISCOVERY'
    };
    const output = createSessionStartHookOutput({
      task: task(root),
      taskPath: path.join(root, '.ccpanes-task', 'current-task.json'),
      bootstrap
    });

    expect(output.hookSpecificOutput.additionalContext).toContain('bootstrapStatus: READY');
    expect(output.hookSpecificOutput.additionalContext).toContain('bootstrapTaskBinding: RESOLVED');
    expect(output.hookSpecificOutput.additionalContext).toContain('bootstrapMcp: DISCOVER_REQUIRED');
  });

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

  test('creates mismatch context with canonical and active roots', () => {
    const output = createTaskBindingMismatchSessionStartOutput(bindingCheck());
    const context = output.hookSpecificOutput.additionalContext;

    expect(context).toContain('taskBindingStatus: project-root-mismatch');
    expect(context).toContain('canonicalProjectRoot: D:/hooks-main');
    expect(context).toContain('declaredWorktreeRoot: D:/hooks-linked');
    expect(context).toContain('verify-task-binding');
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

  test('creates a non-blocking mismatch Stop reminder', () => {
    const output = createTaskBindingMismatchStopOutput(bindingCheck());

    expect(output.continue).toBe(true);
    expect(output.systemMessage).toContain('verify-task-binding');
    expect(output.systemMessage).toContain('project-root-mismatch');
  });
});
