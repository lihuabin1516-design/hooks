import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  compareRuntimeIdentityToTaskHead,
  loadRuntimeIdentity,
  validateRuntimeIdentity,
  type RuntimeIdentity
} from '../src/runtime-identity.js';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paneforge-runtime-identity-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function identity(): RuntimeIdentity {
  return {
    schema: 'paneforge.runtime-identity.v1',
    packageName: 'paneforge-hooks-tooling',
    packageVersion: '0.1.0',
    gitCommit: 'abc123',
    gitDirty: false,
    buildSha256: 'A'.repeat(64),
    builtAt: '2026-09-15T00:00:00.000Z',
    source: 'build-manifest'
  };
}

describe('runtime identity', () => {
  test('loads a validated build manifest', async () => {
    const manifestPath = path.join(tempRoot, 'runtime-identity.json');
    await fs.writeFile(manifestPath, `${JSON.stringify(identity())}\n`, 'utf8');

    await expect(loadRuntimeIdentity(manifestPath)).resolves.toEqual(identity());
    expect(validateRuntimeIdentity(identity())).toEqual(identity());
  });

  test('reports an explicit stale runtime when task HEAD differs from the build commit', () => {
    expect(compareRuntimeIdentityToTaskHead(identity(), 'def456')).toEqual({
      expectedTaskHead: 'def456',
      runtimeGitCommit: 'abc123',
      status: 'mismatch',
      reason: 'runtime_commit_does_not_match_task_head'
    });
  });

  test('reports unknown instead of guessing when build metadata is unavailable', () => {
    expect(compareRuntimeIdentityToTaskHead({
      ...identity(),
      gitCommit: null,
      gitDirty: null,
      buildSha256: null,
      builtAt: null,
      source: 'unavailable'
    }, 'def456')).toMatchObject({
      status: 'unknown',
      reason: 'runtime_commit_unavailable'
    });
  });
});
