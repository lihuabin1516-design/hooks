import { describe, expect, test } from 'vitest';
import { classifyTaskRisk } from '../src/task-risk.js';

describe('classifyTaskRisk', () => {
  test('keeps explanatory questions light', () => {
    const result = classifyTaskRisk({ prompt: '解释一下这个 hooks 项目怎么工作？' });

    expect(result.schema).toBe('ccpanes.task-risk.v1');
    expect(result.tier).toBe('light');
    expect(result.reason).toBe('explanatory_question');
    expect(result.signals).toContain('explanatory-question');
  });

  test('classifies concrete code edits as standard', () => {
    const result = classifyTaskRisk({ prompt: '修改 src/foo.ts 里的解析逻辑' });

    expect(result.tier).toBe('standard');
    expect(result.reason).toBe('standard_code_task');
    expect(result.dimensions.touchesCode).toBe(true);
    expect(result.signals).toContain('code-object');
  });

  test('promotes high-risk production and user configuration prompts to heavy', () => {
    const prompts = [
      '部署生产环境并发布新版本',
      '迁移数据库 schema',
      '修改 C:/Users/AI001/.codex/config.toml 用户配置',
      '删除旧 endpoint，破坏 API 契约'
    ];

    for (const prompt of prompts) {
      const result = classifyTaskRisk({ prompt });
      expect(result.tier, prompt).toBe('heavy');
      expect(result.reason, prompt).toBe('heavy_risk_signal');
    }
  });

  test('detects prompts crossing multiple top-level packages', () => {
    const result = classifyTaskRisk({ prompt: '同时修改 frontend/src/app.ts 和 backend/src/api.ts' });

    expect(result.tier).toBe('standard');
    expect(result.dimensions.crossesPackages).toBe(true);
    expect(result.signals).toContain('crosses-packages');
  });

  test('does not treat blocked production commands in policy text as live production actions', () => {
    const result = classifyTaskRisk({ prompt: '计划阶段规则：禁止运行 publish-artifact，沉淀到 policy.json' });

    expect(result.tier).toBe('standard');
    expect(result.dimensions.production).toBe(false);
    expect(result.dimensions.externalSideEffect).toBe(false);
  });
});
