import { describe, expect, test } from 'vitest';
import { classifyWorkflowProfile } from '../src/workflow-profile.js';

describe('classifyWorkflowProfile', () => {
  test('keeps comparison and evaluation prompts on a read-only route', () => {
    const result = classifyWorkflowProfile({
      prompt: '这个公开项目对于我们有没有参考价值？'
    });

    expect(result.schema).toBe('ccpanes.workflow-profile.v1');
    expect(result.route.id).toBe('read-only-review');
    expect(result.rigor).toBe('light');
    expect(result.closure.bucket).toBe('none');
    expect(result.checks).toEqual([]);
    expect(result.implementationStandard).toBeNull();
    expect(result.boundaries).toContain('read-only review must not mutate repo files, dependencies, git state, or user config');
  });

  test('routes hook runtime changes to full local gates', () => {
    const result = classifyWorkflowProfile({
      prompt: '扩展 hook-event-adapter，支持新的宿主事件',
      changedPaths: ['src/hook-event-adapter.ts', 'tests/hook-event-adapter.test.ts']
    });

    expect(result.route.id).toBe('hook-runtime');
    expect(result.closure.bucket).toBe('full');
    expect(result.checks.map((check) => check.command)).toContain('npm run smoke');
    expect(result.gates).toContain('new host payloads need synthetic fixture tests before real hook configuration changes');
    expect(result.implementationStandard).toMatchObject({
      schema: 'ccpanes.implementation-standard.v1',
      level: 'production-grade',
      optimizationTarget: 'unnecessary-complexity'
    });
  });

  test('promotes live config and production prompts to production gates', () => {
    const result = classifyWorkflowProfile({
      prompt: '修改 C:/Users/AI001/.codex/hooks.json 并上线真实 Codex hook',
      changedPaths: ['src/installed-hooks.ts', 'docs/CODEX-PLUGIN-DISTRIBUTION-NOTES.md']
    });

    expect(result.route.id).toBe('production-gate');
    expect(result.rigor).toBe('heavy');
    expect(result.closure).toMatchObject({
      bucket: 'production',
      requiresAcceptanceEvidence: true,
      requiresReferenceRepoStatus: true,
      requiresUserConfigSnapshot: true,
      requiresLiveVerification: true
    });
    expect(result.checks.map((check) => check.name)).toContain('installed-hooks');
    expect(result.checks.map((check) => check.name)).toContain('live-consistency');
    expect(result.checks.map((check) => check.name)).toContain('user-config-snapshots');
    expect(result.implementationStandard?.nonNegotiables).toContain('security, authorization, and privacy requirements');
  });

  test('keeps documentation-only edits light', () => {
    const result = classifyWorkflowProfile({
      prompt: '更新 README 和 HANDOFF 的说明',
      changedPaths: ['README.md', 'HANDOFF.md', 'docs/plans/PHASE.md']
    });

    expect(result.route.id).toBe('documentation');
    expect(result.closure.bucket).toBe('light');
    expect(result.checks.map((check) => check.command)).toEqual(['git diff --check', 'git status --short --branch']);
    expect(result.implementationStandard).toBeNull();
  });

  test('routes policy-capture work to the project policy owner', () => {
    const result = classifyWorkflowProfile({
      prompt: '计划阶段规则：禁止运行 publish-artifact，沉淀到 policy.json',
      changedPaths: ['src/plan-policy-capture.ts', 'tests/plan-policy-capture.test.ts']
    });

    expect(result.route.id).toBe('project-policy');
    expect(result.closure.bucket).toBe('full');
    expect(result.gates).toContain('policy.md is the human-readable ledger; policy.json is the mechanical matcher');
    expect(result.gates).toContain('.ccpanes-task/policy.json remains the executable allow/block authority');
    expect(result.implementationStandard?.level).toBe('production-grade');
  });

  test('keeps full production safeguards when the prompt asks for a minimal implementation', () => {
    const result = classifyWorkflowProfile({
      prompt: '实现最小版本，但必须达到生产级可靠性',
      changedPaths: ['src/feature.ts', 'tests/feature.test.ts']
    });

    expect(result.route.id).toBe('production-gate');
    expect(result.closure.bucket).toBe('production');
    expect(result.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      'unit-tests',
      'typecheck',
      'build',
      'smoke',
      'diff-check',
      'status',
      'acceptance-evidence',
      'reference-repos'
    ]));
    expect(result.implementationStandard).toMatchObject({
      level: 'production-grade',
      optimizationTarget: 'unnecessary-complexity'
    });
    expect(result.implementationStandard?.nonNegotiables).toEqual(expect.arrayContaining([
      'error semantics, unknown-outcome handling, recovery, and reconciliation',
      'logging, auditability, metrics, tracing, and operational observability',
      'tests, type checks, builds, smoke checks, and verification evidence'
    ]));
  });

  test.each([
    {
      id: 'project-bootstrap',
      input: {
        prompt: '初始化项目并接入 AGENTS.md',
        changedPaths: ['src/project-bootstrap.ts', 'tests/project-bootstrap.test.ts']
      },
      present: true
    },
    {
      id: 'implementation',
      input: {
        prompt: '实现 src/feature.ts 并更新测试',
        changedPaths: ['src/feature.ts', 'tests/feature.test.ts']
      },
      present: true
    },
    {
      id: 'other',
      input: {
        prompt: '整理一下思路',
        changedPaths: []
      },
      present: false
    }
  ])('attaches the implementation standard contract for the $id route', ({ id, input, present }) => {
    const result = classifyWorkflowProfile(input);

    expect(result.route.id).toBe(id);
    if (present) {
      expect(result.implementationStandard?.schema).toBe('ccpanes.implementation-standard.v1');
    } else {
      expect(result.implementationStandard).toBeNull();
    }
  });
});
