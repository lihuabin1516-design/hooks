import { describe, expect, test } from 'vitest';
import { analyzeShellCommand } from '../src/hook-shell-analyzer.js';

const cwd = 'D:/cc-pane/project-alpha';

describe('analyzeShellCommand', () => {
  test('treats common verification commands as non-write shell calls', () => {
    expect(analyzeShellCommand({ command: 'npm test', cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: false, command: 'npm test' }
    ]);
  });

  test.each([
    'npm run build',
    'git checkout feature/other',
    'git branch feature/new',
    'custom-executable --flag'
  ])('treats unproven shell command as write-capable: %s', (command) => {
    expect(analyzeShellCommand({ command, cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, command }
    ]);
  });

  test('treats output redirection on a read-only command as a write', () => {
    expect(analyzeShellCommand({ command: 'git status > status.txt', cwd })).toEqual([
      {
        tool: 'shell',
        targetPath: 'D:/cc-pane/project-alpha/status.txt',
        writes: true,
        command: 'git status > status.txt'
      }
    ]);
  });

  test('treats a compound command with a read-only prefix as write-capable', () => {
    expect(analyzeShellCommand({ command: 'npm test && npm install foo', cwd })).toEqual([
      {
        tool: 'shell',
        targetPath: cwd,
        writes: true,
        command: 'npm test && npm install foo'
      }
    ]);
  });

  test.each([
    'git status & npm install foo',
    'git diff --output=status.txt',
    'npm run lint -- --fix',
    'npm test -- --update'
  ])('does not treat a write-capable read-only prefix variant as read-only: %s', (command) => {
    expect(analyzeShellCommand({ command, cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, command }
    ]);
  });

  test('extracts PowerShell Set-Content path as a write target', () => {
    expect(analyzeShellCommand({ command: 'Set-Content -Path C:/Users/AI001/.codex/config.toml -Value x', cwd })).toEqual([
      { tool: 'shell', targetPath: 'C:/Users/AI001/.codex/config.toml', writes: true, command: 'Set-Content -Path C:/Users/AI001/.codex/config.toml -Value x' }
    ]);
  });

  test('extracts redirection target relative to cwd', () => {
    expect(analyzeShellCommand({ command: 'echo hello > src/out.txt', cwd })).toEqual([
      { tool: 'shell', targetPath: 'D:/cc-pane/project-alpha/src/out.txt', writes: true, command: 'echo hello > src/out.txt' }
    ]);
  });

  test('classifies destructive reset before path policy', () => {
    expect(analyzeShellCommand({ command: 'git reset --hard HEAD', cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, command: 'git reset --hard HEAD', policyReason: 'destructive_git_reset_hard' }
    ]);
  });

  test('classifies global dependency installation', () => {
    expect(analyzeShellCommand({ command: 'npm install -g some-tool', cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, command: 'npm install -g some-tool', policyReason: 'global_dependency_install' }
    ]);
  });

  test('classifies git push as external publication', () => {
    expect(analyzeShellCommand({ command: 'git push origin HEAD', cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, command: 'git push origin HEAD', policyReason: 'external_publication_git_push' }
    ]);
  });

  test('classifies Node inline filesystem mutations', () => {
    expect(analyzeShellCommand({ command: `node -e "require('fs').unlinkSync('C:/Users/AI001/.codex/x.tmp')"`, cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, command: `node -e "require('fs').unlinkSync('C:/Users/AI001/.codex/x.tmp')"`, policyReason: 'interpreter_filesystem_mutation' }
    ]);
  });

  test('classifies Python inline filesystem mutations', () => {
    expect(analyzeShellCommand({ command: `python -c "open('C:/Users/AI001/.codex/x.tmp', 'w').write('x')"`, cwd })).toEqual([
      { tool: 'shell', targetPath: cwd, writes: true, command: `python -c "open('C:/Users/AI001/.codex/x.tmp', 'w').write('x')"`, policyReason: 'interpreter_filesystem_mutation' }
    ]);
  });
});
