import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildExpectedHooksConfig, verifyInstalledHooks } from '../src/installed-hooks.js';

let tempRoot: string;

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
    expect(report.discovered.map((item) => [item.event, item.installed])).toEqual([
      ['SessionStart', true],
      ['PreToolUse', true],
      ['PermissionRequest', true],
      ['PostToolUse', true],
      ['Stop', true]
    ]);
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
