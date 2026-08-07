import type { CurrentTask, GitState, ResumeCandidate, ResumeProbeResult } from './types.js';

export interface ProbeInput {
  utterance: string;
  currentSessionId: string | null;
  tasks: CurrentTask[];
  gitStates: Map<string, GitState>;
  now?: string;
}

function hasResumeIntent(utterance: string): boolean {
  return /继续|接着|恢复|resume|continue/i.test(utterance);
}

function isExplicitNewWork(utterance: string): boolean {
  return /新开|无关任务|另一个任务|new unrelated|start new/i.test(utterance);
}

function toCandidate(task: CurrentTask, gitState: GitState | undefined, currentSessionId: string | null): ResumeCandidate {
  const missing = !gitState || gitState.root === null;
  return {
    taskId: task.taskId,
    worktreeRoot: task.worktreeRoot,
    branch: gitState?.branch ?? task.branch,
    head: gitState?.head ?? task.head,
    status: missing ? 'missing' : gitState.dirty ? 'dirty' : 'clean',
    ownerMatches: task.owner.leaderSessionId === null || task.owner.leaderSessionId === currentSessionId
  };
}

export function probeResume(input: ProbeInput): ResumeProbeResult {
  const candidates = input.tasks.map((task) => toCandidate(task, input.gitStates.get(task.worktreeRoot), input.currentSessionId));
  const checkedAt = input.now ?? new Date().toISOString();

  if (isExplicitNewWork(input.utterance)) {
    return { schema: 'ccpanes.resume-probe.v1', action: 'out_of_scope', reason: 'explicit_new_unrelated_work', candidates, checkedAt };
  }

  if (!hasResumeIntent(input.utterance) && candidates.length === 0) {
    return { schema: 'ccpanes.resume-probe.v1', action: 'none', reason: 'no_resume_intent', candidates, checkedAt };
  }

  if (candidates.length === 0) {
    return { schema: 'ccpanes.resume-probe.v1', action: 'none', reason: 'no_candidates', candidates, checkedAt };
  }

  if (candidates.length > 1) {
    return { schema: 'ccpanes.resume-probe.v1', action: 'ask_user', reason: 'multiple_candidates', candidates, checkedAt };
  }

  const only = candidates[0];
  if (!only) {
    return { schema: 'ccpanes.resume-probe.v1', action: 'none', reason: 'no_candidates', candidates, checkedAt };
  }
  if (only.status === 'missing') {
    return { schema: 'ccpanes.resume-probe.v1', action: 'ask_user', reason: 'missing_worktree', candidates, checkedAt };
  }
  if (!only.ownerMatches) {
    return { schema: 'ccpanes.resume-probe.v1', action: 'ask_user', reason: 'owner_mismatch', candidates, checkedAt };
  }
  if (only.status === 'dirty') {
    return { schema: 'ccpanes.resume-probe.v1', action: 'ask_user', reason: 'dirty_worktree', candidates, checkedAt };
  }

  return { schema: 'ccpanes.resume-probe.v1', action: 'auto_resume', reason: 'single_clean_matching_candidate', candidates, checkedAt };
}