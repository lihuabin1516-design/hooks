import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { captureProjectPolicyInstruction } from '../src/project-policy-capture.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-policy-capture-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('captureProjectPolicyInstruction', () => {
  test('records a conversation instruction in policy.md and executable policy.json', async () => {
    const result = await captureProjectPolicyInstruction({
      projectRoot: tempRoot,
      id: 'block-publish',
      instruction: '禁止运行 publish-artifact，除非我明确解除。',
      effect: 'block',
      reason: 'user_blocked_publish',
      match: {
        tools: ['shell'],
        commandContains: ['publish-artifact']
      },
      now: '2026-08-07T04:00:00.000Z'
    });

    const ledger = await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.md'), 'utf8');
    const policy = JSON.parse(await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.json'), 'utf8'));

    expect(result).toMatchObject({
      schema: 'ccpanes.project-policy-capture-result.v1',
      changed: true,
      ruleId: 'block-publish',
      policyRuleCount: 1
    });
    expect(ledger).toContain('| 2026-08-07T04:00:00.000Z | 禁止运行 publish-artifact，除非我明确解除。 | block:user_blocked_publish | id=block-publish; match=tool:shell, command:publish-artifact |');
    expect(policy.rules).toEqual([
      {
        id: 'block-publish',
        enabled: true,
        effect: 'block',
        reason: 'user_blocked_publish',
        match: {
          tools: ['shell'],
          pathContains: [],
          commandContains: ['publish-artifact'],
          phases: [],
          reasons: []
        }
      }
    ]);
  });

  test('preserves existing ledger text and replaces an existing executable rule when requested', async () => {
    await fs.mkdir(path.join(tempRoot, '.ccpanes-task'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, '.ccpanes-task', 'policy.md'), '# Existing Policy\n\nKeep this line.\n', 'utf8');
    await captureProjectPolicyInstruction({
      projectRoot: tempRoot,
      id: 'allow-docs',
      instruction: '允许 shape 阶段改 docs。',
      effect: 'allow',
      reason: 'user_opened_docs',
      match: { tools: ['apply_patch'], pathContains: ['docs/'], phases: ['shape'] },
      now: '2026-08-07T04:00:00.000Z'
    });

    const result = await captureProjectPolicyInstruction({
      projectRoot: tempRoot,
      id: 'allow-docs',
      instruction: '允许 verify 阶段改 docs。',
      effect: 'allow',
      reason: 'user_opened_docs_verify',
      match: { tools: ['apply_patch'], pathContains: ['docs/'], phases: ['verify'] },
      replace: true,
      now: '2026-08-07T04:01:00.000Z'
    });

    const ledger = await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.md'), 'utf8');
    const policy = JSON.parse(await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.json'), 'utf8'));

    expect(result.ledgerChanged).toBe(true);
    expect(ledger).toContain('Keep this line.');
    expect(ledger).toContain('允许 shape 阶段改 docs。');
    expect(ledger).toContain('允许 verify 阶段改 docs。');
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0]).toMatchObject({
      id: 'allow-docs',
      effect: 'allow',
      reason: 'user_opened_docs_verify',
      match: { tools: ['apply_patch'], pathContains: ['docs/'], phases: ['verify'] }
    });
  });
});
