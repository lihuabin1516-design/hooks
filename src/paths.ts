import fs from 'node:fs';
import path from 'node:path';

function canonicalizeExistingPrefix(input: string): string {
  const resolved = path.resolve(input);
  const suffix: string[] = [];
  let current = resolved;

  for (;;) {
    try {
      const realPrefix = fs.realpathSync.native(current);
      return suffix.length > 0 ? path.join(realPrefix, ...suffix) : realPrefix;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return resolved;

      const parent = path.dirname(current);
      if (parent === current) return resolved;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function trimTrailingSeparators(input: string): string {
  const trimmed = input.replace(/\/+$/, '');
  if (trimmed.length === 0) return '/';
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}/`;
  return trimmed;
}

export function normalizeForComparison(input: string): string {
  const normalized = canonicalizeExistingPrefix(input).replace(/\\/g, '/');
  return trimTrailingSeparators(normalized).toLowerCase();
}

export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(root);
  const normalizedCandidate = normalizeForComparison(candidate);
  const rootPrefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(rootPrefix);
}
