import { classifyTaskRisk, type TaskRiskResult, type TaskRiskTier } from './task-risk.js';

export type WorkflowRouteId =
  | 'read-only-review'
  | 'project-bootstrap'
  | 'project-policy'
  | 'hook-runtime'
  | 'production-gate'
  | 'implementation'
  | 'documentation'
  | 'other';

export type WorkflowClosureBucket = 'none' | 'light' | 'full' | 'production';
export type WorkflowCheckPhase = 'local' | 'audit' | 'production';

export interface WorkflowRoute {
  id: WorkflowRouteId;
  label: string;
  reason: string;
}

export interface WorkflowClosureProfile {
  bucket: WorkflowClosureBucket;
  reason: string;
  requiresDiffStatus: boolean;
  requiresAcceptanceEvidence: boolean;
  requiresReferenceRepoStatus: boolean;
  requiresUserConfigSnapshot: boolean;
  requiresLiveVerification: boolean;
}

export interface WorkflowCheck {
  name: string;
  command: string;
  required: boolean;
  phase: WorkflowCheckPhase;
  reason: string;
}

export interface WorkflowProfileInput {
  prompt: string;
  cwd?: string | null;
  changedPaths?: string[] | null;
}

export interface WorkflowProfileResult {
  schema: 'ccpanes.workflow-profile.v1';
  route: WorkflowRoute;
  rigor: TaskRiskTier;
  risk: TaskRiskResult;
  closure: WorkflowClosureProfile;
  checks: WorkflowCheck[];
  gates: string[];
  boundaries: string[];
  changedPaths: string[];
  promptLength: number;
  cwd: string | null;
  sourceModel: {
    name: 'ccpanes.sba-adapted-workflow.v1';
    adaptedFrom: string;
    adoptedIdeas: string[];
  };
}

const routeLabels: Record<WorkflowRouteId, string> = {
  'read-only-review': 'Read-only review / comparison',
  'project-bootstrap': 'Project bootstrap and AGENTS entry',
  'project-policy': 'Project policy capture and enforcement rules',
  'hook-runtime': 'Hook runtime / adapter / lifecycle',
  'production-gate': 'Production gate / live config / release package',
  implementation: 'Implementation change inside the tool layer',
  documentation: 'Documentation or handoff maintenance',
  other: 'Other task'
};

const fullLocalChecks: WorkflowCheck[] = [
  { name: 'unit-tests', command: 'npm test', required: true, phase: 'local', reason: 'covers TypeScript behavior and CLI contracts' },
  { name: 'typecheck', command: 'npm run typecheck', required: true, phase: 'local', reason: 'falsifies type and public shape regressions' },
  { name: 'build', command: 'npm run build', required: true, phase: 'local', reason: 'proves dist/src/cli.js can be regenerated' },
  { name: 'smoke', command: 'npm run smoke', required: true, phase: 'local', reason: 'replays the main hook/tooling chain in a synthetic fixture' },
  { name: 'diff-check', command: 'git diff --check', required: true, phase: 'local', reason: 'catches whitespace and patch hygiene issues' },
  { name: 'status', command: 'git status --short --branch', required: true, phase: 'local', reason: 'proves scope and unrelated work are visible before delivery' }
];

const lightLocalChecks: WorkflowCheck[] = [
  { name: 'diff-check', command: 'git diff --check', required: true, phase: 'local', reason: 'documentation still needs patch hygiene' },
  { name: 'status', command: 'git status --short --branch', required: true, phase: 'local', reason: 'documents remaining changed files and scope' }
];

const productionChecks: WorkflowCheck[] = [
  ...fullLocalChecks,
  {
    name: 'installed-hooks',
    command: 'node dist/src/cli.js verify-installed-hooks --hooks-json C:\\Users\\AI001\\.codex\\hooks.json --prototype-root D:\\cc-pane\\tool\\experiments\\ccpanes-task-probe --audit-root D:\\cc-pane\\tool\\experiments\\ccpanes-task-probe\\live\\dynamic-audits --config C:\\Users\\AI001\\.codex\\config.toml',
    required: true,
    phase: 'production',
    reason: 'checks the real Codex hook registration contract without applying writes'
  },
  {
    name: 'live-consistency',
    command: 'node dist/src/cli.js verify-live-consistency --repo-root D:\\cc-pane\\tool\\repos\\hooks --live-root D:\\cc-pane\\tool\\experiments\\ccpanes-task-probe',
    required: true,
    phase: 'production',
    reason: 'hash-compares repo source/build surfaces against the live hook runtime after synchronization'
  },
  {
    name: 'acceptance-evidence',
    command: 'node dist/src/cli.js record-acceptance ... && node dist/src/cli.js verify-acceptance --input <acceptance.json>',
    required: true,
    phase: 'audit',
    reason: 'binds artifact hashes and checks to the current task before release'
  },
  {
    name: 'reference-repos',
    command: 'git -C D:\\cc-pane\\tool\\repos\\comet status --short && git -C D:\\cc-pane\\tool\\repos\\fastctx status --short',
    required: true,
    phase: 'audit',
    reason: 'proves reference repositories stayed clean'
  },
  {
    name: 'user-config-snapshots',
    command: 'record exists/bytes/mtimeUtc/SHA-256 before and after any approved user-config write',
    required: true,
    phase: 'production',
    reason: 'protects rollback and sensitive configuration boundaries'
  },
  {
    name: 'live-verification',
    command: 'cd D:\\cc-pane\\tool\\experiments\\ccpanes-task-probe && npm test && npm run typecheck && npm run build && npm run smoke',
    required: true,
    phase: 'production',
    reason: 'proves the live hook runtime matches the shipped behavior after synchronization'
  }
];

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/\s+/g, ' ').trim().toLowerCase();
}

function normalizePaths(paths: string[] | null | undefined): string[] {
  return [...new Set((paths ?? []).map((item) => item.trim()).filter((item) => item.length > 0))];
}

function anyPattern(values: string[], patterns: RegExp[]): boolean {
  return values.some((value) => patterns.some((pattern) => pattern.test(value)));
}

function allDocumentationPaths(paths: string[]): boolean {
  if (paths.length === 0) return false;
  return paths.every((rawPath) => {
    const value = normalize(rawPath);
    return (
      value.startsWith('docs/') ||
      value === 'readme.md' ||
      value === 'handoff.md' ||
      value === 'project-directory.md' ||
      value === 'acceptance.md' ||
      value === 'remote.md' ||
      value.endsWith('.md')
    );
  });
}

function hasFullGatePath(paths: string[]): boolean {
  return anyPattern(paths.map(normalize), [
    /^src\//,
    /^tests\//,
    /^scripts\//,
    /^templates\//,
    /^examples\/hook-/,
    /^package(-lock)?\.json$/,
    /^tsconfig\.json$/,
    /^vitest\.config\.ts$/
  ]);
}

function detectRoute(prompt: string, changedPaths: string[], risk: TaskRiskResult): WorkflowRoute {
  const text = normalize(prompt);
  const pathText = changedPaths.map(normalize).join(' ');
  const combined = `${text} ${pathText}`;

  if (
    risk.tier === 'heavy' &&
    (risk.dimensions.production ||
      risk.dimensions.touchesUserConfig ||
      risk.dimensions.externalSideEffect ||
      risk.dimensions.migration ||
      risk.dimensions.security ||
      risk.dimensions.breaksInterface)
  ) {
    return { id: 'production-gate', label: routeLabels['production-gate'], reason: 'heavy_risk_or_live_boundary_signal' };
  }

  if (/policy|策略|规则|禁止|允许|开放|放开|清除|解除限制|policy-capture/.test(combined)) {
    return { id: 'project-policy', label: routeLabels['project-policy'], reason: 'project_policy_signal' };
  }

  if (/bootstrap|agents|agents\.md|current-task|初始化|接入项目|项目接入/.test(combined)) {
    return { id: 'project-bootstrap', label: routeLabels['project-bootstrap'], reason: 'project_bootstrap_signal' };
  }

  if (/hook|pretooluse|posttooluse|permissionrequest|sessionstart|stop-check|lifecycle|adapter|门禁|审计|hook-enforce|permission-enforce/.test(combined)) {
    return { id: 'hook-runtime', label: routeLabels['hook-runtime'], reason: 'hook_runtime_signal' };
  }

  if (allDocumentationPaths(changedPaths) || /文档|readme|handoff|目录说明|设计记录|计划文档|docs/.test(combined)) {
    return { id: 'documentation', label: routeLabels.documentation, reason: 'documentation_signal' };
  }

  if (risk.signals.includes('explanatory-question') && changedPaths.length === 0) {
    return { id: 'read-only-review', label: routeLabels['read-only-review'], reason: 'read_only_explanatory_or_comparison' };
  }

  if (risk.dimensions.touchesCode || hasFullGatePath(changedPaths)) {
    return { id: 'implementation', label: routeLabels.implementation, reason: 'code_or_tooling_change_signal' };
  }

  return { id: 'other', label: routeLabels.other, reason: 'fallback_route' };
}

function closureFor(route: WorkflowRoute, risk: TaskRiskResult, changedPaths: string[]): WorkflowClosureProfile {
  if (route.id === 'production-gate' || risk.tier === 'heavy') {
    return {
      bucket: 'production',
      reason: 'heavy_or_live_boundary_requires_release_evidence',
      requiresDiffStatus: true,
      requiresAcceptanceEvidence: true,
      requiresReferenceRepoStatus: true,
      requiresUserConfigSnapshot: risk.dimensions.touchesUserConfig || risk.dimensions.production || risk.dimensions.externalSideEffect,
      requiresLiveVerification: risk.dimensions.production || risk.dimensions.touchesUserConfig || risk.dimensions.externalSideEffect
    };
  }

  if (route.id === 'read-only-review') {
    return {
      bucket: 'none',
      reason: 'read_only_no_mutation',
      requiresDiffStatus: false,
      requiresAcceptanceEvidence: false,
      requiresReferenceRepoStatus: false,
      requiresUserConfigSnapshot: false,
      requiresLiveVerification: false
    };
  }

  if (route.id === 'documentation' && allDocumentationPaths(changedPaths)) {
    return {
      bucket: 'light',
      reason: 'documentation_only_paths',
      requiresDiffStatus: true,
      requiresAcceptanceEvidence: false,
      requiresReferenceRepoStatus: false,
      requiresUserConfigSnapshot: false,
      requiresLiveVerification: false
    };
  }

  return {
    bucket: 'full',
    reason: hasFullGatePath(changedPaths) ? 'full_gate_path_changed' : 'standard_or_unclassified_mutation',
    requiresDiffStatus: true,
    requiresAcceptanceEvidence: true,
    requiresReferenceRepoStatus: true,
    requiresUserConfigSnapshot: false,
    requiresLiveVerification: false
  };
}

function checksFor(closure: WorkflowClosureProfile): WorkflowCheck[] {
  if (closure.bucket === 'production') return productionChecks;
  if (closure.bucket === 'full') return fullLocalChecks;
  if (closure.bucket === 'light') return lightLocalChecks;
  return [];
}

function gatesFor(route: WorkflowRoute, closure: WorkflowClosureProfile): string[] {
  const gates = [
    'current-task.json remains the task scope authority',
    'project-policy.json remains the executable allow/block authority',
    'task-risk and workflow-profile are advisory; hard writes still go through hook-enforce and permission-enforce'
  ];
  if (route.id === 'project-policy') {
    gates.push('policy.md is the human-readable ledger; policy.json is the mechanical matcher');
  }
  if (route.id === 'hook-runtime') {
    gates.push('new host payloads need synthetic fixture tests before real hook configuration changes');
  }
  if (closure.bucket === 'production') {
    gates.push('real user-config writes require exact approval package, backup path, SHA-256 snapshots, rollback command, and post-write verification');
  }
  if (closure.bucket === 'none') {
    gates.push('read-only tasks do not run mutation closure or AAR');
  }
  return gates;
}

function boundariesFor(route: WorkflowRoute, closure: WorkflowClosureProfile): string[] {
  const boundaries = [
    'do not modify user-level Codex, Claude, or CC-Panes config without explicit write approval',
    'do not execute skills-hub-hook.exe as part of ordinary repo maintenance',
    'do not write reference repositories except status/HEAD/hash inspection',
    'keep generated dist/ out of tracked source unless a release artifact explicitly owns it'
  ];
  if (route.id === 'read-only-review') {
    boundaries.push('read-only review must not mutate repo files, dependencies, git state, or user config');
  }
  if (closure.bucket === 'production') {
    boundaries.push('live synchronization is a separate gated step after repo checks and approval evidence');
  }
  return boundaries;
}

export function classifyWorkflowProfile(input: WorkflowProfileInput): WorkflowProfileResult {
  const changedPaths = normalizePaths(input.changedPaths);
  const risk = classifyTaskRisk({ prompt: input.prompt, cwd: input.cwd });
  const route = detectRoute(input.prompt, changedPaths, risk);
  const closure = closureFor(route, risk, changedPaths);
  return {
    schema: 'ccpanes.workflow-profile.v1',
    route,
    rigor: risk.tier,
    risk,
    closure,
    checks: checksFor(closure),
    gates: gatesFor(route, closure),
    boundaries: boundariesFor(route, closure),
    changedPaths,
    promptLength: input.prompt.length,
    cwd: input.cwd ?? null,
    sourceModel: {
      name: 'ccpanes.sba-adapted-workflow.v1',
      adaptedFrom: 'https://github.com/WoJiSama/skill-based-architecture',
      adoptedIdeas: ['progressive rigor', 'thin-shell routing', 'task closure', 'scenario testing']
    }
  };
}
