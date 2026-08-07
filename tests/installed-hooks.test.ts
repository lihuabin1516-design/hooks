import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildExpectedHooksConfig, verifyInstalledHooks } from '../src/installed-hooks.js';

let tempRoot: string;
const legacyEvents = ['SessionStart', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop'];

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-installed-hooks-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('verifyInstalledHooks', () => {
  test('passes for a complete production hooks.json and trusted config.toml', async () => {
    const prototypeRoot = path.join(tempRoot, 'prototype');
    const auditRoot = path.join(tempRoot, 'audits');
    const hooksJsonPath = path.join(tempRoot, 'hooks.json');
    const configTomlPath = path.join(tempRoot, 'config.toml');
    await fs.writeFile(hooksJsonPath, `${JSON.stringify(buildExpectedHooksConfig({ prototypeRoot, auditRoot }), null, 2)}\n`, 'utf8');
    await fs.writeFile(configTomlPath, [
      "[hooks.state.'hooks.json:user_prompt_submit:0:0']",
      'trusted_hash = "sha256:user-prompt-skills"',
      "[hooks.state.'hooks.json:pre_tool_use:0:0']",
      'trusted_hash = "sha256:pre"',
      "[hooks.state.'hooks.json:permission_request:0:0']",
      'trusted_hash = "sha256:permission"',
      "[hooks.state.'hooks.json:post_tool_use:0:0']",
      'trusted_hash = "sha256:post"',
      "[hooks.state.'hooks.json:session_start:0:0']",
      'trusted_hash = "sha256:session"',
      "[hooks.state.'hooks.json:stop:0:0']",
      'trusted_hash = "sha256:stop"',
      ''
    ].join('\n'), 'utf8');

    const report = await verifyInstalledHooks({ hooksJsonPath, configTomlPath, prototypeRoot, auditRoot });

    expect(report.schema).toBe('ccpanes.installed-hooks.verify.v1');
    expect(report.mode).toBe('read-only');
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.discovered.map((item) => [item.name, item.event, item.installed])).toEqual([
      ['SessionStart', 'SessionStart', true],
      ['UserPromptSubmit skills-hub', 'UserPromptSubmit', true],
      ['UserPromptSubmit cc-panes prompt-before', 'UserPromptSubmit', true],
      ['PreToolUse', 'PreToolUse', true],
      ['PermissionRequest', 'PermissionRequest', true],
      ['PostToolUse', 'PostToolUse', true],
      ['Stop', 'Stop', true]
    ]);
    for (const event of legacyEvents) {
      expect(report.checks).toContainEqual(expect.objectContaining({ name: `${event} installed`, status: 'pass' }));
    }
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'UserPromptSubmit skills-hub trusted hash', status: 'pass' }));
    expect(report.checks).toContainEqual(expect.objectContaining({ name: 'UserPromptSubmit cc-panes prompt-before trusted hash advisory', status: 'pass' }));
  });

  test('fails when a required hook event is missing', async () => {
    const prototypeRoot = path.join(tempRoot, 'prototype');
    const auditRoot = path.join(tempRoot, 'audits');
    const hooksJsonPath = path.join(tempRoot, 'hooks.json');
    const hooks = buildExpectedHooksConfig({ prototypeRoot, auditRoot });
    delete hooks.hooks.Stop;
    await fs.writeFile(hooksJsonPath, `${JSON.stringify(hooks, null, 2)}\n`, 'utf8');

    const report = await verifyInstalledHooks({ hooksJsonPath, prototypeRoot, auditRoot });

    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.includes('Stop'))).toBe(true);
  });

  test('fails when the CC-Panes prompt-before UserPromptSubmit hook is missing', async () => {
    const prototypeRoot = path.join(tempRoot, 'prototype');
    const auditRoot = path.join(tempRoot, 'audits');
    const hooksJsonPath = path.join(tempRoot, 'hooks.json');
    const hooks = buildExpectedHooksConfig({ prototypeRoot, auditRoot });
    const userPromptSubmit = hooks.hooks.UserPromptSubmit;
    if (!Array.isArray(userPromptSubmit)) throw new Error('expected UserPromptSubmit fixture');
    hooks.hooks.UserPromptSubmit = userPromptSubmit.slice(0, 1);
    await fs.writeFile(hooksJsonPath, `${JSON.stringify(hooks, null, 2)}\n`, 'utf8');

    const report = await verifyInstalledHooks({ hooksJsonPath, prototypeRoot, auditRoot });

    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.includes('UserPromptSubmit cc-panes prompt-before installed'))).toBe(true);
  });

  test('finds a required command outside the first matcher group', async () => {
    const prototypeRoot = path.join(tempRoot, 'prototype');
    const auditRoot = path.join(tempRoot, 'audits');
    const hooksJsonPath = path.join(tempRoot, 'hooks.json');
    const hooks = buildExpectedHooksConfig({ prototypeRoot, auditRoot });
    const preToolUse = hooks.hooks.PreToolUse;
    if (!Array.isArray(preToolUse)) throw new Error('expected PreToolUse fixture');
    hooks.hooks.PreToolUse = [
      { matcher: '^noop$', hooks: [{ type: 'command', command: 'echo noop' }] },
      ...preToolUse
    ];
    await fs.writeFile(hooksJsonPath, `${JSON.stringify(hooks, null, 2)}\n`, 'utf8');

    const report = await verifyInstalledHooks({ hooksJsonPath, prototypeRoot, auditRoot });

    expect(report.passed).toBe(true);
    expect(report.discovered.find((item) => item.name === 'PreToolUse')).toEqual(expect.objectContaining({
      installed: true,
      groupIndex: 1,
      hookIndex: 0
    }));
  });

  test('fails when a hook command points at a different audit root', async () => {
    const prototypeRoot = path.join(tempRoot, 'prototype');
    const auditRoot = path.join(tempRoot, 'audits');
    const hooksJsonPath = path.join(tempRoot, 'hooks.json');
    const hooks = buildExpectedHooksConfig({ prototypeRoot, auditRoot: path.join(tempRoot, 'wrong-audits') });
    await fs.writeFile(hooksJsonPath, `${JSON.stringify(hooks, null, 2)}\n`, 'utf8');

    const report = await verifyInstalledHooks({ hooksJsonPath, prototypeRoot, auditRoot });

    expect(report.passed).toBe(false);
    expect(report.failures.some((failure) => failure.includes('audit-root'))).toBe(true);
  });
});
