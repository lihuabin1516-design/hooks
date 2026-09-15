import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isPathInside, normalizeForComparison } from './paths.js';
import { loadRuntimeIdentity, validateRuntimeIdentity, type RuntimeIdentity } from './runtime-identity.js';
import { readGitTopology } from './git-state.js';
import { withFileLock, writeTextFileAtomic } from './atomic-file.js';

export interface RuntimeDeploymentPointer {
  schema: 'ccpanes.runtime-deployment-pointer.v1';
  releaseId: string;
  releasePath: string;
  identity: RuntimeIdentity;
  packageIdentity: RuntimePackageIdentity;
  switchedAt: string;
}

export interface RuntimePackageIdentity {
  schema: 'ccpanes.runtime-package-identity.v1';
  payloadSha256: string;
  fileCount: number;
  generatedAt: string;
}

export interface RuntimeRollbackPending {
  schema: 'ccpanes.runtime-rollback-pending.v1';
  from: RuntimeDeploymentPointer;
  to: RuntimeDeploymentPointer;
  startedAt: string;
}

export interface RuntimeDeployPending {
  schema: 'ccpanes.runtime-deploy-pending.v1';
  from: RuntimeDeploymentPointer | null;
  to: RuntimeDeploymentPointer;
  startedAt: string;
}

export interface RuntimeDeploymentReport {
  schema: 'ccpanes.runtime-deployment.v1';
  action: 'deploy' | 'rollback';
  changed: boolean;
  runtimeRoot: string;
  releaseId: string;
  releasePath: string;
  previousReleaseId: string | null;
  identity: RuntimeIdentity;
  packageIdentity: RuntimePackageIdentity;
  launcherPaths: {
    cli: string;
    mcpServer: string;
  };
  completedAt: string;
}

export interface RuntimeRecoveryReport {
  schema: 'ccpanes.runtime-recovery.v1';
  action: 'recover';
  recoveredAction: 'deploy' | 'rollback' | 'none';
  changed: boolean;
  runtimeRoot: string;
  current: RuntimeDeploymentPointer | null;
  previous: RuntimeDeploymentPointer | null;
  launcherPaths: {
    cli: string;
    mcpServer: string;
  };
  completedAt: string;
}

export interface DeployRuntimeInput {
  sourceDir: string;
  runtimeRoot: string;
  allowRoots: string[];
  now?: string;
  afterFirstStage?: () => Promise<void>;
}

export interface RollbackRuntimeInput {
  runtimeRoot: string;
  allowRoots: string[];
  now?: string;
}

export interface RecoverRuntimeInput {
  runtimeRoot: string;
  allowRoots: string[];
  now?: string;
}

const packageIdentityName = 'runtime-package-identity.json';

function assertInsideAllowRoots(label: string, candidate: string, allowRoots: string[]): void {
  if (allowRoots.length === 0) throw new Error('missing allow roots');
  if (!allowRoots.some((root) => isPathInside(root, candidate))) {
    throw new Error(`${label} outside allow roots: ${candidate}`);
  }
}

async function assertRuntimePath(runtimeRoot: string, candidate: string): Promise<void> {
  const resolvedRoot = path.resolve(runtimeRoot);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`runtime path outside runtime root: ${candidate}`);
  }
  const filesystemRoot = path.parse(resolvedRoot).root;
  let current = filesystemRoot;
  const rootSegments = path.relative(filesystemRoot, resolvedRoot).split(path.sep).filter(Boolean);
  const candidateSegments = relative.length === 0 ? [] : relative.split(path.sep);
  for (const segment of [...rootSegments, ...candidateSegments]) {
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new Error(`runtime path contains symbolic link or junction: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
  if (!isPathInside(resolvedRoot, resolvedCandidate)) {
    throw new Error(`runtime path resolves outside runtime root: ${candidate}`);
  }
}

export type RuntimeGitRunner = (args: string[], cwd: string) => string;

const defaultRuntimeGitRunner: RuntimeGitRunner = (args, cwd) => execFileSync('git', args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
}).trim();

export function readRuntimeSourceGitState(sourceDir: string, runGit: RuntimeGitRunner = defaultRuntimeGitRunner): {
  root: string;
  head: string;
  statusShort: string;
} {
  const root = readGitTopology(sourceDir)?.worktreeRoot;
  if (!root || normalizeForComparison(root) !== normalizeForComparison(sourceDir)) {
    throw new Error('runtime source must be a Git worktree root');
  }
  let head: string;
  let statusShort: string;
  try {
    head = runGit(['rev-parse', 'HEAD'], sourceDir).trim();
  } catch (error) {
    throw new Error('runtime source Git HEAD probe failed', { cause: error });
  }
  try {
    statusShort = runGit(['status', '--short'], sourceDir).trim();
  } catch (error) {
    throw new Error('runtime source Git status probe failed', { cause: error });
  }
  if (!head) throw new Error('runtime source Git HEAD probe returned empty output');
  return { root, head, statusShort };
}

async function javascriptFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute);
  }
  return files.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

async function payloadFiles(root: string, current = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute).replace(/\\/g, '/');
    if (relative === packageIdentityName) continue;
    if (entry.isDirectory()) files.push(...await payloadFiles(root, absolute));
    else if (entry.isFile()) files.push(absolute);
    else throw new Error(`runtime payload contains unsupported entry: ${relative}`);
  }
  return files.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export async function computeRuntimePayload(sourceRoot: string): Promise<{ payloadSha256: string; fileCount: number }> {
  const digest = createHash('sha256');
  const files = await payloadFiles(sourceRoot);
  for (const filePath of files) {
    digest.update(path.relative(sourceRoot, filePath).replace(/\\/g, '/'));
    digest.update('\0');
    digest.update(await fs.readFile(filePath));
    digest.update('\0');
  }
  return { payloadSha256: digest.digest('hex').toUpperCase(), fileCount: files.length };
}

export async function computeRuntimeBuildSha256(sourceRoot: string): Promise<string> {
  const digest = createHash('sha256');
  for (const filePath of await javascriptFiles(sourceRoot)) {
    digest.update(path.relative(sourceRoot, filePath).replace(/\\/g, '/'));
    digest.update('\0');
    digest.update(await fs.readFile(filePath));
    digest.update('\0');
  }
  return digest.digest('hex').toUpperCase();
}

async function validatedBuild(sourceDir: string, verifyGitSource = false): Promise<RuntimeIdentity> {
  const sourceRoot = path.join(sourceDir, 'dist', 'src');
  const identity = await loadRuntimeIdentity(path.join(sourceRoot, 'runtime-identity.json'));
  if (identity.source !== 'build-manifest' || !identity.gitCommit || !identity.buildSha256) {
    throw new Error('runtime build identity is incomplete');
  }
  if (identity.gitDirty !== false) throw new Error('dirty runtime build cannot be deployed');
  const actualBuildSha256 = await computeRuntimeBuildSha256(sourceRoot);
  if (actualBuildSha256 !== identity.buildSha256) throw new Error('runtime build SHA-256 mismatch');
  if (verifyGitSource) {
    const gitState = readRuntimeSourceGitState(sourceDir);
    if (gitState.statusShort.length > 0) throw new Error('runtime source Git worktree is dirty');
    if (gitState.head.toLowerCase() !== identity.gitCommit.toLowerCase()) {
      throw new Error('runtime source Git HEAD does not match build identity');
    }
  }
  return identity;
}

function releaseId(identity: RuntimeIdentity, packageIdentity: RuntimePackageIdentity): string {
  return `${identity.gitCommit}-${identity.buildSha256}-${packageIdentity.payloadSha256}`.toLowerCase();
}

function validatePackageIdentityValue(value: unknown): RuntimePackageIdentity {
  const record = value as Partial<RuntimePackageIdentity>;
  if (!record || record.schema !== 'ccpanes.runtime-package-identity.v1'
    || typeof record.payloadSha256 !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(record.payloadSha256)
    || !Number.isSafeInteger(record.fileCount) || (record.fileCount ?? -1) < 0
    || typeof record.generatedAt !== 'string' || record.generatedAt.length === 0) {
    throw new Error('invalid runtime package identity');
  }
  return {
    schema: 'ccpanes.runtime-package-identity.v1',
    payloadSha256: record.payloadSha256.toUpperCase(),
    fileCount: record.fileCount,
    generatedAt: record.generatedAt
  } as RuntimePackageIdentity;
}

async function validatedRelease(releaseRoot: string): Promise<{ identity: RuntimeIdentity; packageIdentity: RuntimePackageIdentity }> {
  const identity = await validatedBuild(releaseRoot);
  const packageIdentity = validatePackageIdentityValue(JSON.parse(await fs.readFile(path.join(releaseRoot, packageIdentityName), 'utf8')));
  const actual = await computeRuntimePayload(releaseRoot);
  if (actual.payloadSha256 !== packageIdentity.payloadSha256 || actual.fileCount !== packageIdentity.fileCount) {
    throw new Error('runtime payload SHA-256 mismatch');
  }
  return { identity, packageIdentity };
}

function pointerPath(runtimeRoot: string, name: 'current' | 'previous'): string {
  return path.join(runtimeRoot, `${name}.json`);
}

async function readPointer(runtimeRoot: string, name: 'current' | 'previous'): Promise<RuntimeDeploymentPointer | null> {
  await assertRuntimePath(runtimeRoot, pointerPath(runtimeRoot, name));
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(pointerPath(runtimeRoot, name), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  return validatePointerValue(runtimeRoot, raw, name);
}

async function validatePointerValue(runtimeRoot: string, raw: unknown, label: string): Promise<RuntimeDeploymentPointer> {
  const value = raw as Partial<RuntimeDeploymentPointer>;
  if (!value || value.schema !== 'ccpanes.runtime-deployment-pointer.v1' || typeof value.releaseId !== 'string' || typeof value.releasePath !== 'string' || typeof value.switchedAt !== 'string') {
    throw new Error(`invalid runtime ${label} pointer`);
  }
  const expectedReleasePath = path.join(runtimeRoot, 'releases', value.releaseId);
  await assertRuntimePath(runtimeRoot, expectedReleasePath);
  if (normalizeForComparison(value.releasePath) !== normalizeForComparison(expectedReleasePath)) {
    throw new Error(`invalid runtime ${label} pointer release path`);
  }
  const { identity, packageIdentity } = await validatedRelease(expectedReleasePath);
  if (releaseId(identity, packageIdentity) !== value.releaseId) throw new Error(`invalid runtime ${label} pointer identity`);
  const pointerIdentity = validateRuntimeIdentity(value.identity);
  if (JSON.stringify(pointerIdentity) !== JSON.stringify(identity)) {
    throw new Error(`invalid runtime ${label} pointer embedded identity`);
  }
  const pointerPackageIdentity = validatePackageIdentityValue(value.packageIdentity);
  if (pointerPackageIdentity.payloadSha256 !== packageIdentity.payloadSha256
    || pointerPackageIdentity.fileCount !== packageIdentity.fileCount
    || pointerPackageIdentity.generatedAt !== packageIdentity.generatedAt) {
    throw new Error(`invalid runtime ${label} pointer package identity`);
  }
  return { ...value, identity, packageIdentity } as RuntimeDeploymentPointer;
}

async function writePointerAtomic(runtimeRoot: string, name: 'current' | 'previous', pointer: RuntimeDeploymentPointer): Promise<void> {
  await assertRuntimePath(runtimeRoot, pointerPath(runtimeRoot, name));
  await writeTextFileAtomic(pointerPath(runtimeRoot, name), `${JSON.stringify(pointer, null, 2)}\n`);
}

function rollbackPendingPath(runtimeRoot: string): string {
  return path.join(runtimeRoot, 'rollback-pending.json');
}

async function writeRollbackPendingAtomic(runtimeRoot: string, pending: RuntimeRollbackPending): Promise<void> {
  await assertRuntimePath(runtimeRoot, rollbackPendingPath(runtimeRoot));
  await writeTextFileAtomic(rollbackPendingPath(runtimeRoot), `${JSON.stringify(pending, null, 2)}\n`);
}

async function readRollbackPending(runtimeRoot: string): Promise<RuntimeRollbackPending | null> {
  await assertRuntimePath(runtimeRoot, rollbackPendingPath(runtimeRoot));
  let value: Partial<RuntimeRollbackPending>;
  try {
    value = JSON.parse(await fs.readFile(rollbackPendingPath(runtimeRoot), 'utf8')) as Partial<RuntimeRollbackPending>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (value.schema !== 'ccpanes.runtime-rollback-pending.v1' || !value.from || !value.to || typeof value.startedAt !== 'string') {
    throw new Error('invalid runtime rollback pending record');
  }
  return {
    schema: 'ccpanes.runtime-rollback-pending.v1',
    from: await validatePointerValue(runtimeRoot, value.from, 'rollback from'),
    to: await validatePointerValue(runtimeRoot, value.to, 'rollback to'),
    startedAt: value.startedAt
  };
}

function deployPendingPath(runtimeRoot: string): string {
  return path.join(runtimeRoot, 'deploy-pending.json');
}

async function writeDeployPendingAtomic(runtimeRoot: string, pending: RuntimeDeployPending): Promise<void> {
  await assertRuntimePath(runtimeRoot, deployPendingPath(runtimeRoot));
  await writeTextFileAtomic(deployPendingPath(runtimeRoot), `${JSON.stringify(pending, null, 2)}\n`);
}

async function readDeployPending(runtimeRoot: string): Promise<RuntimeDeployPending | null> {
  await assertRuntimePath(runtimeRoot, deployPendingPath(runtimeRoot));
  let value: Partial<RuntimeDeployPending>;
  try {
    value = JSON.parse(await fs.readFile(deployPendingPath(runtimeRoot), 'utf8')) as Partial<RuntimeDeployPending>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (value.schema !== 'ccpanes.runtime-deploy-pending.v1' || !value.to || typeof value.startedAt !== 'string') {
    throw new Error('invalid runtime deploy pending record');
  }
  return {
    schema: 'ccpanes.runtime-deploy-pending.v1',
    from: value.from ? await validatePointerValue(runtimeRoot, value.from, 'deploy from') : null,
    to: await validatePointerValue(runtimeRoot, value.to, 'deploy to'),
    startedAt: value.startedAt
  };
}

function launcherPrelude(): string[] {
  return [
    "import { createHash } from 'node:crypto';",
    "import fs from 'node:fs/promises';",
    "import path from 'node:path';",
    "import { fileURLToPath, pathToFileURL } from 'node:url';",
    'const runtimeRoot = path.dirname(fileURLToPath(import.meta.url));',
    "const pointer = JSON.parse(await fs.readFile(path.join(runtimeRoot, 'current.json'), 'utf8'));",
    "if (pointer.schema !== 'ccpanes.runtime-deployment-pointer.v1') throw new Error('invalid runtime current pointer schema');",
    "if (typeof pointer.releaseId !== 'string' || !/^[a-f0-9]{6,64}-[a-f0-9]{64}-[a-f0-9]{64}$/.test(pointer.releaseId)) throw new Error('invalid runtime release id');",
    "const releaseRoot = path.join(runtimeRoot, 'releases', pointer.releaseId);",
    "const moduleRoot = path.join(releaseRoot, 'dist', 'src');",
    "const identity = JSON.parse(await fs.readFile(path.join(moduleRoot, 'runtime-identity.json'), 'utf8'));",
    "if (identity.schema !== 'ccpanes.runtime-identity.v1') throw new Error('invalid runtime identity schema');",
    "for (const key of ['schema', 'packageName', 'packageVersion', 'gitCommit', 'gitDirty', 'buildSha256', 'builtAt', 'source']) if (pointer.identity?.[key] !== identity[key]) throw new Error('runtime pointer embedded identity mismatch');",
    "const packageIdentity = JSON.parse(await fs.readFile(path.join(releaseRoot, 'runtime-package-identity.json'), 'utf8'));",
    "if (packageIdentity.schema !== 'ccpanes.runtime-package-identity.v1') throw new Error('invalid runtime package identity schema');",
    "for (const key of ['schema', 'payloadSha256', 'fileCount', 'generatedAt']) if (pointer.packageIdentity?.[key] !== packageIdentity[key]) throw new Error('runtime pointer package identity mismatch');",
    "if (`${identity.gitCommit}-${identity.buildSha256}-${packageIdentity.payloadSha256}`.toLowerCase() !== pointer.releaseId) throw new Error('runtime pointer identity mismatch');",
    'async function payloadFiles(root, current = root) {',
    '  const files = [];',
    '  for (const entry of await fs.readdir(current, { withFileTypes: true })) {',
    '    const absolute = path.join(current, entry.name);',
    "    const relative = path.relative(root, absolute).replace(/\\\\/g, '/');",
    "    if (relative === 'runtime-package-identity.json') continue;",
    '    if (entry.isDirectory()) files.push(...await payloadFiles(root, absolute));',
    '    else if (entry.isFile()) files.push(absolute);',
    "    else throw new Error(`runtime payload contains unsupported entry: ${relative}`);",
    '  }',
    '  return files.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);',
    '}',
    'const payloadFilesToHash = await payloadFiles(releaseRoot);',
    "const digest = createHash('sha256');",
    'for (const filePath of payloadFilesToHash) {',
    "  digest.update(path.relative(releaseRoot, filePath).replace(/\\\\/g, '/'));",
    "  digest.update('\\0');",
    '  digest.update(await fs.readFile(filePath));',
    "  digest.update('\\0');",
    '}',
    "if (payloadFilesToHash.length !== packageIdentity.fileCount || digest.digest('hex').toUpperCase() !== packageIdentity.payloadSha256) throw new Error('runtime payload SHA-256 mismatch');"
  ];
}

function cliLauncherText(): string {
  return [
    ...launcherPrelude(),
    "const cli = await import(pathToFileURL(path.join(moduleRoot, 'cli.js')).href);",
    'cli.runCli(process.argv.slice(2))',
    '  .then((output) => process.stdout.write(output))',
    '  .catch((error) => {',
    '    cli.appendCliRuntimeError(process.argv.slice(2), error);',
    "    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\\n`);",
    '    process.exitCode = 1;',
    '  });',
    ''
  ].join('\n');
}

function mcpLauncherText(): string {
  return [
    ...launcherPrelude(),
    "await import(pathToFileURL(path.join(moduleRoot, 'mcp-server.js')).href);",
    ''
  ].join('\n');
}

async function writeLaunchers(runtimeRoot: string): Promise<{ cli: string; mcpServer: string }> {
  const launchers = [
    { name: 'cli.mjs', text: cliLauncherText() },
    { name: 'mcp-server.mjs', text: mcpLauncherText() }
  ];
  for (const launcher of launchers) {
    const targetPath = path.join(runtimeRoot, launcher.name);
    await assertRuntimePath(runtimeRoot, targetPath);
    await writeTextFileAtomic(targetPath, launcher.text);
  }
  return {
    cli: path.join(runtimeRoot, 'cli.mjs'),
    mcpServer: path.join(runtimeRoot, 'mcp-server.mjs')
  };
}

function dependencyPath(root: string, packageName: string): string {
  return path.join(root, 'node_modules', ...packageName.split('/'));
}

function assertValidPackageName(packageName: string): void {
  const match = /^(?:@([A-Za-z0-9._~-]+)\/)?([A-Za-z0-9._~-]+)$/.exec(packageName);
  if (!match || match[1] === '.' || match[1] === '..' || match[2] === '.' || match[2] === '..') {
    throw new Error(`invalid production dependency name: ${packageName}`);
  }
}

async function copyProductionDependencies(sourceDir: string, targetDir: string): Promise<void> {
  const rootPackage = JSON.parse(await fs.readFile(path.join(sourceDir, 'package.json'), 'utf8')) as Record<string, unknown>;
  const initial = Object.keys((rootPackage.dependencies as Record<string, string> | undefined) ?? {});
  const copied = new Set<string>();

  async function copyPackage(packageName: string, requiredByDir: string, optional: boolean): Promise<void> {
    assertValidPackageName(packageName);
    const lexicalSourceRoot = path.resolve(sourceDir).toLowerCase();
    let current = requiredByDir;
    let sourcePackageDir: string | null = null;
    for (;;) {
      const candidate = dependencyPath(current, packageName);
      try {
        if ((await fs.stat(candidate)).isDirectory()) sourcePackageDir = candidate;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      }
      if (sourcePackageDir || path.resolve(current).toLowerCase() === lexicalSourceRoot) break;
      const parent = path.dirname(current);
      const relativeParent = path.relative(sourceDir, parent);
      if (relativeParent === '..' || relativeParent.startsWith(`..${path.sep}`) || path.isAbsolute(relativeParent)) break;
      current = parent;
    }
    if (!sourcePackageDir) {
      if (optional) return;
      throw new Error(`missing production dependency: ${packageName}`);
    }
    if (!isPathInside(sourceDir, sourcePackageDir)) {
      throw new Error(`production dependency resolves outside source root: ${packageName}`);
    }
    const relative = path.relative(sourceDir, sourcePackageDir);
    if (copied.has(relative)) return;
    copied.add(relative);
    const targetPackageDir = path.join(targetDir, relative);
    if (!isPathInside(targetDir, targetPackageDir)) {
      throw new Error(`production dependency target outside staging root: ${packageName}`);
    }
    await fs.mkdir(path.dirname(targetPackageDir), { recursive: true });
    await fs.cp(sourcePackageDir, targetPackageDir, {
      recursive: true,
      errorOnExist: true,
      force: false,
      filter: (sourcePath) => {
        const relativeSourcePath = path.relative(sourcePackageDir as string, sourcePath);
        return relativeSourcePath !== 'node_modules' && !relativeSourcePath.startsWith(`node_modules${path.sep}`);
      }
    });
    const packageJson = JSON.parse(await fs.readFile(path.join(sourcePackageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
    const dependencies = (packageJson.dependencies as Record<string, string> | undefined) ?? {};
    const optionalDependencies = (packageJson.optionalDependencies as Record<string, string> | undefined) ?? {};
    const peerDependencies = (packageJson.peerDependencies as Record<string, string> | undefined) ?? {};
    const peerMeta = (packageJson.peerDependenciesMeta as Record<string, { optional?: boolean }> | undefined) ?? {};
    for (const dependency of Object.keys(dependencies)) await copyPackage(dependency, sourcePackageDir, false);
    for (const dependency of Object.keys(optionalDependencies)) await copyPackage(dependency, sourcePackageDir, true);
    for (const dependency of Object.keys(peerDependencies)) await copyPackage(dependency, sourcePackageDir, peerMeta[dependency]?.optional === true);
  }

  for (const dependency of initial) await copyPackage(dependency, sourceDir, false);
}

async function stageRuntimePackage(sourceDir: string, stagingPath: string): Promise<void> {
  await fs.mkdir(stagingPath, { recursive: true });
  await fs.cp(path.join(sourceDir, 'dist'), path.join(stagingPath, 'dist'), { recursive: true, errorOnExist: true, force: false });
  await fs.copyFile(path.join(sourceDir, 'package.json'), path.join(stagingPath, 'package.json'));
  try {
    await fs.copyFile(path.join(sourceDir, 'package-lock.json'), path.join(stagingPath, 'package-lock.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await copyProductionDependencies(sourceDir, stagingPath);
}

async function writePackageIdentity(stagingPath: string, generatedAt: string): Promise<RuntimePackageIdentity> {
  const payload = await computeRuntimePayload(stagingPath);
  const identity: RuntimePackageIdentity = {
    schema: 'ccpanes.runtime-package-identity.v1',
    ...payload,
    generatedAt
  };
  await writeTextFileAtomic(path.join(stagingPath, packageIdentityName), `${JSON.stringify(identity, null, 2)}\n`);
  return identity;
}

function createPointer(
  runtimeRoot: string,
  identity: RuntimeIdentity,
  packageIdentity: RuntimePackageIdentity,
  switchedAt: string
): RuntimeDeploymentPointer {
  const id = releaseId(identity, packageIdentity);
  return {
    schema: 'ccpanes.runtime-deployment-pointer.v1',
    releaseId: id,
    releasePath: path.join(runtimeRoot, 'releases', id),
    identity,
    packageIdentity,
    switchedAt
  };
}

export async function deployRuntime(input: DeployRuntimeInput): Promise<RuntimeDeploymentReport> {
  assertInsideAllowRoots('runtime source', input.sourceDir, input.allowRoots);
  assertInsideAllowRoots('runtime root', input.runtimeRoot, input.allowRoots);
  const releasesRoot = path.join(input.runtimeRoot, 'releases');
  try {
    await fs.stat(input.runtimeRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await validatedBuild(input.sourceDir, true);
  }
  await fs.mkdir(releasesRoot, { recursive: true });
  const operationLockPath = path.join(input.runtimeRoot, '.runtime-operation.lock');
  await assertRuntimePath(input.runtimeRoot, releasesRoot);
  await assertRuntimePath(input.runtimeRoot, operationLockPath);
  return withFileLock(operationLockPath, async () => {
    const now = input.now ?? new Date().toISOString();
    const recovery = await recoverRuntimeLocked({ runtimeRoot: input.runtimeRoot, allowRoots: input.allowRoots, now }, true);
    const identity = await validatedBuild(input.sourceDir, true);
    const launcherPaths = recovery.launcherPaths;
    const stagingPath = path.join(input.runtimeRoot, `.staging-${process.pid}-${randomUUID()}`);
    const verificationStagingPath = path.join(input.runtimeRoot, `.staging-verify-${process.pid}-${randomUUID()}`);
    await assertRuntimePath(input.runtimeRoot, stagingPath);
    await assertRuntimePath(input.runtimeRoot, verificationStagingPath);

    try {
      await stageRuntimePackage(input.sourceDir, stagingPath);
      const stagedBuildIdentity = await validatedBuild(stagingPath);
      if (stagedBuildIdentity.gitCommit !== identity.gitCommit || stagedBuildIdentity.buildSha256 !== identity.buildSha256) {
        throw new Error('staged runtime build identity mismatch');
      }
      await input.afterFirstStage?.();
      await stageRuntimePackage(input.sourceDir, verificationStagingPath);
      const [stagedPayload, verificationPayload] = await Promise.all([
        computeRuntimePayload(stagingPath),
        computeRuntimePayload(verificationStagingPath)
      ]);
      if (stagedPayload.payloadSha256 !== verificationPayload.payloadSha256
        || stagedPayload.fileCount !== verificationPayload.fileCount) {
        throw new Error('runtime source payload changed during staging');
      }
      const finalGitState = readRuntimeSourceGitState(input.sourceDir);
      if (finalGitState.statusShort.length > 0) throw new Error('runtime source Git worktree changed during staging');
      if (finalGitState.head.toLowerCase() !== identity.gitCommit?.toLowerCase()) {
        throw new Error('runtime source Git HEAD changed during staging');
      }
      if (await computeRuntimeBuildSha256(path.join(input.sourceDir, 'dist', 'src')) !== identity.buildSha256) {
        throw new Error('runtime source build changed during staging');
      }
      const stagedPackageIdentity = await writePackageIdentity(stagingPath, now);
      let next = createPointer(input.runtimeRoot, identity, stagedPackageIdentity, now);
      await assertRuntimePath(input.runtimeRoot, next.releasePath);
      let releaseExists = true;
      try {
        await fs.stat(next.releasePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        releaseExists = false;
      }
      if (releaseExists) {
        const existing = await validatedRelease(next.releasePath);
        if (releaseId(existing.identity, existing.packageIdentity) !== next.releaseId) {
          throw new Error('existing runtime release identity mismatch');
        }
        next = createPointer(input.runtimeRoot, existing.identity, existing.packageIdentity, now);
      } else {
        await fs.rename(stagingPath, next.releasePath);
      }

      const current = await readPointer(input.runtimeRoot, 'current');
      if (current?.releaseId === next.releaseId) {
        return {
          schema: 'ccpanes.runtime-deployment.v1', action: 'deploy', changed: false,
          runtimeRoot: input.runtimeRoot, releaseId: next.releaseId, releasePath: next.releasePath,
          previousReleaseId: (await readPointer(input.runtimeRoot, 'previous'))?.releaseId ?? null,
          identity: next.identity, packageIdentity: next.packageIdentity, launcherPaths, completedAt: now
        };
      }
      await writeDeployPendingAtomic(input.runtimeRoot, {
        schema: 'ccpanes.runtime-deploy-pending.v1',
        from: current,
        to: next,
        startedAt: now
      });
      await writePointerAtomic(input.runtimeRoot, 'current', next);
      if (current) await writePointerAtomic(input.runtimeRoot, 'previous', { ...current, switchedAt: now });
      await fs.rm(deployPendingPath(input.runtimeRoot));
      return {
        schema: 'ccpanes.runtime-deployment.v1', action: 'deploy', changed: true,
        runtimeRoot: input.runtimeRoot, releaseId: next.releaseId, releasePath: next.releasePath,
        previousReleaseId: current?.releaseId ?? null, identity: next.identity,
        packageIdentity: next.packageIdentity, launcherPaths, completedAt: now
      };
    } finally {
      await Promise.all([
        fs.rm(stagingPath, { recursive: true, force: true }),
        fs.rm(verificationStagingPath, { recursive: true, force: true })
      ]);
    }
  }, { timeoutMs: 120_000, staleMs: 300_000 });
}

export async function rollbackRuntime(input: RollbackRuntimeInput): Promise<RuntimeDeploymentReport> {
  assertInsideAllowRoots('runtime root', input.runtimeRoot, input.allowRoots);
  const operationLockPath = path.join(input.runtimeRoot, '.runtime-operation.lock');
  await fs.stat(input.runtimeRoot);
  await assertRuntimePath(input.runtimeRoot, path.join(input.runtimeRoot, 'releases'));
  await assertRuntimePath(input.runtimeRoot, operationLockPath);
  return withFileLock(operationLockPath, async () => rollbackRuntimeLocked(input), {
    timeoutMs: 120_000,
    staleMs: 300_000
  });
}

export async function recoverRuntime(input: RecoverRuntimeInput): Promise<RuntimeRecoveryReport> {
  assertInsideAllowRoots('runtime root', input.runtimeRoot, input.allowRoots);
  await fs.stat(input.runtimeRoot);
  const operationLockPath = path.join(input.runtimeRoot, '.runtime-operation.lock');
  await assertRuntimePath(input.runtimeRoot, path.join(input.runtimeRoot, 'releases'));
  await assertRuntimePath(input.runtimeRoot, operationLockPath);
  return withFileLock(operationLockPath, async () => recoverRuntimeLocked(input), {
    timeoutMs: 120_000,
    staleMs: 300_000
  });
}

async function recoverRuntimeLocked(input: RecoverRuntimeInput, allowEmpty = false): Promise<RuntimeRecoveryReport> {
  const now = input.now ?? new Date().toISOString();
  const deployPending = await readDeployPending(input.runtimeRoot);
  const rollbackPending = await readRollbackPending(input.runtimeRoot);
  if (deployPending && rollbackPending) throw new Error('runtime has conflicting pending transactions');
  let recoveredAction: RuntimeRecoveryReport['recoveredAction'] = 'none';
  if (deployPending) {
    await writePointerAtomic(input.runtimeRoot, 'current', { ...deployPending.to, switchedAt: now });
    if (deployPending.from) await writePointerAtomic(input.runtimeRoot, 'previous', { ...deployPending.from, switchedAt: now });
    else await fs.rm(pointerPath(input.runtimeRoot, 'previous'), { force: true });
    await fs.rm(deployPendingPath(input.runtimeRoot));
    recoveredAction = 'deploy';
  } else if (rollbackPending) {
    await writePointerAtomic(input.runtimeRoot, 'current', { ...rollbackPending.to, switchedAt: now });
    await writePointerAtomic(input.runtimeRoot, 'previous', { ...rollbackPending.from, switchedAt: now });
    await fs.rm(rollbackPendingPath(input.runtimeRoot));
    recoveredAction = 'rollback';
  }
  const current = await readPointer(input.runtimeRoot, 'current');
  if (!current && !allowEmpty) throw new Error('runtime current pointer is missing');
  const launcherPaths = await writeLaunchers(input.runtimeRoot);
  return {
    schema: 'ccpanes.runtime-recovery.v1',
    action: 'recover',
    recoveredAction,
    changed: recoveredAction !== 'none',
    runtimeRoot: input.runtimeRoot,
    current,
    previous: await readPointer(input.runtimeRoot, 'previous'),
    launcherPaths,
    completedAt: now
  };
}

async function rollbackRuntimeLocked(input: RollbackRuntimeInput): Promise<RuntimeDeploymentReport> {
  const now = input.now ?? new Date().toISOString();
  const launcherPaths = {
    cli: path.join(input.runtimeRoot, 'cli.mjs'),
    mcpServer: path.join(input.runtimeRoot, 'mcp-server.mjs')
  };
  const pending = await readRollbackPending(input.runtimeRoot);
  if (pending) {
    await writePointerAtomic(input.runtimeRoot, 'current', { ...pending.to, switchedAt: now });
    await writePointerAtomic(input.runtimeRoot, 'previous', { ...pending.from, switchedAt: now });
    await fs.rm(rollbackPendingPath(input.runtimeRoot));
    return {
      schema: 'ccpanes.runtime-deployment.v1', action: 'rollback', changed: true,
      runtimeRoot: input.runtimeRoot, releaseId: pending.to.releaseId, releasePath: pending.to.releasePath,
      previousReleaseId: pending.from.releaseId, identity: pending.to.identity,
      packageIdentity: pending.to.packageIdentity, launcherPaths, completedAt: now
    };
  }
  if (await readDeployPending(input.runtimeRoot)) {
    throw new Error('runtime deployment is pending; run deploy-runtime before rollback');
  }
  const current = await readPointer(input.runtimeRoot, 'current');
  const previous = await readPointer(input.runtimeRoot, 'previous');
  if (!current) throw new Error('runtime current pointer is missing');
  if (!previous) throw new Error('runtime previous pointer is missing');
  if (current.releaseId === previous.releaseId) {
    return {
      schema: 'ccpanes.runtime-deployment.v1', action: 'rollback', changed: false,
      runtimeRoot: input.runtimeRoot, releaseId: current.releaseId, releasePath: current.releasePath,
      previousReleaseId: previous.releaseId, identity: current.identity,
      packageIdentity: current.packageIdentity, launcherPaths, completedAt: now
    };
  }
  await writeRollbackPendingAtomic(input.runtimeRoot, {
    schema: 'ccpanes.runtime-rollback-pending.v1',
    from: current,
    to: previous,
    startedAt: now
  });
  await writePointerAtomic(input.runtimeRoot, 'current', { ...previous, switchedAt: now });
  await writePointerAtomic(input.runtimeRoot, 'previous', { ...current, switchedAt: now });
  await fs.rm(rollbackPendingPath(input.runtimeRoot));
  return {
    schema: 'ccpanes.runtime-deployment.v1', action: 'rollback', changed: true,
    runtimeRoot: input.runtimeRoot, releaseId: previous.releaseId, releasePath: previous.releasePath,
    previousReleaseId: current.releaseId, identity: previous.identity,
    packageIdentity: previous.packageIdentity, launcherPaths, completedAt: now
  };
}
