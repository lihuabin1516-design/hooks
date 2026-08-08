export interface ReferenceRepoProfile {
  name: string;
  path: string;
}

export interface RuntimeProfile {
  name: 'ccpanes-local';
  repoRoot: string;
  liveRoot: string;
  auditRoot: string;
  hooksJsonPath: string;
  configTomlPath: string;
  skillsHubHookPath: string;
  ccPanesCodexHookPath: string;
  referenceRepos: ReferenceRepoProfile[];
}

export const CCPANES_RUNTIME_PROFILE: RuntimeProfile = {
  name: 'ccpanes-local',
  repoRoot: 'D:\\cc-pane\\tool\\repos\\hooks',
  liveRoot: 'D:\\cc-pane\\tool\\experiments\\ccpanes-task-probe',
  auditRoot: 'D:\\cc-pane\\tool\\experiments\\ccpanes-task-probe\\live\\dynamic-audits',
  hooksJsonPath: 'C:\\Users\\AI001\\.codex\\hooks.json',
  configTomlPath: 'C:\\Users\\AI001\\.codex\\config.toml',
  skillsHubHookPath: 'C:\\Users\\AI001\\skills-hub\\bin\\skills-hub-hook.exe',
  ccPanesCodexHookPath: 'D:\\cc-pane\\cc-pane-main\\src-tauri\\binaries\\cc-panes-cli-hook.exe',
  referenceRepos: [
    { name: 'comet', path: 'D:\\cc-pane\\tool\\repos\\comet' },
    { name: 'fastctx', path: 'D:\\cc-pane\\tool\\repos\\fastctx' },
    { name: 'skills-hub', path: 'C:\\Users\\AI001\\skills-hub' }
  ]
};

export const DEFAULT_LIVE_CONSISTENCY_SOURCE_PREFIXES = [
  'src/',
  'tests/',
  'scripts/',
  'templates/'
];

export const DEFAULT_LIVE_CONSISTENCY_ROOT_FILES = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  'README.md',
  'PROJECT-DIRECTORY.md'
];
