import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  applySessionScopeAuthorizations,
  captureExplicitSessionScopeIntent,
  grantSessionScopeAuthorization,
  isExplicitAuthorizationPrompt,
  listSessionScopeAuthorizations,
  matchingSessionScopeAuthorization,
  readSessionScopeAuthorizations,
  revokeSessionScopeAuthorization,
  type SessionScopeAuthorizations
} from '../src/session-scope-authorization.js';
import type { CurrentTask, HookCall } from '../src/types.js';

const roots: string[] = [];

function createTask(worktreeRoot: string, taskId = 'task-alpha'): CurrentTask {
  return {
    schema: 'paneforge.task-selection.v1',
    taskId,
    workspace: 'test',
    projectPath: worktreeRoot,
    worktreeRoot,
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase: 'archive',
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    source: 'manual-import',
    notes: 'test'
  };
}

async function createRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paneforge-session-scope-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('session scope authorization', () => {
  test('recognizes natural explicit authorization but ignores discussion about authorization formats', async () => {
    const root = await createRoot();
    const worktreeRoot = path.join(root, 'project');
    await fs.mkdir(worktreeRoot);
    const task = createTask(worktreeRoot);
    const metaPrompt = '我明确授权，这种或者类似这种的格式进行触发，不要拦截我明确授权的这个格式。';
    const directPrompt = '我明确授权你继续处理刚才因 task 范围被拦的文件修改。';

    expect(isExplicitAuthorizationPrompt(metaPrompt)).toBe(false);
    expect(isExplicitAuthorizationPrompt('我没有授权你执行这个操作。')).toBe(false);
    expect(isExplicitAuthorizationPrompt('不要要求我说“我明确授权”这句话。')).toBe(false);
    expect(isExplicitAuthorizationPrompt(directPrompt)).toBe(true);
    expect(isExplicitAuthorizationPrompt('I explicitly authorize you to make this change.')).toBe(true);

    const intent = await captureExplicitSessionScopeIntent(task, {
      sessionId: 'session-alpha',
      prompt: directPrompt,
      now: new Date('2026-11-02T08:00:00.000Z')
    });
    const noIntent = await captureExplicitSessionScopeIntent(task, {
      sessionId: 'session-beta',
      prompt: metaPrompt,
      now: new Date('2026-11-02T08:00:00.000Z')
    });

    expect(intent).toMatchObject({
      taskId: task.taskId,
      sessionId: 'session-alpha',
      instruction: directPrompt
    });
    expect(noIntent).toBeNull();
  });

  test('grants only the selected tool and exact absolute path, then preserves revocation history', async () => {
    const root = await createRoot();
    const worktreeRoot = path.join(root, 'project');
    const target = path.join(root, 'release-note.md');
    await fs.mkdir(worktreeRoot);
    const task = createTask(worktreeRoot);
    const now = new Date('2026-11-02T08:00:00.000Z');
    const grant = await grantSessionScopeAuthorization(task, {
      paths: [{ path: target }],
      tools: ['edit'],
      reason: 'Apply the approved release note',
      instruction: 'I authorize editing the release note at this exact path.',
      now
    });
    const authorizations = await readSessionScopeAuthorizations(worktreeRoot);
    const editCall: HookCall = { tool: 'edit', targetPath: target, writes: true };

    expect(grant.expiresAt).toBe('2026-11-02T08:15:00.000Z');
    expect(matchingSessionScopeAuthorization(task, editCall, authorizations, now)).toEqual(grant);
    expect(matchingSessionScopeAuthorization(task, { ...editCall, targetPath: path.join(root, 'neighbor.md') }, authorizations, now)).toBeNull();
    expect(matchingSessionScopeAuthorization(task, { ...editCall, tool: 'write' }, authorizations, now)).toBeNull();

    const revoked = await revokeSessionScopeAuthorization(task, grant.id, new Date('2026-11-02T08:01:00.000Z'));
    const revokedState: SessionScopeAuthorizations = await readSessionScopeAuthorizations(worktreeRoot);
    expect(revoked.revokedAt).toBe('2026-11-02T08:01:00.000Z');
    expect(matchingSessionScopeAuthorization(task, editCall, revokedState, now)).toBeNull();
    expect((await listSessionScopeAuthorizations(task, now))[0]?.status).toBe('revoked');
  });

  test('applies a natural-language intent only to writes in its task and session', async () => {
    const root = await createRoot();
    const worktreeRoot = path.join(root, 'project');
    const outsideTarget = path.join(root, 'shared.md');
    await fs.mkdir(worktreeRoot);
    const task = createTask(worktreeRoot);
    const now = new Date('2026-11-02T08:00:00.000Z');
    await captureExplicitSessionScopeIntent(task, {
      sessionId: 'session-alpha',
      prompt: '我明确授权你继续处理刚才因范围限制被拦的文件修改。',
      now
    });
    const authorizations = await readSessionScopeAuthorizations(worktreeRoot);
    const call: HookCall = { tool: 'edit', targetPath: outsideTarget, writes: true };

    expect(applySessionScopeAuthorizations(task, [call], authorizations, 'session-alpha', now)[0]).toMatchObject({
      policyEffect: 'allow',
      policyReason: `session_scope_authorization:${authorizations.intents[0]?.id}`
    });
    expect(applySessionScopeAuthorizations(task, [call], authorizations, 'session-beta', now)[0]).toEqual(call);
    expect(applySessionScopeAuthorizations(task, [{ ...call, tool: 'shell' }], authorizations, 'session-alpha', now)[0]).toEqual({ ...call, tool: 'shell' });
    const protectedCall: HookCall = {
      ...call,
      targetPath: path.resolve('C:/Users/AI001/.codex/config.toml')
    };
    expect(applySessionScopeAuthorizations(task, [protectedCall], authorizations, 'session-alpha', now)[0]).toEqual(protectedCall);
  });

  test('serializes concurrent intent captures without dropping another session', async () => {
    const root = await createRoot();
    const worktreeRoot = path.join(root, 'project');
    await fs.mkdir(worktreeRoot);
    const task = createTask(worktreeRoot);
    const now = new Date('2026-11-02T08:00:00.000Z');

    await Promise.all(Array.from({ length: 6 }, (_, index) => captureExplicitSessionScopeIntent(task, {
      sessionId: `session-${index}`,
      prompt: `我明确授权你继续处理第 ${index} 项文件修改。`,
      now
    })));

    const authorizations = await readSessionScopeAuthorizations(worktreeRoot);
    expect(authorizations.intents.map((intent) => intent.sessionId).sort()).toEqual([
      'session-0', 'session-1', 'session-2', 'session-3', 'session-4', 'session-5'
    ]);
  });

  test('supports recursive directory grants and rejects expired or cross-task grants', async () => {
    const root = await createRoot();
    const worktreeRoot = path.join(root, 'project');
    const approvedDir = path.join(root, 'shared');
    await fs.mkdir(worktreeRoot);
    const task = createTask(worktreeRoot);
    const now = new Date('2026-11-02T08:00:00.000Z');
    const grant = await grantSessionScopeAuthorization(task, {
      paths: [{ path: approvedDir, recursive: true }],
      tools: ['write'],
      ttlMinutes: 1,
      reason: 'Update approved generated artifacts',
      instruction: 'I authorize updates below the shared generated artifacts directory.',
      now
    });
    const authorizations = await readSessionScopeAuthorizations(worktreeRoot);
    const nestedCall: HookCall = { tool: 'write', targetPath: path.join(approvedDir, 'nested', 'artifact.json'), writes: true };

    expect(matchingSessionScopeAuthorization(task, nestedCall, authorizations, now)).toEqual(grant);
    expect(matchingSessionScopeAuthorization(task, nestedCall, authorizations, new Date(now.getTime() + 60_000))).toBeNull();
    expect(matchingSessionScopeAuthorization(createTask(worktreeRoot, 'another-task'), nestedCall, authorizations, now)).toBeNull();
  });

  test('does not apply grants to shell calls or non-allow blast-radius results', async () => {
    const root = await createRoot();
    const worktreeRoot = path.join(root, 'project');
    const target = path.join(root, 'approved.txt');
    await fs.mkdir(worktreeRoot);
    const task = createTask(worktreeRoot);
    const now = new Date('2026-11-02T08:00:00.000Z');
    const authorizations = await grantSessionScopeAuthorization(task, {
      paths: [{ path: target }],
      tools: ['write'],
      reason: 'Update approved output',
      instruction: 'I authorize this exact output file.',
      now
    }).then(async () => readSessionScopeAuthorizations(worktreeRoot));
    const shellCall: HookCall = { tool: 'shell', targetPath: target, writes: true, command: 'some command' };
    const hazardCall: HookCall = {
      tool: 'write',
      targetPath: target,
      writes: true,
      destructiveAnalysis: {
        schema: 'paneforge.blast-radius-guard.v1',
        verdict: 'block',
        platform: 'windows',
        targets: [target],
        hazards: [],
        blastRadius: [],
        unknowns: []
      }
    };

    expect(matchingSessionScopeAuthorization(task, shellCall, authorizations, now)).toBeNull();
    expect(matchingSessionScopeAuthorization(task, hazardCall, authorizations, now)).toBeNull();
    expect(applySessionScopeAuthorizations(task, [shellCall, hazardCall], authorizations)).toEqual([shellCall, hazardCall]);
  });
});
