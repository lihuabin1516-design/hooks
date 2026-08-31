import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readGitState } from './git-state.js';
import { validateCurrentTask } from './current-task.js';
import type { CurrentTask, GitState } from './types.js';

export const CONTEXT_CHECKPOINT_SCHEMA = 'ccpanes.context.v1';
export const CONTEXT_CHECKPOINT_MAX_CHARS = 24_000;

export interface ContextCheckpointInput {
  task: CurrentTask;
  git?: GitState | null;
  goalState?: string | null;
  workflowState?: string | null;
  workerState?: string | null;
  blockers?: string[];
  nextActions?: string[];
  completedMilestones?: string[];
  decisions?: string[];
  verificationEvidence?: string[];
  snapshotGeneration?: number;
  now?: string;
}

export interface ContextCheckpointResult {
  schema: 'ccpanes.context-checkpoint.v1';
  status: 'generated';
  snapshotGeneration: number;
  sha256: string;
  characters: number;
  outputPath?: string;
  content: string;
}

function cleanLines(values: readonly string[] | undefined, fallback: string): string[] {
  const lines = (values ?? [])
    .map((value) => value.replace(/\r?\n/gu, ' ').trim())
    .filter((value) => value.length > 0)
    .slice(0, 24);
  return lines.length > 0 ? lines : [fallback];
}

function safeScalar(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? '').replace(/\r?\n/gu, ' ').trim();
  return normalized.length > 0 ? normalized.slice(0, 512) : fallback;
}

function renderList(values: readonly string[] | undefined, fallback: string): string {
  return cleanLines(values, fallback).map((value) => `- ${value}`).join('\n');
}

function gitProjection(task: CurrentTask, git: GitState | null | undefined): GitState {
  return git ?? readGitState(task.worktreeRoot);
}

function checkpointContent(input: ContextCheckpointInput): string {
  const git = gitProjection(input.task, input.git);
  const generation = input.snapshotGeneration ?? 1;
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('snapshotGeneration must be a positive integer');
  }
  const content = [
    '# 上下文压缩后先读 `context.md`',
    '',
    '## 0. 快照元信息',
    '',
    '```yaml',
    `schema: ${CONTEXT_CHECKPOINT_SCHEMA}`,
    `snapshotGeneration: ${generation}`,
    'retentionPolicy: current-plus-two-previous',
    'source: authoritative-projection',
    `updatedAt: ${safeScalar(input.now, new Date().toISOString())}`,
    '```',
    '',
    '## 1. 当前任务',
    `- taskId: ${safeScalar(input.task.taskId, 'absent')}`,
    `- workspace: ${safeScalar(input.task.workspace, 'absent')}`,
    `- projectPath: ${safeScalar(input.task.projectPath, 'absent')}`,
    `- worktreeRoot: ${safeScalar(input.task.worktreeRoot, 'absent')}`,
    `- phase: ${safeScalar(input.task.phase, 'absent')}`,
    `- objective: ${safeScalar(input.task.notes, 'not-recorded')}`,
    '',
    '## 2. 当前进度',
    renderList(input.completedMilestones, 'No completed milestone was recorded.'),
    `- Goal: ${safeScalar(input.goalState, 'absent')}`,
    `- Workflow: ${safeScalar(input.workflowState, 'absent')}`,
    `- Worker: ${safeScalar(input.workerState, 'absent')}`,
    `- Git: ${git.branch ?? 'detached/absent'} @ ${git.head ? git.head.slice(0, 12) : 'absent'}; ${git.dirty ? 'dirty' : 'clean'}`,
    '',
    '## 3. 当前卡点',
    renderList(input.blockers, 'No active blocker was recorded.'),
    '',
    '## 4. 下一步',
    renderList(input.nextActions, 'Re-read authoritative state, inspect the diff, and run the required checks.'),
    '',
    '## 5. 上下文快照保留策略',
    '- Keep only context.md, context.prev.md, and context.prev2.md.',
    '- Rotate with the transaction-safe snapshot command; context.md is the commit point.',
    '- Treat this file as a recovery projection, not as Goal/Workflow/Session authority.',
    '',
    '## 6. 避坑点',
    '- Do not write the main worktree or absorb unrelated tracked/untracked changes.',
    '- Do not treat fake canary evidence as proof of real CC-Panes capability.',
    '- Do not copy tokens, prompts, rollout paths, raw Session IDs, or sensitive data into this file.',
    '- GPT-5.6 Sol workflow must not load superpower-series skills.',
    '',
    '## 7. 上下文压缩后的恢复步骤',
    '1. Read this file, then compare with the system-compressed context.',
    '2. Re-read AGENTS.md and the project handoff.',
    '3. Query Coordinator/CC-Panes/Git authorities; resolve conflicts in favor of the authority owner.',
    '4. Run the listed verification checks before continuing or claiming completion.',
    '',
    '## 8. 本轮增量',
    renderList(input.decisions, 'No new decision was recorded.'),
    '',
    '## 9. 更新检查清单',
    '- [ ] Task binding and worktree are still correct.',
    '- [ ] Goal/Workflow/Worker state was re-read from Coordinator.',
    '- [ ] Session/PTY state was re-read from official CC-Panes.',
    '- [ ] Git status, diff, and required checks were verified.',
    '- [ ] Acceptance evidence was written with real command output.',
    '',
    '## 10. 验证证据',
    renderList(input.verificationEvidence, 'No verification evidence was recorded in this checkpoint.'),
    ''
  ].join('\n');
  if (content.length > CONTEXT_CHECKPOINT_MAX_CHARS) {
    throw new Error(`context checkpoint exceeds ${CONTEXT_CHECKPOINT_MAX_CHARS} characters`);
  }
  return content;
}

export function generateContextCheckpoint(input: ContextCheckpointInput): ContextCheckpointResult {
  const content = checkpointContent(input);
  return {
    schema: 'ccpanes.context-checkpoint.v1',
    status: 'generated',
    snapshotGeneration: input.snapshotGeneration ?? 1,
    sha256: createHash('sha256').update(content, 'utf8').digest('hex').toUpperCase(),
    characters: content.length,
    content
  };
}

export async function generateContextCheckpointFromFile(input: {
  taskContextPath: string;
  outputPath?: string;
  snapshotGeneration?: number;
  now?: string;
  goalState?: string | null;
  workflowState?: string | null;
  workerState?: string | null;
  blockers?: string[];
  nextActions?: string[];
  completedMilestones?: string[];
  decisions?: string[];
  verificationEvidence?: string[];
}): Promise<ContextCheckpointResult> {
  const task = validateCurrentTask(JSON.parse(await fs.readFile(path.resolve(input.taskContextPath), 'utf8')));
  const result = generateContextCheckpoint({
    task,
    snapshotGeneration: input.snapshotGeneration,
    now: input.now,
    goalState: input.goalState,
    workflowState: input.workflowState,
    workerState: input.workerState,
    blockers: input.blockers,
    nextActions: input.nextActions,
    completedMilestones: input.completedMilestones,
    decisions: input.decisions,
    verificationEvidence: input.verificationEvidence
  });
  if (input.outputPath) {
    const outputPath = path.resolve(input.outputPath);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tempPath, result.content, 'utf8');
    await fs.rename(tempPath, outputPath);
    result.outputPath = outputPath;
  }
  return result;
}
