export type TaskPhase = 'shape' | 'build' | 'verify' | 'archive';
export type ResumeAction = 'none' | 'auto_resume' | 'ask_user' | 'out_of_scope';

export interface TaskOwner {
  leaderSessionId: string | null;
  paneId: string | null;
  layoutId: string | null;
}

export interface CurrentTask {
  schema: 'ccpanes.task-selection.v1';
  taskId: string;
  workspace: string;
  projectPath: string;
  worktreeRoot: string;
  mainRepoRoot: string | null;
  branch: string | null;
  head: string | null;
  owner: TaskOwner;
  phase: TaskPhase;
  createdAt: string;
  updatedAt: string;
  source: 'leader' | 'worker' | 'manual-import';
  notes: string;
}

export interface GitState {
  root: string | null;
  branch: string | null;
  head: string | null;
  dirty: boolean;
  statusShort: string;
}

export interface ResumeCandidate {
  taskId: string;
  worktreeRoot: string;
  branch: string | null;
  head: string | null;
  status: 'clean' | 'dirty' | 'missing';
  ownerMatches: boolean;
}

export interface ResumeProbeResult {
  schema: 'ccpanes.resume-probe.v1';
  action: ResumeAction;
  reason: string;
  candidates: ResumeCandidate[];
  checkedAt: string;
}

export interface HookCall {
  tool: 'read' | 'grep' | 'glob' | 'edit' | 'write' | 'apply_patch' | 'shell';
  targetPath: string | null;
  writes: boolean;
  policyReason?: string;
}

export interface HookDryRunDecision {
  action: 'allow' | 'block';
  reason: string;
  targetInsideWorktree: boolean;
  phase: TaskPhase;
}
