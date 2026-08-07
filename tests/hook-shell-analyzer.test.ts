import { describe, expect, test } from 'vitest';
import { analyzeShellCommand } from '../src/hook-shell-analyzer.js';

const cwd = 'D:/cc-pane/project-alpha';

describe('analyzeShellCommand', () => {
  test('treats common verification commands as non-write shell calls', () => {
    expect(analyzeShellCommand({ command: 'npm test', cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: false }
    ]);
  });

  test('extracts PowerShell Set-Content path as a write target', () => {
    expect(analyzeShellCommand({ command: 'Set-Content -Path C:/Users/AI001/.codex/config.toml -Value x', cwd })).toEqual([
      { tool: 'shell', targetPath: 'C:/Users/AI001/.codex/config.toml', writes: true }
    ]);
  });

  test('extracts redirection target relative to cwd', () => {
    expect(analyzeShellCommand({ command: 'echo hello > src/out.txt', cwd })).toEqual([
      { tool: 'shell', targetPath: 'D:/cc-pane/project-alpha/src/out.txt', writes: true }
    ]);
  });

  test('classifies destructive reset before path policy', () => {
    expect(analyzeShellCommand({ command: 'git reset --hard HEAD', cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, policyReason: 'destructive_git_reset_hard' }
    ]);
  });

  test('classifies global dependency installation', () => {
    expect(analyzeShellCommand({ command: 'npm install -g some-tool', cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, policyReason: 'global_dependency_install' }
    ]);
  });

  test('classifies git push as external publication', () => {
    expect(analyzeShellCommand({ command: 'git push origin HEAD', cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, policyReason: 'external_publication_git_push' }
    ]);
  });

  test('classifies Node inline filesystem mutations', () => {
    expect(analyzeShellCommand({ command: `node -e "require('fs').unlinkSync('C:/Users/AI001/.codex/x.tmp')"`, cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, policyReason: 'interpreter_filesystem_mutation' }
    ]);
  });

  test('classifies Python inline filesystem mutations', () => {
    expect(analyzeShellCommand({ command: `python -c "open('C:/Users/AI001/.codex/x.tmp', 'w').write('x')"`, cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, policyReason: 'interpreter_filesystem_mutation' }
    ]);
  });
});
