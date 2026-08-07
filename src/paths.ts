import path from 'node:path';

export function normalizeForComparison(input: string): string {
  const normalized = path.resolve(input).replace(/\\/g, '/');
  return normalized.replace(/\/+$/, '').toLowerCase();
}

export function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(root);
  const normalizedCandidate = normalizeForComparison(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`);
}