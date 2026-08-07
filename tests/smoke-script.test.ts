import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

function runNpmScript(scriptName: string): string {
  if (process.platform === 'win32') {
    return execFileSync('cmd.exe', ['/d', '/s', '/c', `npm run ${scriptName}`], { encoding: 'utf8' });
  }
  return execFileSync('npm', ['run', scriptName], { encoding: 'utf8' });
}

describe('production smoke script', () => {
  test('is wired into package.json', () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(packageJson.scripts.smoke).toBe('node scripts/smoke.mjs');
  });

  test('has a checked-in smoke runner', () => {
    expect(fs.existsSync(path.join('scripts', 'smoke.mjs'))).toBe(true);
  });

  test('runs the end-to-end CLI smoke suite', () => {
    runNpmScript('build');
    const output = runNpmScript('smoke');
    expect(output).toContain('SMOKE_PASS');
  }, 60000);
});
