import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { CurrentTask } from './types.js';

export type AcceptanceCheckResult = 'pass' | 'fail' | 'blocked' | 'not-run';

export interface AcceptanceCheck {
  name: string;
  command: string;
  result: AcceptanceCheckResult;
  evidence: string;
}

export interface ArtifactHash {
  path: string;
  sha256: string;
}

export interface AcceptanceEvidence {
  schema: 'ccpanes.acceptance.v1';
  taskId: string;
  worktreeRoot: string;
  branch: string | null;
  head: string | null;
  artifactHashes: ArtifactHash[];
  checks: AcceptanceCheck[];
  recordedAt: string;
}

export interface CreateAcceptanceEvidenceInput {
  task: CurrentTask;
  artifacts: string[];
  checks: Array<{ name: string; command: string; result: string; evidence: string }>;
  recordedAt?: string;
}

const validResults = new Set<AcceptanceCheckResult>(['pass', 'fail', 'blocked', 'not-run']);

function validateCheck(check: { name: string; command: string; result: string; evidence: string }): AcceptanceCheck {
  if (!validResults.has(check.result as AcceptanceCheckResult)) {
    throw new Error(`invalid acceptance check result: ${check.result}`);
  }
  return { ...check, result: check.result as AcceptanceCheckResult };
}

async function hashFile(filePath: string): Promise<ArtifactHash> {
  const bytes = await fs.readFile(filePath);
  return {
    path: filePath,
    sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase()
  };
}

export async function createAcceptanceEvidence(input: CreateAcceptanceEvidenceInput): Promise<AcceptanceEvidence> {
  const artifactHashes = await Promise.all(input.artifacts.map((artifact) => hashFile(artifact)));
  const checks = input.checks.map((check) => validateCheck(check));
  return {
    schema: 'ccpanes.acceptance.v1',
    taskId: input.task.taskId,
    worktreeRoot: input.task.worktreeRoot,
    branch: input.task.branch,
    head: input.task.head,
    artifactHashes,
    checks,
    recordedAt: input.recordedAt ?? new Date().toISOString()
  };
}