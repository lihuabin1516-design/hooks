import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { AcceptanceCheckResult, AcceptanceEvidence } from './acceptance.js';

export type ArtifactVerifyStatus = 'match' | 'mismatch' | 'missing';

export interface ArtifactVerifyResult {
  path: string;
  expectedSha256: string;
  actualSha256: string | null;
  status: ArtifactVerifyStatus;
}

export interface CheckVerifyResult {
  name: string;
  command: string;
  status: AcceptanceCheckResult;
  evidence: string;
}

export interface AcceptanceVerifyResult {
  schema: 'ccpanes.acceptance.verify.v1';
  taskId: string;
  passed: boolean;
  artifactResults: ArtifactVerifyResult[];
  checkResults: CheckVerifyResult[];
  failures: string[];
  verifiedAt: string;
}

async function hashExistingFile(filePath: string): Promise<string | null> {
  try {
    const bytes = await fs.readFile(filePath);
    return createHash('sha256').update(bytes).digest('hex').toUpperCase();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function verifyAcceptanceEvidence(evidence: AcceptanceEvidence, verifiedAt = new Date().toISOString()): Promise<AcceptanceVerifyResult> {
  const failures: string[] = [];
  const artifactResults: ArtifactVerifyResult[] = [];

  for (const artifact of evidence.artifactHashes) {
    const actualSha256 = await hashExistingFile(artifact.path);
    if (actualSha256 === null) {
      artifactResults.push({ path: artifact.path, expectedSha256: artifact.sha256, actualSha256, status: 'missing' });
      failures.push(`artifact missing: ${artifact.path}`);
    } else if (actualSha256 !== artifact.sha256) {
      artifactResults.push({ path: artifact.path, expectedSha256: artifact.sha256, actualSha256, status: 'mismatch' });
      failures.push(`artifact hash mismatch: ${artifact.path}`);
    } else {
      artifactResults.push({ path: artifact.path, expectedSha256: artifact.sha256, actualSha256, status: 'match' });
    }
  }

  const checkResults: CheckVerifyResult[] = evidence.checks.map((check) => ({
    name: check.name,
    command: check.command,
    status: check.result,
    evidence: check.evidence
  }));

  for (const check of checkResults) {
    if (check.status !== 'pass') {
      failures.push(`check not pass: ${check.name} (${check.status})`);
    }
  }

  return {
    schema: 'ccpanes.acceptance.verify.v1',
    taskId: evidence.taskId,
    passed: failures.length === 0,
    artifactResults,
    checkResults,
    failures,
    verifiedAt
  };
}