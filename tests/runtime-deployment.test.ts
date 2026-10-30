import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  computeRuntimeBuildSha256,
  deployRuntime,
  readRuntimeSourceGitState,
  recoverRuntime,
  rollbackRuntime,
  type RuntimeDeploymentPointer,
  type RuntimeRollbackPending,
  type RuntimeDeployPending
} from '../src/runtime-deployment.js';
import { runCli } from '../src/cli.js';

let tempRoot: string;
const execFileAsync = promisify(execFile);

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'paneforge-runtime-deployment-'));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function sourceBuild(name: string, _commit: string, dependencies: Record<string, string> = {}): Promise<string> {
  const sourceDir = path.join(tempRoot, `source-${name}`);
  const sourceRoot = path.join(sourceDir, 'dist', 'src');
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'package.json'), `${JSON.stringify({ name: `fixture-${name}`, version: '1.0.0', type: 'module', dependencies }, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(sourceDir, '.gitignore'), 'dist/\n', 'utf8');
  execFileSync('git', ['init'], { cwd: sourceDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Runtime Fixture'], { cwd: sourceDir });
  execFileSync('git', ['config', 'user.email', 'runtime@example.invalid'], { cwd: sourceDir });
  execFileSync('git', ['add', 'package.json', '.gitignore'], { cwd: sourceDir });
  execFileSync('git', ['commit', '-m', `fixture ${name}`], { cwd: sourceDir, stdio: 'ignore' });
  const actualCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceDir, encoding: 'utf8' }).trim();
  await fs.writeFile(path.join(sourceRoot, 'cli.js'), [
    `export const build = '${name}';`,
    `export async function runCli() { return '${name}\\n'; }`,
    'export function appendCliRuntimeError() {}',
    ''
  ].join('\n'), 'utf8');
  await fs.writeFile(path.join(sourceRoot, 'mcp-server.js'), `export const server = '${name}';\n`, 'utf8');
  const buildSha256 = await computeRuntimeBuildSha256(sourceRoot);
  await fs.writeFile(path.join(sourceRoot, 'runtime-identity.json'), `${JSON.stringify({
    schema: 'paneforge.runtime-identity.v1',
    packageName: 'paneforge-hooks-tooling',
    packageVersion: '0.1.0',
    gitCommit: actualCommit,
    gitDirty: false,
    buildSha256,
    builtAt: '2026-09-15T00:00:00.000Z',
    source: 'build-manifest'
  }, null, 2)}\n`, 'utf8');
  return sourceDir;
}

async function pointer(runtimeRoot: string, name: 'current.json' | 'previous.json'): Promise<RuntimeDeploymentPointer> {
  return JSON.parse(await fs.readFile(path.join(runtimeRoot, name), 'utf8'));
}

describe('versioned runtime deployment', () => {
  test('installs immutable releases, switches atomically, and is idempotent', async () => {
    const runtimeRoot = path.join(tempRoot, 'runtime');
    const sourceDir = await sourceBuild('one', 'a'.repeat(40));

    const first = await deployRuntime({ sourceDir, runtimeRoot, allowRoots: [tempRoot], now: '2026-09-15T00:00:01.000Z' });
    const repeated = await deployRuntime({ sourceDir, runtimeRoot, allowRoots: [tempRoot], now: '2026-09-15T00:00:02.000Z' });

    expect(first).toMatchObject({ schema: 'paneforge.runtime-deployment.v1', action: 'deploy', changed: true });
    expect(repeated).toMatchObject({ action: 'deploy', changed: false, releaseId: first.releaseId });
    expect((await pointer(runtimeRoot, 'current.json')).releaseId).toBe(first.releaseId);
    await expect(fs.readFile(path.join(first.releasePath, 'dist', 'src', 'cli.js'), 'utf8')).resolves.toContain("build = 'one'");
    await expect(fs.readFile(first.launcherPaths.cli, 'utf8')).resolves.toContain("current.json");
    await expect(fs.readFile(first.launcherPaths.mcpServer, 'utf8')).resolves.toContain("mcp-server.js");
    await expect(fs.stat(path.join(runtimeRoot, 'previous.json'))).rejects.toThrow();
  });

  test('rolls back to the previous verified release and preserves the displaced release', async () => {
    const runtimeRoot = path.join(tempRoot, 'runtime');
    const first = await deployRuntime({
      sourceDir: await sourceBuild('one', 'a'.repeat(40)),
      runtimeRoot,
      allowRoots: [tempRoot]
    });
    const second = await deployRuntime({
      sourceDir: await sourceBuild('two', 'b'.repeat(40)),
      runtimeRoot,
      allowRoots: [tempRoot]
    });
    expect((await execFileAsync(process.execPath, [second.launcherPaths.cli])).stdout).toBe('two\n');

    const rolledBack = await rollbackRuntime({ runtimeRoot, allowRoots: [tempRoot] });

    expect(rolledBack).toMatchObject({ action: 'rollback', changed: true, releaseId: first.releaseId });
    expect((await pointer(runtimeRoot, 'current.json')).releaseId).toBe(first.releaseId);
    expect((await pointer(runtimeRoot, 'previous.json')).releaseId).toBe(second.releaseId);
    expect((await execFileAsync(process.execPath, [rolledBack.launcherPaths.cli])).stdout).toBe('one\n');
    await expect(fs.stat(first.releasePath)).resolves.toBeTruthy();
    await expect(fs.stat(second.releasePath)).resolves.toBeTruthy();
  });

  test('rejects dirty builds and paths outside explicit allow roots without creating runtime state', async () => {
    const sourceDir = await sourceBuild('dirty', 'c'.repeat(40));
    const manifestPath = path.join(sourceDir, 'dist', 'src', 'runtime-identity.json');
    const identity = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    identity.gitDirty = true;
    await fs.writeFile(manifestPath, JSON.stringify(identity), 'utf8');
    const runtimeRoot = path.join(tempRoot, 'runtime');

    await expect(deployRuntime({ sourceDir, runtimeRoot, allowRoots: [tempRoot] })).rejects.toThrow('dirty runtime build');
    await expect(deployRuntime({ sourceDir, runtimeRoot, allowRoots: [path.join(tempRoot, 'other')] })).rejects.toThrow('outside allow roots');
    await expect(fs.stat(runtimeRoot)).rejects.toThrow();
  });

  test('rejects source Git drift and manifest commits that do not match source HEAD', async () => {
    const dirtySource = await sourceBuild('git-dirty', '5'.repeat(40));
    await fs.writeFile(path.join(dirtySource, 'package.json'), '{"name":"changed"}\n', 'utf8');
    await expect(deployRuntime({ sourceDir: dirtySource, runtimeRoot: path.join(tempRoot, 'dirty-runtime'), allowRoots: [tempRoot] }))
      .rejects.toThrow('runtime source Git worktree is dirty');

    const mismatchSource = await sourceBuild('head-mismatch', '6'.repeat(40));
    const manifestPath = path.join(mismatchSource, 'dist', 'src', 'runtime-identity.json');
    const identity = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    identity.gitCommit = '0'.repeat(40);
    await fs.writeFile(manifestPath, JSON.stringify(identity), 'utf8');
    await expect(deployRuntime({ sourceDir: mismatchSource, runtimeRoot: path.join(tempRoot, 'mismatch-runtime'), allowRoots: [tempRoot] }))
      .rejects.toThrow('runtime source Git HEAD does not match build identity');
  });

  test('rejects runtime release junctions and dependency-name traversal', async () => {
    const runtimeRoot = path.join(tempRoot, 'runtime');
    const outside = path.join(tempRoot, 'outside-runtime');
    await fs.mkdir(runtimeRoot, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, path.join(runtimeRoot, 'releases'), process.platform === 'win32' ? 'junction' : 'dir');
    const sourceDir = await sourceBuild('junction', '8'.repeat(40));

    await expect(deployRuntime({ sourceDir, runtimeRoot, allowRoots: [tempRoot] }))
      .rejects.toThrow(/symbolic link|resolves outside runtime root/);
    await expect(fs.readdir(outside)).resolves.toEqual([]);

    const traversalSource = await sourceBuild('dependency-traversal', '9'.repeat(40), { '../escape': '1.0.0' });
    await expect(deployRuntime({
      sourceDir: traversalSource,
      runtimeRoot: path.join(tempRoot, 'traversal-runtime'),
      allowRoots: [tempRoot]
    })).rejects.toThrow('invalid production dependency name');
  });

  test('fails closed when the deployment Git status probe errors', async () => {
    const sourceDir = await sourceBuild('git-probe', 'a'.repeat(40));
    expect(() => readRuntimeSourceGitState(sourceDir, (args, cwd) => {
      if (args[0] === 'status') throw new Error('synthetic status failure');
      return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    })).toThrow('runtime source Git status probe failed');
  });

  test('propagates dependency probe errors and rejects source changes during staging', async () => {
    const dependencySource = await sourceBuild('dependency-error', 'b'.repeat(40), { missing: '1.0.0' });
    const originalStat = fs.stat.bind(fs);
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (candidate, options) => {
      if (String(candidate).endsWith(path.join('node_modules', 'missing'))) {
        throw Object.assign(new Error('synthetic dependency I/O failure'), { code: 'EIO' });
      }
      return originalStat(candidate, options as never);
    });
    await expect(deployRuntime({
      sourceDir: dependencySource,
      runtimeRoot: path.join(tempRoot, 'dependency-error-runtime'),
      allowRoots: [tempRoot]
    })).rejects.toThrow('synthetic dependency I/O failure');
    statSpy.mockRestore();

    const changingSource = await sourceBuild('changing-source', 'c'.repeat(40));
    await expect(deployRuntime({
      sourceDir: changingSource,
      runtimeRoot: path.join(tempRoot, 'changing-runtime'),
      allowRoots: [tempRoot],
      afterFirstStage: async () => {
        await fs.appendFile(path.join(changingSource, 'package.json'), '\n', 'utf8');
      }
    })).rejects.toThrow(/payload changed during staging|worktree changed during staging/);
    await expect(fs.stat(path.join(tempRoot, 'changing-runtime', 'current.json'))).rejects.toThrow();
  });

  test('stable launcher and repeated deploy reject tampered non-JS package payload', async () => {
    const sourceDir = await sourceBuild('tamper', '7'.repeat(40));
    const runtimeRoot = path.join(tempRoot, 'runtime');
    const deployed = await deployRuntime({ sourceDir, runtimeRoot, allowRoots: [tempRoot] });
    await fs.appendFile(path.join(deployed.releasePath, 'package.json'), '\n', 'utf8');

    await expect(execFileAsync(process.execPath, [deployed.launcherPaths.cli])).rejects.toMatchObject({
      stderr: expect.stringContaining('runtime payload SHA-256 mismatch')
    });
    await expect(deployRuntime({ sourceDir, runtimeRoot, allowRoots: [tempRoot] }))
      .rejects.toThrow('runtime payload SHA-256 mismatch');
  });

  test('exposes guarded deployment through the release CLI', async () => {
    const sourceDir = await sourceBuild('cli-route', 'd'.repeat(40));
    const runtimeRoot = path.join(tempRoot, 'runtime');

    const report = JSON.parse(await runCli([
      'deploy-runtime',
      '--source-dir', sourceDir,
      '--runtime-root', runtimeRoot,
      '--allow-root', tempRoot
    ]));

    expect(report).toMatchObject({
      schema: 'paneforge.runtime-deployment.v1',
      action: 'deploy',
      changed: true,
      runtimeRoot
    });
    const recovery = JSON.parse(await runCli([
      'recover-runtime',
      '--runtime-root', runtimeRoot,
      '--allow-root', tempRoot
    ]));
    expect(recovery).toMatchObject({
      schema: 'paneforge.runtime-recovery.v1',
      recoveredAction: 'none',
      changed: false
    });
  });

  test('recover-runtime completes an interrupted rollback without source access', async () => {
    const runtimeRoot = path.join(tempRoot, 'runtime');
    const first = await deployRuntime({ sourceDir: await sourceBuild('one', 'e'.repeat(40)), runtimeRoot, allowRoots: [tempRoot] });
    const second = await deployRuntime({ sourceDir: await sourceBuild('two', 'f'.repeat(40)), runtimeRoot, allowRoots: [tempRoot] });
    const from = await pointer(runtimeRoot, 'current.json');
    const to = await pointer(runtimeRoot, 'previous.json');
    const pending: RuntimeRollbackPending = {
      schema: 'paneforge.runtime-rollback-pending.v1',
      from,
      to,
      startedAt: '2026-09-15T00:00:03.000Z'
    };
    await fs.writeFile(path.join(runtimeRoot, 'rollback-pending.json'), JSON.stringify(pending), 'utf8');
    await fs.writeFile(path.join(runtimeRoot, 'current.json'), JSON.stringify(to), 'utf8');

    const recovered = await recoverRuntime({ runtimeRoot, allowRoots: [tempRoot] });

    expect(recovered).toMatchObject({ recoveredAction: 'rollback', changed: true });
    expect(recovered.current?.releaseId).toBe(first.releaseId);
    expect((await pointer(runtimeRoot, 'current.json')).releaseId).toBe(first.releaseId);
    expect((await pointer(runtimeRoot, 'previous.json')).releaseId).toBe(second.releaseId);
    await expect(fs.stat(path.join(runtimeRoot, 'rollback-pending.json'))).rejects.toThrow();
  });

  test('serializes concurrent deployments into a valid current and previous order', async () => {
    const runtimeRoot = path.join(tempRoot, 'runtime');
    const sources = await Promise.all([
      sourceBuild('parallel-one', '1'.repeat(40)),
      sourceBuild('parallel-two', '2'.repeat(40))
    ]);

    const reports = await Promise.all(sources.map((sourceDir) => deployRuntime({ sourceDir, runtimeRoot, allowRoots: [tempRoot] })));
    const current = await pointer(runtimeRoot, 'current.json');
    const previous = await pointer(runtimeRoot, 'previous.json');
    const names = await fs.readdir(runtimeRoot);

    expect(current.releaseId).not.toBe(previous.releaseId);
    expect(new Set([current.releaseId, previous.releaseId])).toEqual(new Set(reports.map((report) => report.releaseId)));
    expect(names.some((name) => name.endsWith('.lock') || name.includes('-pending.json'))).toBe(false);
  });

  test('recovers an interrupted deployment after its source repository is removed', async () => {
    const runtimeRoot = path.join(tempRoot, 'runtime');
    const firstSource = await sourceBuild('recover-deploy-one', '3'.repeat(40));
    const secondSource = await sourceBuild('recover-deploy-two', '4'.repeat(40));
    await deployRuntime({ sourceDir: firstSource, runtimeRoot, allowRoots: [tempRoot] });
    const from = await pointer(runtimeRoot, 'current.json');
    await deployRuntime({ sourceDir: secondSource, runtimeRoot, allowRoots: [tempRoot] });
    const to = await pointer(runtimeRoot, 'current.json');
    await fs.writeFile(path.join(runtimeRoot, 'current.json'), JSON.stringify(from), 'utf8');
    const pending: RuntimeDeployPending = {
      schema: 'paneforge.runtime-deploy-pending.v1',
      from,
      to,
      startedAt: '2026-09-15T00:00:04.000Z'
    };
    await fs.writeFile(path.join(runtimeRoot, 'deploy-pending.json'), JSON.stringify(pending), 'utf8');
    await fs.rm(secondSource, { recursive: true, force: true });

    const recovered = await recoverRuntime({ runtimeRoot, allowRoots: [tempRoot] });

    expect(recovered).toMatchObject({ recoveredAction: 'deploy', changed: true });
    expect(recovered.current?.releaseId).toBe(to.releaseId);
    expect((await pointer(runtimeRoot, 'current.json')).releaseId).toBe(to.releaseId);
    expect((await pointer(runtimeRoot, 'previous.json')).releaseId).toBe(from.releaseId);
    await expect(fs.stat(path.join(runtimeRoot, 'deploy-pending.json'))).rejects.toThrow();
  });
});
