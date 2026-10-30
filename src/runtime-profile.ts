export interface ReferenceRepoProfile {
  name: string;
  path: string;
}

export interface RuntimeProfile {
  name: 'paneforge-local';
  repoRoot: string;
  liveRoot: string;
  auditRoot: string;
  hooksJsonPath: string;
  configTomlPath: string;
  skillsHubHookPath: string;
  paneforgeCodexHookPath: string;
  referenceRepos: ReferenceRepoProfile[];
}

export const PANEFORGE_RUNTIME_PROFILE: RuntimeProfile = {
  name: 'paneforge-local',
  repoRoot: 'D:\\paneforge\\tool\\repos\\hooks',
  liveRoot: 'D:\\paneforge\\tool\\experiments\\paneforge-task-probe',
  auditRoot: 'D:\\paneforge\\tool\\experiments\\paneforge-task-probe\\live\\dynamic-audits',
  hooksJsonPath: 'C:\\Users\\AI001\\.codex\\hooks.json',
  configTomlPath: 'C:\\Users\\AI001\\.codex\\config.toml',
  skillsHubHookPath: 'C:\\Users\\AI001\\skills-hub\\bin\\skills-hub-hook.exe',
  paneforgeCodexHookPath: 'D:\\paneforge\\paneforge-main\\src-tauri\\binaries\\paneforge-cli-hook.exe',
  referenceRepos: [
    { name: 'comet', path: 'D:\\paneforge\\tool\\repos\\comet' },
    { name: 'fastctx', path: 'D:\\paneforge\\tool\\repos\\fastctx' },
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
