import { describe, expect, test } from 'vitest';
import { probeResume } from '../src/resume-probe.js';
import type { CurrentTask, GitState } from '../src/types.js';

function task(overrides: Partial<CurrentTask> = {}): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: 'D:/cc-pane/project-alpha',
    worktreeRoot: 'D:/cc-pane/project-alpha',
    mainRepoRoot: null,
    branch: 'feature/task-alpha',
    head: 'abc123',
    owner: { leaderSessionId: 'leader-1', paneId: 'pane-1', layoutId: 'layout-1' },
    phase: 'build',
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'leader',
    notes: 'fixture',
    ...overrides
  };
}

const cleanGit: GitState = {
  root: 'D:/cc-pane/project-alpha',
  branch: 'feature/task-alpha',
  head: 'abc123',
  dirty: false,
  statusShort: ''
};

describe('probeResume', () => {
  test('returns none for trivial messages with no candidates', () => {
    const result = probeResume({ utterance: '谢谢', currentSessionId: 'leader-1', tasks: [], gitStates: new Map() });
    expect(result.action).toBe('none');
    expect(result.reason).toBe('no_resume_intent');
  });

  test('returns auto_resume for one clean matching candidate', () => {
    const current = task();
    const result = probeResume({
      utterance: '继续',
      currentSessionId: 'leader-1',
      tasks: [current],
      gitStates: new Map([[current.worktreeRoot, cleanGit]])
    });
    expect(result.action).toBe('auto_resume');
    expect(result.reason).toBe('single_clean_matching_candidate');
    expect(result.candidates[0]?.ownerMatches).toBe(true);
  });

  test('returns ask_user for multiple candidates', () => {
    const first = task({ taskId: 'task-alpha', worktreeRoot: 'D:/cc-pane/project-alpha' });
    const second = task({ taskId: 'task-beta', worktreeRoot: 'D:/cc-pane/project-beta', owner: { leaderSessionId: null, paneId: null, layoutId: null } });
    const result = probeResume({
      utterance: '接着做',
      currentSessionId: 'leader-1',
      tasks: [first, second],
      gitStates: new Map([
        [first.worktreeRoot, cleanGit],
        [second.worktreeRoot, { ...cleanGit, root: second.worktreeRoot, branch: 'feature/task-beta' }]
      ])
    });
    expect(result.action).toBe('ask_user');
    expect(result.reason).toBe('multiple_candidates');
  });

  test('returns ask_user for dirty candidate', () => {
    const current = task();
    const result = probeResume({
      utterance: '继续',
      currentSessionId: 'leader-1',
      tasks: [current],
      gitStates: new Map([[current.worktreeRoot, { ...cleanGit, dirty: true, statusShort: ' M src/a.ts' }]])
    });
    expect(result.action).toBe('ask_user');
    expect(result.reason).toBe('dirty_worktree');
    expect(result.candidates[0]?.status).toBe('dirty');
  });

  test('returns out_of_scope when user explicitly starts unrelated work', () => {
    const current = task();
    const result = probeResume({ utterance: '新开一个无关任务', currentSessionId: 'leader-1', tasks: [current], gitStates: new Map([[current.worktreeRoot, cleanGit]]) });
    expect(result.action).toBe('out_of_scope');
    expect(result.reason).toBe('explicit_new_unrelated_work');
  });
});