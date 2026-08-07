import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { capturePlanPolicyInstructions, detectPlanPolicyInstructions } from '../src/plan-policy-capture.js';
import { captureProjectPolicyInstruction } from '../src/project-policy-capture.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-plan-policy-capture-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('detectPlanPolicyInstructions', () => {
  test('detects explicit plan-stage command blocks and path openings', () => {
    const actions = detectPlanPolicyInstructions([
      '计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。',
      '允许 shape 阶段修改 docs/。'
    ].join('\n'));

    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      kind: 'capture',
      effect: 'block',
      reason: 'plan_block_command',
      match: { tools: ['shell'], commandContains: ['deploy-artifact'], phases: [] }
    });
    expect(actions[1]).toMatchObject({
      kind: 'capture',
      effect: 'allow',
      reason: 'plan_allow_path',
      match: { tools: ['edit', 'write', 'apply_patch'], pathContains: ['docs/'], phases: ['shape'] }
    });
  });
});

describe('capturePlanPolicyInstructions', () => {
  test('captures detected plan rules through policy.md and executable policy.json', async () => {
    const result = await capturePlanPolicyInstructions({
      projectRoot: tempRoot,
      text: '计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。',
      now: '2026-08-07T06:00:00.000Z'
    });
    const ledger = await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.md'), 'utf8');
    const policy = JSON.parse(await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.json'), 'utf8'));

    expect(result).toMatchObject({
      schema: 'ccpanes.plan-policy-capture-result.v1',
      changed: true,
      capturedCount: 1,
      clearedCount: 0,
      skippedCount: 0
    });
    expect(result.actions[0]).toMatchObject({ status: 'captured', effect: 'block', reason: 'plan_block_command' });
    expect(ledger).toContain('禁止运行 deploy-artifact');
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0]).toMatchObject({
      enabled: true,
      effect: 'block',
      reason: 'plan_block_command',
      match: { tools: ['shell'], commandContains: ['deploy-artifact'] }
    });
  });

  test('records plan clear instructions by disabling executable rules and appending the ledger', async () => {
    await captureProjectPolicyInstruction({
      projectRoot: tempRoot,
      id: 'block-publish',
      instruction: '禁止运行 publish-artifact。',
      effect: 'block',
      reason: 'user_blocked_publish',
      match: { tools: ['shell'], commandContains: ['publish-artifact'] },
      now: '2026-08-07T05:00:00.000Z'
    });

    const result = await capturePlanPolicyInstructions({
      projectRoot: tempRoot,
      text: '清除所有限制。',
      now: '2026-08-07T06:00:00.000Z'
    });
    const ledger = await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.md'), 'utf8');
    const policy = JSON.parse(await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.json'), 'utf8'));

    expect(result).toMatchObject({
      changed: true,
      capturedCount: 0,
      clearedCount: 1,
      skippedCount: 0
    });
    expect(result.actions[0]).toMatchObject({ status: 'cleared', disabledRuleCount: 1 });
    expect(ledger).toContain('清除所有限制');
    expect(ledger).toContain('clear:plan_cleared_policy');
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0].enabled).toBe(false);
  });

  test('reuses the same rule id for repeated plan captures without duplicating executable rules', async () => {
    const text = '禁止运行 deploy-artifact，除非我明确解除。';

    const first = await capturePlanPolicyInstructions({
      projectRoot: tempRoot,
      text,
      now: '2026-08-07T06:00:00.000Z'
    });
    const second = await capturePlanPolicyInstructions({
      projectRoot: tempRoot,
      text,
      now: '2026-08-07T06:01:00.000Z'
    });
    const policy = JSON.parse(await fs.readFile(path.join(tempRoot, '.ccpanes-task', 'policy.json'), 'utf8'));

    expect(second.actions[0].id).toBe(first.actions[0].id);
    expect(policy.rules).toHaveLength(1);
    expect(policy.rules[0].id).toBe(first.actions[0].id);
  });

  test('returns a no-match result without creating project policy files', async () => {
    const result = await capturePlanPolicyInstructions({
      projectRoot: tempRoot,
      text: '继续完善验收报告。',
      now: '2026-08-07T06:00:00.000Z'
    });

    expect(result).toMatchObject({
      changed: false,
      capturedCount: 0,
      clearedCount: 0,
      skippedCount: 1
    });
    await expect(fs.stat(path.join(tempRoot, '.ccpanes-task', 'policy.json'))).rejects.toThrow();
  });
});
