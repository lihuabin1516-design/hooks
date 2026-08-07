import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  addProjectPolicyRule,
  applyProjectPolicyToCall,
  clearProjectPolicyRules,
  createProjectPolicyRule,
  disableProjectPolicyRule,
  emptyProjectPolicy,
  projectPolicyPath,
  readProjectPolicy,
  readProjectPolicyOrEmpty,
  validateProjectPolicy,
  writeProjectPolicyAtomic
} from '../src/project-policy.js';
import type { CurrentTask, HookCall } from '../src/types.js';

function task(worktreeRoot = 'D:/cc-pane/project-alpha', phase: CurrentTask['phase'] = 'build'): CurrentTask {
  return {
    schema: 'ccpanes.task-selection.v1',
    taskId: 'task-alpha',
    workspace: 'cc-pane',
    projectPath: worktreeRoot,
    worktreeRoot,
    mainRepoRoot: null,
    branch: null,
    head: null,
    owner: { leaderSessionId: null, paneId: null, layoutId: null },
    phase,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:01.000Z',
    source: 'manual-import',
    notes: 'project-policy fixture task'
  };
}

describe('project policy', () => {
  test('validates policy rules and normalizes single-value match aliases', () => {
    const policy = validateProjectPolicy({
      schema: 'ccpanes.project-policy.v1',
      rules: [{
        id: 'allow-docs-shape',
        effect: 'allow',
        reason: 'user_allowed_docs',
        match: {
          tool: 'write',
          phase: 'shape',
          pathContains: 'docs/'
        }
      }]
    });

    expect(policy.rules[0]).toMatchObject({
      enabled: true,
      effect: 'allow',
      reason: 'user_allowed_docs',
      match: {
        tools: ['write'],
        phases: ['shape'],
        pathContains: ['docs/']
      }
    });
  });

  test('last matching rule wins for project-local block/open edits', () => {
    const policy = validateProjectPolicy({
      schema: 'ccpanes.project-policy.v1',
      rules: [
        {
          id: 'block-generated',
          effect: 'block',
          reason: 'user_blocked_generated_edits',
          match: { tools: ['write'], pathContains: ['generated'] }
        },
        {
          id: 'open-generated-fixture',
          effect: 'allow',
          reason: 'user_opened_generated_fixture',
          match: { tools: ['write'], pathContains: ['generated/fixture.ts'] }
        }
      ]
    });
    const call: HookCall = { tool: 'write', targetPath: 'D:/cc-pane/project-alpha/generated/fixture.ts', writes: true };

    expect(applyProjectPolicyToCall(task(), call, policy)).toMatchObject({
      policyEffect: 'allow',
      policyReason: 'user_opened_generated_fixture'
    });
  });

  test('matches shell commands by commandContains', () => {
    const policy = validateProjectPolicy({
      schema: 'ccpanes.project-policy.v1',
      rules: [{
        id: 'block-custom-shell',
        effect: 'block',
        reason: 'user_blocked_custom_shell',
        match: { tools: ['shell'], commandContains: ['publish-artifact'] }
      }]
    });
    const call: HookCall = {
      tool: 'shell',
      targetPath: 'D:/cc-pane/project-alpha',
      writes: false,
      command: 'node scripts/publish-artifact.mjs'
    };

    expect(applyProjectPolicyToCall(task(), call, policy)).toMatchObject({
      policyEffect: 'block',
      policyReason: 'user_blocked_custom_shell'
    });
  });

  test('missing policy file preserves current behavior input', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ccpanes-policy-'));

    await expect(readProjectPolicy(root)).resolves.toBeNull();
  });

  test('malformed policy fails closed through validation error', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ccpanes-policy-'));
    const policyDir = path.join(root, '.ccpanes-task');
    await mkdir(policyDir, { recursive: true });
    await writeFile(path.join(policyDir, 'policy.json'), JSON.stringify({
      schema: 'ccpanes.project-policy.v1',
      rules: [{ id: 'bad', effect: 'maybe', reason: 'bad' }]
    }), 'utf8');

    await expect(readProjectPolicy(root)).rejects.toThrow('effect must be allow or block');
  });

  test('creates, adds, disables, and clears rules without changing schema', () => {
    const rule = createProjectPolicyRule({
      id: 'block-publish',
      effect: 'block',
      reason: 'user_blocked_publish',
      match: { tools: ['shell'], commandContains: ['publish-artifact'] }
    });
    const added = addProjectPolicyRule(emptyProjectPolicy(), rule);
    const disabled = disableProjectPolicyRule(added, 'block-publish');
    const cleared = clearProjectPolicyRules(addProjectPolicyRule(disabled, createProjectPolicyRule({
      id: 'allow-docs',
      effect: 'allow',
      reason: 'user_opened_docs',
      match: { tools: ['apply_patch'], pathContains: ['docs/'], phases: ['shape'] }
    })));

    expect(added.rules).toHaveLength(1);
    expect(disabled.rules[0].enabled).toBe(false);
    expect(cleared.schema).toBe('ccpanes.project-policy.v1');
    expect(cleared.rules.every((candidate) => candidate.enabled === false)).toBe(true);
  });

  test('refuses duplicate rule ids unless replace is requested', () => {
    const rule = createProjectPolicyRule({
      id: 'block-publish',
      effect: 'block',
      reason: 'user_blocked_publish',
      match: { tools: ['shell'] }
    });
    const policy = addProjectPolicyRule(emptyProjectPolicy(), rule);

    expect(() => addProjectPolicyRule(policy, rule)).toThrow('rule already exists: block-publish');
    expect(addProjectPolicyRule(policy, { ...rule, reason: 'replacement' }, { replace: true }).rules[0].reason).toBe('replacement');
  });

  test('writes policy atomically under the project task directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ccpanes-policy-'));
    const policy = addProjectPolicyRule(emptyProjectPolicy(), createProjectPolicyRule({
      id: 'block-publish',
      effect: 'block',
      reason: 'user_blocked_publish',
      match: { tools: ['shell'] }
    }));

    await writeProjectPolicyAtomic(root, policy);
    await expect(readProjectPolicyOrEmpty(root)).resolves.toMatchObject(policy);
    expect(JSON.parse(await readFile(projectPolicyPath(root), 'utf8')).rules[0].id).toBe('block-publish');
  });
});
