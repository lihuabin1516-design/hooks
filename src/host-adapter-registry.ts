export type HostAdapterId = 'codex' | 'ccpanes' | 'cursor' | 'gemini' | 'kimi' | 'opencode';

export type HostAdapterStatus = 'supported' | 'preview' | 'candidate';

export type HostAdapterSurfaceKind = 'hard-gate' | 'advisory' | 'audit' | 'state';

export interface HostAdapterSurface {
  kind: HostAdapterSurfaceKind;
  name: string;
  owner: string;
  status: HostAdapterStatus;
}

export interface HostAdapterVerification {
  name: string;
  command: string;
  requiredBeforeRealConfig: boolean;
}

export interface HostAdapter {
  id: HostAdapterId;
  label: string;
  status: HostAdapterStatus;
  integration: string;
  surfaces: HostAdapterSurface[];
  stateRoots: string[];
  auditArtifacts: string[];
  verification: HostAdapterVerification[];
  boundaries: string[];
}

export interface HostAdapterRegistry {
  schema: 'ccpanes.host-adapter-registry.v1';
  defaultHost: HostAdapterId;
  sourceModel: {
    name: 'ccpanes.vibe-inspired-host-adapters.v1';
    adaptedFrom: string[];
    adoptedIdeas: string[];
    rejectedIdeas: string[];
  };
  adapters: HostAdapter[];
}

const sharedBoundaries = [
  'current-task.json remains the task scope authority',
  '.ccpanes-task/policy.json remains the executable allow/block authority',
  'workflow profile and host registry are advisory unless consumed by hook-enforce or permission-enforce',
  'real user-config writes require a production approval package and rollback evidence'
];

const localVerification: HostAdapterVerification[] = [
  { name: 'unit-tests', command: 'npm test', requiredBeforeRealConfig: true },
  { name: 'typecheck', command: 'npm run typecheck', requiredBeforeRealConfig: true },
  { name: 'build', command: 'npm run build', requiredBeforeRealConfig: true },
  { name: 'smoke', command: 'npm run smoke', requiredBeforeRealConfig: true },
  { name: 'diff-check', command: 'git diff --check', requiredBeforeRealConfig: true }
];

const registry: HostAdapterRegistry = {
  schema: 'ccpanes.host-adapter-registry.v1',
  defaultHost: 'codex',
  sourceModel: {
    name: 'ccpanes.vibe-inspired-host-adapters.v1',
    adaptedFrom: [
      'https://github.com/foryourhealth111-pixel/Vibe-Skills/tree/main/adapters',
      'D:/cc-pane/tool/repos/hooks/docs/CCPANES-HOOK-HOST-ADAPTER-MATRIX.md'
    ],
    adoptedIdeas: [
      'one shared hook kernel with thin host-specific adapters',
      'machine-readable host capability records',
      'honest supported/preview/candidate status',
      'verification listed beside each host boundary'
    ],
    rejectedIdeas: [
      'do not import Vibe runtime',
      'do not import bundled skills',
      'do not promote advisory routing into hard-gate authority'
    ]
  },
  adapters: [
    {
      id: 'codex',
      label: 'Codex',
      status: 'supported',
      integration: 'Global Codex hooks point at live dist/src/cli.js; UserPromptSubmit chains skills-hub routing, CC-Panes lifecycle intake, and the workflow advisory.',
      surfaces: [
        { kind: 'hard-gate', name: 'PreToolUse', owner: 'hook-enforce', status: 'supported' },
        { kind: 'hard-gate', name: 'PermissionRequest', owner: 'permission-enforce', status: 'supported' },
        { kind: 'audit', name: 'PostToolUse', owner: 'post-enforce', status: 'supported' },
        { kind: 'advisory', name: 'UserPromptSubmit workflow advisory', owner: 'workflow-advisory', status: 'supported' },
        { kind: 'advisory', name: 'SessionStart', owner: 'session-start', status: 'supported' },
        { kind: 'advisory', name: 'Stop', owner: 'stop-check', status: 'supported' }
      ],
      stateRoots: ['<project>/.ccpanes-task', 'D:/cc-pane/tool/experiments/ccpanes-task-probe/live/dynamic-audits/<task>'],
      auditArtifacts: [
        'hook-enforce-audit.json',
        'permission-enforce-audit.json',
        'post-tool-use-audit.jsonl',
        'workflow-advisory-audit.jsonl'
      ],
      verification: [
        ...localVerification,
        {
          name: 'installed-hooks',
          command: 'node dist/src/cli.js verify-installed-hooks --hooks-json C:\\\\Users\\\\AI001\\\\.codex\\\\hooks.json --prototype-root D:\\\\cc-pane\\\\tool\\\\experiments\\\\ccpanes-task-probe --audit-root D:\\\\cc-pane\\\\tool\\\\experiments\\\\ccpanes-task-probe\\\\live\\\\dynamic-audits --config C:\\\\Users\\\\AI001\\\\.codex\\\\config.toml',
          requiredBeforeRealConfig: true
        }
      ],
      boundaries: [...sharedBoundaries, 'do not execute skills-hub-hook.exe during ordinary repo maintenance']
    },
    {
      id: 'ccpanes',
      label: 'Claude / CC-Panes',
      status: 'preview',
      integration: 'CC-Panes owns the outer lifecycle; this tool should first run as a dry-run substep before any real hook configuration write.',
      surfaces: [
        { kind: 'hard-gate', name: 'tool-before dry-run', owner: 'hook-runner', status: 'preview' },
        { kind: 'advisory', name: 'lifecycle context', owner: 'session-start', status: 'supported' },
        { kind: 'advisory', name: 'stop reminder', owner: 'stop-check', status: 'supported' }
      ],
      stateRoots: ['<project>/.ccpanes-task', '<cc-panes-profile>/task audit dir'],
      auditArtifacts: ['plan-intake audit JSON', 'hook-runner dry-run JSON'],
      verification: localVerification,
      boundaries: [...sharedBoundaries, 'collect real CC-Panes event fixtures before enabling hard writes']
    },
    {
      id: 'cursor',
      label: 'Cursor',
      status: 'candidate',
      integration: 'Future desktop host candidate; hook payload and native configuration surface still need fixture evidence.',
      surfaces: [
        { kind: 'advisory', name: 'risk tier', owner: 'classify-task-risk', status: 'supported' },
        { kind: 'advisory', name: 'workflow profile', owner: 'classify-workflow', status: 'supported' }
      ],
      stateRoots: ['<project>/.ccpanes-task'],
      auditArtifacts: ['future cursor hook dry-run JSON'],
      verification: localVerification,
      boundaries: [...sharedBoundaries, 'add synthetic Cursor event fixtures before real adapter enablement']
    },
    {
      id: 'gemini',
      label: 'Gemini CLI',
      status: 'candidate',
      integration: 'Launch may be managed by CC-Panes; native hook surface remains to be confirmed.',
      surfaces: [
        { kind: 'advisory', name: 'risk tier', owner: 'classify-task-risk', status: 'supported' },
        { kind: 'advisory', name: 'workflow profile', owner: 'classify-workflow', status: 'supported' }
      ],
      stateRoots: ['<project>/.ccpanes-task'],
      auditArtifacts: ['future gemini launch-profile dry-run JSON'],
      verification: localVerification,
      boundaries: [...sharedBoundaries, 'confirm Gemini event payloads before hard-gate mapping']
    },
    {
      id: 'kimi',
      label: 'Kimi CLI',
      status: 'candidate',
      integration: 'README-level CLI support only; hook payload mapping is not proven yet.',
      surfaces: [
        { kind: 'advisory', name: 'risk tier', owner: 'classify-task-risk', status: 'supported' },
        { kind: 'advisory', name: 'workflow profile', owner: 'classify-workflow', status: 'supported' }
      ],
      stateRoots: ['<project>/.ccpanes-task'],
      auditArtifacts: ['future kimi event fixture JSON'],
      verification: localVerification,
      boundaries: [...sharedBoundaries, 'collect real Kimi event fixtures before adapter enablement']
    },
    {
      id: 'opencode',
      label: 'OpenCode',
      status: 'candidate',
      integration: 'README-level CLI support only; plugin payload mapping is not proven yet.',
      surfaces: [
        { kind: 'advisory', name: 'risk tier', owner: 'classify-task-risk', status: 'supported' },
        { kind: 'advisory', name: 'workflow profile', owner: 'classify-workflow', status: 'supported' }
      ],
      stateRoots: ['<project>/.ccpanes-task'],
      auditArtifacts: ['future opencode plugin fixture JSON'],
      verification: localVerification,
      boundaries: [...sharedBoundaries, 'collect OpenCode plugin payload fixtures before adapter enablement']
    }
  ]
};

function cloneRegistry(): HostAdapterRegistry {
  return JSON.parse(JSON.stringify(registry)) as HostAdapterRegistry;
}

export function createHostAdapterRegistry(): HostAdapterRegistry {
  return validateHostAdapterRegistry(cloneRegistry());
}

export function getHostAdapter(id: string): HostAdapter | null {
  const normalized = id.trim().toLowerCase();
  return createHostAdapterRegistry().adapters.find((adapter) => adapter.id === normalized) ?? null;
}

export function validateHostAdapterRegistry(input: HostAdapterRegistry): HostAdapterRegistry {
  if (input.schema !== 'ccpanes.host-adapter-registry.v1') {
    throw new Error(`invalid host adapter registry schema: ${input.schema}`);
  }
  const ids = new Set<HostAdapterId>();
  for (const adapter of input.adapters) {
    if (ids.has(adapter.id)) throw new Error(`duplicate host adapter id: ${adapter.id}`);
    ids.add(adapter.id);
    if (adapter.surfaces.length === 0) throw new Error(`host adapter has no surfaces: ${adapter.id}`);
    if (adapter.verification.length === 0) throw new Error(`host adapter has no verification: ${adapter.id}`);
    if (adapter.boundaries.length === 0) throw new Error(`host adapter has no boundaries: ${adapter.id}`);
  }
  if (!ids.has(input.defaultHost)) {
    throw new Error(`default host adapter is missing: ${input.defaultHost}`);
  }
  return input;
}
