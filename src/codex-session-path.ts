import path from 'node:path';

function normalizeWindowsAbsolute(input: string): string {
  let value = input.replace(/\//g, '\\');
  const deviceUnc = /^\\\\[?.]\\UNC\\(.+)$/i.exec(value);
  const deviceDrive = /^\\\\[?.]\\([a-zA-Z]:\\.*)$/.exec(value);

  if (value.startsWith('\\\\?\\') || value.startsWith('\\\\.\\')) {
    if (deviceUnc) value = `\\\\${deviceUnc[1]}`;
    else if (deviceDrive) value = deviceDrive[1];
    else return '';
  }

  const isDriveAbsolute = /^[a-zA-Z]:\\/.test(value);
  const isUncAbsolute = /^\\\\[^\\]+\\[^\\]+(?:\\.*)?$/.test(value);
  if (!isDriveAbsolute && !isUncAbsolute) return '';

  const normalized = path.win32.normalize(value).replace(/\\/g, '/');
  const isDriveRoot = /^[a-zA-Z]:\/$/.test(normalized);
  const isUncRoot = /^\/\/[^/]+\/[^/]+\/$/.test(normalized);
  return (isDriveRoot || isUncRoot
    ? normalized
    : normalized.replace(/\/+$/, '')
  ).toLowerCase();
}

export function normalizeCodexPath(input: string): string {
  const value = input.trim();
  if (!value) return '';

  if (value.startsWith('/') && !value.startsWith('//')) {
    const normalized = path.posix.normalize(value);
    const wsl = /^\/mnt\/([a-zA-Z])(?:\/(.*))?$/.exec(normalized);
    if (wsl) {
      return normalizeWindowsAbsolute(
        `${wsl[1]}:\\${(wsl[2] ?? '').replace(/\//g, '\\')}`
      );
    }
    return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
  }

  const windows = normalizeWindowsAbsolute(value);
  if (windows) return windows;
  if (/^[a-zA-Z]:/.test(value) || /^\\\\[?.]\\/.test(value)) return '';
  return '';
}

export function isCodexPathInside(root: string, candidate: string): boolean {
  const rootNorm = normalizeCodexPath(root);
  const candidateNorm = normalizeCodexPath(candidate);
  if (!rootNorm || !candidateNorm) return false;
  if (candidateNorm === rootNorm) return true;
  const rootPrefix = rootNorm.endsWith('/') ? rootNorm : `${rootNorm}/`;
  return candidateNorm.startsWith(rootPrefix);
}
