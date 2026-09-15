import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';

const retryableReplaceCodes = new Set(['EACCES', 'EBUSY', 'EEXIST', 'EPERM']);

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function replaceFileWithRetry(tempPath: string, targetPath: string, attempts = 20): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(tempPath, targetPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (!retryableReplaceCodes.has(code) || attempt >= attempts - 1) throw error;
      await delay(Math.min(10 * (attempt + 1), 100));
    }
  }
}

export async function writeTextFileAtomic(targetPath: string, text: string): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(tempPath, text, 'utf8');
    await replaceFileWithRetry(tempPath, targetPath);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

export interface FileLockOptions {
  timeoutMs?: number;
  staleMs?: number;
}

export async function withFileLock<T>(lockPath: string, action: () => Promise<T>, options: FileLockOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleMs = Math.max(options.staleMs ?? 60_000, 2_000);
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const retryIntervalMs = 100;
  const release = await lockfile.lock(lockPath, {
    realpath: false,
    lockfilePath: lockPath,
    stale: staleMs,
    update: Math.max(1_000, Math.floor(staleMs / 3)),
    retries: {
      retries: Math.max(0, Math.ceil(timeoutMs / retryIntervalMs)),
      factor: 1,
      minTimeout: retryIntervalMs,
      maxTimeout: retryIntervalMs,
      randomize: false
    }
  });

  try {
    return await action();
  } finally {
    await release();
  }
}
