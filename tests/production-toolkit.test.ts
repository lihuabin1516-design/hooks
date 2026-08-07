import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createProductionToolkit } from '../src/production-toolkit.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-production-toolkit-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('createProductionToolkit', () => {
  test('generates a manifest and reviewable production scripts', async () => {
    const outDir = path.join(tempRoot, 'toolkit');
    const prototypeRoot = path.join(tempRoot, 'prototype');
    const auditRoot = path.join(tempRoot, 'audits');
    const hooksJsonPath = path.join(tempRoot, 'hooks.json');
    const configTomlPath = path.join(tempRoot, 'config.toml');

    const manifest = await createProductionToolkit({
      outDir,
      prototypeRoot,
      auditRoot,
      hooksJsonPath,
      configTomlPath,
      expectedUpstreamHookPath: 'C:/Users/AI001/skills-hub/bin/skills-hub-hook.exe',
      expectedUpstreamSha256: 'F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4',
      now: '2026-08-07T00:00:00.000Z'
    });

    expect(manifest.schema).toBe('ccpanes.production-toolkit-manifest.v1');
    expect(manifest.mode).toBe('reviewable-production-toolkit');
    expect(manifest.files.map((file) => file.kind).sort()).toEqual([
      'bootstrap-project',
      'install-hooks',
      'production-readme',
      'rollback-hooks',
      'verify-installed'
    ].sort());
    expect(manifest.expectedHooks.map((hook) => hook.event)).toEqual([
      'SessionStart',
      'PreToolUse',
      'PermissionRequest',
      'PostToolUse',
      'Stop'
    ]);

    const installScript = await fs.readFile(path.join(outDir, 'INSTALL-HOOKS.ps1'), 'utf8');
    const verifyScript = await fs.readFile(path.join(outDir, 'VERIFY-INSTALLED.ps1'), 'utf8');
    const bootstrapScript = await fs.readFile(path.join(outDir, 'BOOTSTRAP-PROJECT.ps1'), 'utf8');
    const rollbackScript = await fs.readFile(path.join(outDir, 'ROLLBACK-HOOKS.ps1'), 'utf8');
    const readme = await fs.readFile(path.join(outDir, 'PRODUCTION-README.md'), 'utf8');

    expect(installScript).toContain('Copy-Item');
    expect(installScript).toContain('hooks.json');
    expect(installScript).toContain('INSTALL-HOOKS');
    expect(verifyScript).toContain('verify-installed-hooks');
    expect(bootstrapScript).toContain('bootstrap-project');
    expect(rollbackScript).toContain('Rollback');
    expect(readme).toContain('SessionStart');
    expect(readme).toContain('AGENTS.md');
    expect(readme).toContain('bootstrap-report.json');
    expect(readme).toContain('Stop');
  });

  test('rejects output inside user config roots', async () => {
    await expect(createProductionToolkit({
      outDir: 'C:/Users/AI001/.codex/phase23-toolkit',
      prototypeRoot: tempRoot,
      auditRoot: path.join(tempRoot, 'audits'),
      hooksJsonPath: path.join(tempRoot, 'hooks.json')
    })).rejects.toThrow('invalid production toolkit output directory');
  });
});
