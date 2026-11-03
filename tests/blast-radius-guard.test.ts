import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { analyzeBlastRadiusCommand } from '../src/blast-radius-guard.js';

function codes(command: string, platform: 'windows' | 'linux' | 'macos', cwd = '/workspace/project'): string[] {
  return analyzeBlastRadiusCommand({ command, platform, cwd }).hazards.map((hazard) => hazard.code);
}

describe('analyzeBlastRadiusCommand', () => {
  test('blocks a Windows volume-root delete', () => {
    const result = analyzeBlastRadiusCommand({
      command: 'rd /s /q C:\\',
      cwd: 'C:/workspace/project',
      platform: 'windows'
    });

    expect(result.verdict).toBe('block');
    expect(result.hazards.map((hazard) => hazard.code)).toContain('H2_DRIVE_ROOT');
  });

  test('blocks unresolved variables and root globs', () => {
    expect(codes('rm -rf "$UNSET/"*', 'linux')).toEqual(expect.arrayContaining(['H0_AMBIGUOUS', 'H8_GLOB_RECURSIVE']));
    expect(codes('rm -rf /*', 'linux')).toEqual(expect.arrayContaining(['H2_DRIVE_ROOT', 'H8_GLOB_RECURSIVE']));
    expect(codes('rm -rf /', 'linux')).toContain('H2_DRIVE_ROOT');
  });

  test('blocks Linux system prefixes and privileged wrappers', () => {
    expect(codes('rm -rf /usr', 'linux')).toEqual(expect.arrayContaining(['H11_SYSTEM_PREFIX', 'H9_PERMANENT_DELETE']));
    expect(codes('sudo bash -c "rm -rf /tmp/data"', 'linux')).toEqual(expect.arrayContaining(['H10_SUDO_DELETE']));
  });

  test('warns when a WSL shell targets a mounted Windows drive', () => {
    const result = analyzeBlastRadiusCommand({
      command: 'wsl rm -rf /mnt/d/data',
      cwd: '/workspace/project',
      platform: 'linux',
      wslContext: false
    });

    expect(result.hazards.map((hazard) => hazard.code)).toContain('H6_WSL_CROSS_FS');
  });

  test('recognizes destructive git and mirror commands', () => {
    expect(analyzeBlastRadiusCommand({ command: 'git clean -n', cwd: '/workspace/project', platform: 'linux' }).verdict).toBe('allow');
    expect(codes('git worktree remove ../other', 'linux')).toContain('H9_PERMANENT_DELETE');
    expect(codes('rsync -a --delete /src/ /backup/', 'linux')).toContain('H9_PERMANENT_DELETE');
  });

  test('counts a symlink in a recursive target when the host exposes one', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-guard-'));
    const target = path.join(root, 'target');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(target);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'data.txt'), 'data');
    try {
      fs.symlinkSync(outside, path.join(target, 'linked'), 'junction');
    } catch {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    }

    const result = analyzeBlastRadiusCommand({
      command: `rm -rf "${target}"`,
      cwd: root,
      platform: 'windows'
    });

    expect(result.blastRadius[0]?.reparsePoints).toBeGreaterThan(0);
    expect(result.hazards.map((hazard) => hazard.code)).toContain('H4_REPARSE_TRAVERSAL');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
