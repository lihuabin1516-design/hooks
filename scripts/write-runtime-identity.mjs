import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distSourceRoot = path.join(repoRoot, 'dist', 'src');
const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
const { computeRuntimeBuildSha256 } = await import(pathToFileURL(path.join(distSourceRoot, 'runtime-deployment.js')).href);

function gitOutput(args) {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const gitCommit = gitOutput(['rev-parse', 'HEAD']);
const gitStatus = gitOutput(['status', '--porcelain']);
const identity = {
  schema: 'ccpanes.runtime-identity.v1',
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  gitCommit,
  gitDirty: gitStatus === null ? null : gitStatus.length > 0,
  buildSha256: await computeRuntimeBuildSha256(distSourceRoot),
  builtAt: new Date().toISOString(),
  source: 'build-manifest'
};

await fs.writeFile(path.join(distSourceRoot, 'runtime-identity.json'), `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
process.stdout.write(`RUNTIME_IDENTITY ${identity.gitCommit ?? 'unknown'} ${identity.buildSha256}\n`);
