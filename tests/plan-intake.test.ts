import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createPlanIntake, normalizePlanLifecycleEvent, planIntakeAuditPathFromRoot, writePlanIntakeAuditAtomic } from '../src/plan-intake.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-plan-intake-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createPlanIntake', () => {
  test('previews policy capture and workflow profile without writing project policy files', async () => {
    const result = createPlanIntake({
      projectRoot: tempRoot,
      text: '计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。',
      prompt: '讨论上线方案前先收敛规则',
      changedPaths: ['src/plan-policy-capture.ts'],
      now: '2026-08-07T08:00:00.000Z'
    });

    expect(result).toMatchObject({
      schema: 'ccpanes.plan-intake.v1',
      mode: 'dry-run',
      changed: false,
      projectRoot: tempRoot,
      workflow: { route: { id: 'project-policy' } },
      policyPreview: {
        detectedCount: 1,
        wouldCaptureCount: 1,
        wouldClearCount: 0,
        wouldChangeProjectPolicy: true
      }
    });
    expect(result.policyPreview.actions[0]).toMatchObject({
      status: 'would_capture',
      effect: 'block',
      reason: 'plan_block_command',
      match: { tools: ['shell'], commandContains: ['deploy-artifact'] }
    });
    expect(result.recommendedNextCommands.some((command) => command.includes('policy-capture-plan'))).toBe(true);
    await expect(fs.stat(path.join(tempRoot, '.ccpanes-task', 'policy.json'))).rejects.toThrow();
    await expect(fs.stat(path.join(tempRoot, '.ccpanes-task', 'policy.md'))).rejects.toThrow();
  });

  test('returns skipped policy preview while still classifying workflow', () => {
    const result = createPlanIntake({
      projectRoot: tempRoot,
      text: '先梳理一下这个公开项目对我们有没有参考价值。',
      now: '2026-08-07T08:00:00.000Z'
    });

    expect(result.policyPreview).toMatchObject({
      detectedCount: 0,
      skippedCount: 1,
      wouldChangeProjectPolicy: false
    });
    expect(result.workflow.route.id).toBe('read-only-review');
    expect(result.workflow.closure.bucket).toBe('none');
    expect(result.recommendedNextCommands.some((command) => command.includes('policy-capture-plan'))).toBe(false);
  });
});

describe('writePlanIntakeAuditAtomic', () => {
  test('writes an explicit audit artifact atomically', async () => {
    const outPath = path.join(tempRoot, 'audit', 'plan-intake.json');
    const result = createPlanIntake({
      projectRoot: tempRoot,
      text: '允许 shape 阶段修改 docs/。',
      now: '2026-08-07T08:00:00.000Z'
    });

    await writePlanIntakeAuditAtomic(outPath, result);
    const audit = JSON.parse(await fs.readFile(outPath, 'utf8'));

    expect(audit.schema).toBe('ccpanes.plan-intake.v1');
    expect(audit.policyPreview.actions[0]).toMatchObject({
      status: 'would_capture',
      effect: 'allow',
      reason: 'plan_allow_path'
    });
  });
});

describe('normalizePlanLifecycleEvent', () => {
  test('normalizes CC-Panes plan lifecycle event fields for dry-run intake', () => {
    const result = normalizePlanLifecycleEvent({
      event: {
        schema: 'ccpanes.plan-lifecycle-event.v1',
        cwd: path.join(tempRoot, 'packages', 'demo'),
        prompt: 'event prompt',
        planText: '计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。',
        changedPaths: ['src/plan-intake.ts', ' src/plan-intake.ts '],
        source: 'cc-panes-plan'
      },
      fallbackPrompt: 'cli prompt',
      fallbackChangedPaths: ['src/cli.ts']
    });

    expect(result).toEqual({
      schema: 'ccpanes.plan-lifecycle-event.v1',
      cwd: path.join(tempRoot, 'packages', 'demo'),
      prompt: 'cli prompt',
      text: '计划阶段规则：禁止运行 deploy-artifact，除非我明确解除。',
      changedPaths: ['src/plan-intake.ts', 'src/cli.ts'],
      source: 'cc-panes-plan'
    });
  });

  test('builds the task-scoped plan intake audit path under audit-root', () => {
    expect(planIntakeAuditPathFromRoot(tempRoot, 'task-alpha')).toBe(
      path.join(tempRoot, Buffer.from('task-alpha', 'utf8').toString('base64url'), 'plan-intake-audit.json')
    );
  });

  test('rejects invalid lifecycle event schema at the boundary', () => {
    expect(() => normalizePlanLifecycleEvent({ event: { schema: 'wrong' } })).toThrow('invalid plan lifecycle event: schema');
  });
});
