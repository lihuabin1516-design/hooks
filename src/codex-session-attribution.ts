import {
  isCodexPathInside,
  normalizeCodexPath
} from './codex-session-path.js';
import { boundCodexSessionPrivacyInput } from './codex-session-privacy.js';

export type RuntimeScope =
  | 'exact'
  | 'descendant'
  | 'ancestor'
  | 'unrelated'
  | 'unknown';

export type ProjectRelation =
  | 'owned'
  | 'supporting'
  | 'mentioned'
  | 'ambient'
  | 'unrelated'
  | 'unknown';

export type StorageState = 'active' | 'archived' | 'missing';
export type AppVisibility = 'listed' | 'readable-hidden' | 'unknown';

export const CODEX_SESSION_PROJECT_OWNER_INVARIANT_ERROR_CODE =
  'CODEX_SESSION_PROJECT_OWNER_INVARIANT' as const;

export type CodexSessionProjectOwnerInvariantReason =
  | 'project-invalid'
  | 'missing-owner'
  | 'owner-project-mismatch'
  | 'unexpected-owner';

export class CodexSessionProjectOwnerInvariantError extends Error {
  readonly code = CODEX_SESSION_PROJECT_OWNER_INVARIANT_ERROR_CODE;

  constructor(
    readonly threadId: string,
    readonly reason: CodexSessionProjectOwnerInvariantReason
  ) {
    super(
      `${CODEX_SESSION_PROJECT_OWNER_INVARIANT_ERROR_CODE}: ` +
      `${threadId}: ${reason}`
    );
    this.name = 'CodexSessionProjectOwnerInvariantError';
  }
}

export function projectOwnerForRelation(
  project: string | null,
  projectRelation: ProjectRelation
): string | null {
  return project && (
    projectRelation === 'owned' ||
    projectRelation === 'supporting'
  )
    ? project
    : null;
}

export function assertCodexSessionProjectOwnerInvariant(
  session: {
    threadId: string;
    projectRelation: ProjectRelation;
    projectOwner: string | null;
  },
  project: string
): void {
  const projectNorm = normalizeCodexPath(project);
  if (!projectNorm) {
    throw new CodexSessionProjectOwnerInvariantError(
      session.threadId,
      'project-invalid'
    );
  }

  const requiresOwner =
    session.projectRelation === 'owned' ||
    session.projectRelation === 'supporting';
  if (!requiresOwner) {
    if (session.projectOwner !== null) {
      throw new CodexSessionProjectOwnerInvariantError(
        session.threadId,
        'unexpected-owner'
      );
    }
    return;
  }

  if (!session.projectOwner?.trim()) {
    throw new CodexSessionProjectOwnerInvariantError(
      session.threadId,
      'missing-owner'
    );
  }
  if (normalizeCodexPath(session.projectOwner) !== projectNorm) {
    throw new CodexSessionProjectOwnerInvariantError(
      session.threadId,
      'owner-project-mismatch'
    );
  }
}

export type SessionEvidence =
  | { kind: 'task-binding'; projectPath: string; taskId: string }
  | { kind: 'ccpanes-launch'; projectPath: string; launchId: string }
  | { kind: 'ccpanes-session'; projectPath: string; sessionId: string }
  | { kind: 'cwd'; relation: 'exact' | 'descendant' | 'ancestor' }
  | { kind: 'primary-target'; target: string }
  | { kind: 'prompt-mention'; target: string }
  | { kind: 'delegation'; sourceThreadId: string };

export interface AttributionInput {
  project: string | null;
  cwdNorm: string | null;
  storageState: StorageState;
  threadSource: 'user' | 'subagent' | 'automation' | 'unknown';
  primaryTargetNorm: string | null;
  promptMentionsProject: boolean;
  taskBinding: {
    taskId: string;
    projectPathNorm: string;
  } | null;
  ccpanesLaunch: {
    launchId: string;
    projectPathNorm: string;
  } | null;
}

export interface AttributionResult {
  runtimeScope: RuntimeScope;
  projectRelation: ProjectRelation;
  relationConfidence: number;
  reasons: string[];
  evidence: SessionEvidence[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function promptContainsPathPattern(
  prompt: string,
  body: string,
  caseInsensitive: boolean
): boolean {
  const boundaryBefore = '(^|[^a-zA-Z0-9._-])';
  const boundaryAfter = '(?![a-zA-Z0-9._-])';
  return new RegExp(
    `${boundaryBefore}(?:${body})${boundaryAfter}`,
    caseInsensitive ? 'i' : ''
  ).test(prompt);
}

export function promptMentionsProjectPath(
  prompt: string | null,
  project: string | null
): boolean {
  if (!prompt || !project?.trim()) return false;
  const boundedPrompt = boundCodexSessionPrivacyInput(prompt).value;
  const projectNorm = normalizeCodexPath(project);
  if (!projectNorm) return false;

  const drive = /^([a-zA-Z]):\/(.*)$/.exec(projectNorm);
  if (drive) {
    const tail = drive[2]
      ? drive[2].split('/').map(escapeRegExp).join('[\\\\/]')
      : '';
    const driveBody = `${drive[1]}:[\\\\/]${tail}`;
    const wslBody = `/mnt/${drive[1]}${tail ? `/${tail.replaceAll('[\\\\/]', '/')}` : ''}`;
    return promptContainsPathPattern(boundedPrompt, driveBody, true) ||
      promptContainsPathPattern(boundedPrompt, wslBody, true);
  }

  if (projectNorm.startsWith('//')) {
    const uncBody = projectNorm
      .slice(2)
      .split('/')
      .map(escapeRegExp)
      .join('[\\\\/]');
    return promptContainsPathPattern(
      boundedPrompt,
      `[\\\\/]{2}${uncBody}`,
      true
    );
  }

  return projectNorm.startsWith('/') &&
    promptContainsPathPattern(boundedPrompt, escapeRegExp(projectNorm), false);
}

export function classifyRuntimeScope(
  cwdNorm: string | null,
  project: string | null
): RuntimeScope {
  if (!cwdNorm || !project?.trim()) return 'unknown';
  const projectNorm = normalizeCodexPath(project);
  const normalizedCwd = normalizeCodexPath(cwdNorm);
  if (!projectNorm || !normalizedCwd) return 'unknown';
  if (normalizedCwd === projectNorm) return 'exact';
  if (isCodexPathInside(projectNorm, normalizedCwd)) return 'descendant';
  if (isCodexPathInside(normalizedCwd, projectNorm)) return 'ancestor';
  return 'unrelated';
}

type ExplicitPathRelation = 'exact' | 'descendant' | 'conflict' | 'missing';

function classifyExplicitPath(
  projectNorm: string,
  candidate: string | null
): ExplicitPathRelation {
  if (!candidate?.trim()) return 'missing';
  const candidateNorm = normalizeCodexPath(candidate);
  if (!candidateNorm) return 'missing';
  if (candidateNorm === projectNorm) return 'exact';
  if (isCodexPathInside(projectNorm, candidateNorm)) return 'descendant';
  return 'conflict';
}

export function classifyProjectRelation(
  input: AttributionInput
): AttributionResult {
  const runtimeScope = classifyRuntimeScope(input.cwdNorm, input.project);
  const projectNorm = input.project?.trim()
    ? normalizeCodexPath(input.project)
    : '';
  const evidence: SessionEvidence[] = [];

  if (
    runtimeScope === 'exact' ||
    runtimeScope === 'descendant' ||
    runtimeScope === 'ancestor'
  ) {
    evidence.push({ kind: 'cwd', relation: runtimeScope });
  }
  if (input.primaryTargetNorm) {
    evidence.push({ kind: 'primary-target', target: input.primaryTargetNorm });
  }
  if (input.promptMentionsProject && projectNorm) {
    evidence.push({ kind: 'prompt-mention', target: projectNorm });
  }
  if (input.taskBinding) {
    evidence.push({
      kind: 'task-binding',
      projectPath: input.taskBinding.projectPathNorm,
      taskId: input.taskBinding.taskId
    });
  }
  if (input.ccpanesLaunch) {
    evidence.push({
      kind: 'ccpanes-launch',
      projectPath: input.ccpanesLaunch.projectPathNorm,
      launchId: input.ccpanesLaunch.launchId
    });
  }

  if (!projectNorm) {
    return {
      runtimeScope: 'unknown',
      projectRelation: 'unknown',
      relationConfidence: 0.1,
      reasons: ['project path is missing'],
      evidence
    };
  }

  const primaryTargetRelation = classifyExplicitPath(
    projectNorm,
    input.primaryTargetNorm
  );
  const taskRelation = classifyExplicitPath(
    projectNorm,
    input.taskBinding?.projectPathNorm ?? null
  );
  const launchRelation = classifyExplicitPath(
    projectNorm,
    input.ccpanesLaunch?.projectPathNorm ?? null
  );
  const ownershipReasons: string[] = [];
  if (taskRelation === 'exact') ownershipReasons.push('matched task binding');
  if (launchRelation === 'exact') {
    ownershipReasons.push('matched CC-Panes launch');
  }

  const conflictReasons: string[] = [];
  if (primaryTargetRelation === 'conflict') {
    conflictReasons.push('primary target conflicts with project');
  }
  if (taskRelation === 'conflict') {
    conflictReasons.push('task binding conflicts with project');
  }
  if (launchRelation === 'conflict') {
    conflictReasons.push('CC-Panes launch conflicts with project');
  }
  if (conflictReasons.length > 0) {
    return {
      runtimeScope,
      projectRelation: 'unrelated',
      relationConfidence: 0,
      reasons: [...conflictReasons, ...ownershipReasons],
      evidence
    };
  }

  if (ownershipReasons.length > 0) {
    return {
      runtimeScope,
      projectRelation: 'owned',
      relationConfidence: 1,
      reasons: ownershipReasons,
      evidence
    };
  }

  if (runtimeScope === 'exact' || runtimeScope === 'descendant') {
    const hasCompatibleTarget = [
      primaryTargetRelation,
      taskRelation,
      launchRelation
    ].some((relation) => relation === 'exact' || relation === 'descendant');
    return {
      runtimeScope,
      projectRelation: 'supporting',
      relationConfidence: hasCompatibleTarget ? 0.8 : 0.6,
      reasons: [
        `${runtimeScope} runtime cwd`,
        hasCompatibleTarget
          ? 'explicit target is compatible with project'
          : 'no strong ownership evidence'
      ],
      evidence
    };
  }

  if (input.promptMentionsProject) {
    return {
      runtimeScope,
      projectRelation: 'mentioned',
      relationConfidence: 0.35,
      reasons: ['prompt mentions project'],
      evidence
    };
  }

  if (runtimeScope === 'ancestor') {
    return {
      runtimeScope,
      projectRelation: 'ambient',
      relationConfidence: 0.2,
      reasons: ['runtime cwd is only a project ancestor'],
      evidence
    };
  }

  return {
    runtimeScope,
    projectRelation: runtimeScope === 'unrelated' ? 'unrelated' : 'unknown',
    relationConfidence: runtimeScope === 'unrelated' ? 0 : 0.1,
    reasons: ['no project ownership evidence'],
    evidence
  };
}

export function summarizeProjectRelations(records: Array<{
  projectRelation: ProjectRelation;
  storageState: StorageState;
  threadSource: AttributionInput['threadSource'];
}>) {
  const count = (
    predicate: (record: typeof records[number]) => boolean
  ): number => records.filter(predicate).length;

  return {
    defaultVisible: count((record) =>
      record.storageState === 'active' &&
      record.threadSource === 'user' &&
      (
        record.projectRelation === 'owned' ||
        record.projectRelation === 'supporting'
      )),
    owned: count((record) => record.projectRelation === 'owned'),
    supporting: count((record) => record.projectRelation === 'supporting'),
    mentioned: count((record) => record.projectRelation === 'mentioned'),
    ambient: count((record) => record.projectRelation === 'ambient'),
    archived: count((record) => record.storageState === 'archived'),
    subagents: count((record) => record.threadSource === 'subagent')
  };
}
