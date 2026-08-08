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
  });

  test('keeps documentation-only edits light', () => {
    const result = classifyWorkflowProfile({
      prompt: '更新 README 和 HANDOFF 的说明',
      changedPaths: ['README.md', 'HANDOFF.md', 'docs/plans/PHASE.md']
    });

    expect(result.route.id).toBe('documentation');
    expect(result.closure.bucket).toBe('light');
    expect(result.checks.map((check) => check.command)).toEqual(['git diff --check', 'git status --short --branch']);
  });

  test('routes policy-capture work to the project policy owner', () => {
    const result = classifyWorkflowProfile({
      prompt: '计划阶段规则：禁止运行 publish-artifact，沉淀到 policy.json',
      changedPaths: ['src/plan-policy-capture.ts', 'tests/plan-policy-capture.test.ts']
    });

    expect(result.route.id).toBe('project-policy');
    expect(result.closure.bucket).toBe('full');
    expect(result.gates).toContain('policy.md is the human-readable ledger; policy.json is the mechanical matcher');
  });
});
