import {
  sanitizeCodexSessionArtifactExcerpt
} from './codex-session-artifact-privacy.js';
import {
  CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH
} from './codex-session-privacy.js';

export const CODEX_THREAD_ID_MAX_LENGTH =
  CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH;

export function isCodexThreadId(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= CODEX_THREAD_ID_MAX_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value) &&
    sanitizeCodexSessionArtifactExcerpt(value) === value;
}

export function requireCodexThreadId(
  value: unknown,
  onInvalid: () => never
): string {
  return isCodexThreadId(value) ? value : onInvalid();
}
