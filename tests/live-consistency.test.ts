import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { verifyLiveConsistency } from '../src/live-consistency.js';

let tempRoot: string;
let repoRoot: string;
let liveRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ccpanes-live-consistency-'));
  repoRoot = path.join(tempRoot, 'repo');
  liveRoot = path.join(tempRoot, 'live');
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(liveRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const filePath = path.join(root, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function writeBoth(relativePath: string, text: string): Promise<void> {
  await write(repoRoot, relativePath, text);
  await write(liveRoot, relativePath, text);
}

function gitInitAndTrackAll(): void {
  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: repoRoot, stdio: 'ignore' });
}

describe('verifyLiveConsistency', () => {
  test('passes when tracked runtime files and dist files match live', async () => {
    await writeBoth('package.json', '{"name":"fixture"}\n');
    await writeBoth('src/cli.ts', 'export const cli = true;\n');
    await writeBoth('tests/cli.test.ts', 'export const testFixture = true;\n');
    await writeBoth('templates/AGENTS.ccpanes-hooks.md', '# template\n');
    await writeBoth('scripts/smoke.mjs', 'console.log("smoke");\n');
    await writeBoth('dist/src/cli.js', 'export const cli = true;\n');
    gitInitAndTrackAll();

    const report = await verifyLiveConsistency({ repoRoot, liveRoot, now: '2026-08-08T00:00:00.000Z' });

    expect(report.schema).toBe('ccpanes.live-consistency.verify.v1');
    expect(report.mode).toBe('read-only');
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
    expect(report.sourceFiles.every((file) => file.status === 'match')).toBe(true);
    expect(report.distFiles.every((file) => file.status === 'match')).toBe(true);
  });

  test('fails when a live source file hash differs from the repo copy', async () => {
    await writeBoth('package.json', '{"name":"fixture"}\n');
    await writeBoth('src/cli.ts', 'export const cli = true;\n');
    await writeBoth('dist/src/cli.js', 'export const cli = true;\n');
    await write(liveRoot, 'src/cli.ts', 'export const cli = false;\n');
    gitInitAndTrackAll();

    const report = await verifyLiveConsistency({ repoRoot, liveRoot });

    expect(report.passed).toBe(false);
    expect(report.sourceFiles).toContainEqual(expect.objectContaining({
      relativePath: 'src/cli.ts',
      status: 'mismatch'
    }));
    expect(report.failures.some((failure) => failure.includes('source files match live'))).toBe(true);
  });

  test('reports live-only runtime files as missing in repo', async () => {
    await writeBoth('package.json', '{"name":"fixture"}\n');
    await writeBoth('src/cli.ts', 'export const cli = true;\n');
    await writeBoth('dist/src/cli.js', 'export const cli = true;\n');
    await write(liveRoot, 'src/live-only.ts', 'export const liveOnly = true;\n');
    gitInitAndTrackAll();

    const report = await verifyLiveConsistency({ repoRoot, liveRoot });

    expect(report.passed).toBe(false);
    expect(report.sourceFiles).toContainEqual(expect.objectContaining({
      relativePath: 'src/live-only.ts',
      status: 'missing-repo'
    }));
  });
});
