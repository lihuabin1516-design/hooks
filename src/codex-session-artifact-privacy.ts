import {
  boundCodexSessionPrivacyInput,
  CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH
} from './codex-session-privacy.js';

const REDACTED_ARTIFACT_VALUE = '[REDACTED]';
const PRIVATE_KEY_BEGIN_PATTERN =
  /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----/giu;
const SENSITIVE_KEY_FAMILY_PATTERN_SOURCE =
  '(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?access[_-]?key|api[_-]?key|apikey|token|key|password|passwd|secret)';
const SENSITIVE_KEY_PATTERN_SOURCE =
  `(?:[a-z0-9]+[_-]+)*${SENSITIVE_KEY_FAMILY_PATTERN_SOURCE}`;
const URL_USERINFO_PATTERN =
  /(\b[a-z][a-z0-9+.-]*:\/\/)([^@\s/?#]+(?::[^@\s/?#]*)?)@/giu;
const URL_SENSITIVE_QUERY_PATTERN = new RegExp(
  String.raw`([?&]${SENSITIVE_KEY_PATTERN_SOURCE}=)[^&#\s]*`,
  'giu'
);
const AUTHORIZATION_PATTERN =
  /(\bauthorization\b["']?\s*[:=]\s*)(?:"(?:bearer\s+)?(?:\\[^\r\n]|[^"\\\r\n])*"|'(?:bearer\s+)?(?:\\[^\r\n]|[^'\\\r\n])*'|(?:bearer\s+)?[^\s,;]+)/giu;
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`(\b${SENSITIVE_KEY_PATTERN_SOURCE}\b["']?\s*[:=]\s*)(?:"(?:\\[^\r\n]|[^"\\\r\n])*"|'(?:\\[^\r\n]|[^'\\\r\n])*'|[^\s,;}&]+)`,
  'giu'
);
const BEARER_TOKEN_PATTERN = /\bbearer\s+[a-z0-9._~+/=-]{8,}/giu;
const JWT_PATTERN =
  /eyJ[a-z0-9_-]*\.[a-z0-9_-]+\.[a-z0-9_-]+(?![a-z0-9_-])/giu;
const SOURCE_THREAD_ID_PATTERN =
  /(<source_thread_id>\s*)([^<\r\n]{1,512})(\s*<\/source_thread_id>)/giu;
const PROVIDER_SECRET_FAMILY_PATTERN_SOURCE =
  String.raw`(?:sk-[A-Za-z0-9][A-Za-z0-9_-]{7,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[A-Za-z0-9]*-[A-Za-z0-9-]{8,}|(?:AKIA|ASIA)[A-Z0-9]{16}|glpat-[A-Za-z0-9_-]{8,}|npm_[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{35}|(?:sk_live_|rk_live_)[A-Za-z0-9]{16,})`;
const PROVIDER_SECRET_PATTERN_SOURCE =
  String.raw`(?<![A-Za-z0-9_])${PROVIDER_SECRET_FAMILY_PATTERN_SOURCE}(?![A-Za-z0-9_])`;
const BARE_SECRET_PATTERN = new RegExp(
  PROVIDER_SECRET_PATTERN_SOURCE,
  'giu'
);
const EMBEDDED_BARE_SECRET_PATTERN = new RegExp(
  PROVIDER_SECRET_PATTERN_SOURCE,
  'iu'
);

function sliceWithoutSplittingSurrogatePair(
  value: string,
  maxLength: number
): string {
  if (value.length <= maxLength) return value;
  let end = maxLength;
  const precedingCodeUnit = value.charCodeAt(end - 1);
  const followingCodeUnit = value.charCodeAt(end);
  if (
    precedingCodeUnit >= 0xd800 &&
    precedingCodeUnit <= 0xdbff &&
    followingCodeUnit >= 0xdc00 &&
    followingCodeUnit <= 0xdfff
  ) {
    end -= 1;
  }
  return value.slice(0, end);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function redactPrivateKeyBlocks(value: string): string {
  let cursor = 0;
  let redacted = '';
  const beginPattern = new RegExp(PRIVATE_KEY_BEGIN_PATTERN.source, 'giu');

  while (cursor < value.length) {
    beginPattern.lastIndex = cursor;
    const beginMatch = beginPattern.exec(value);
    if (!beginMatch) {
      return `${redacted}${value.slice(cursor)}`;
    }

    redacted += value.slice(cursor, beginMatch.index);
    redacted += REDACTED_ARTIFACT_VALUE;
    const endPattern = new RegExp(
      `-----END ${escapeRegExp(beginMatch[1])}-----`,
      'giu'
    );
    endPattern.lastIndex = beginPattern.lastIndex;
    const endMatch = endPattern.exec(value);
    if (!endMatch) {
      return redacted;
    }
    cursor = endMatch.index + endMatch[0].length;
  }

  return redacted;
}

export function containsEmbeddedBareSecret(value: string): boolean {
  return EMBEDDED_BARE_SECRET_PATTERN.test(value);
}

export interface RedactedCodexSessionArtifactValue {
  value: string | null;
  changed: boolean;
}

export function redactCodexSessionArtifactValue(
  value: string | null
): RedactedCodexSessionArtifactValue {
  if (value === null) return { value: null, changed: false };
  const boundedRaw = boundCodexSessionPrivacyInput(value);
  const redacted = redactPrivateKeyBlocks(boundedRaw.value)
    .replace(
      SOURCE_THREAD_ID_PATTERN,
      (match, prefix: string, identifier: string, suffix: string) =>
        containsEmbeddedBareSecret(identifier)
          ? `${prefix}${REDACTED_ARTIFACT_VALUE}${suffix}`
          : match
    )
    .replace(
      URL_USERINFO_PATTERN,
      (_match, prefix: string) => `${prefix}${REDACTED_ARTIFACT_VALUE}@`
    )
    .replace(
      URL_SENSITIVE_QUERY_PATTERN,
      (_match, prefix: string) => `${prefix}${REDACTED_ARTIFACT_VALUE}`
    )
    .replace(
      AUTHORIZATION_PATTERN,
      (_match, prefix: string) => `${prefix}${REDACTED_ARTIFACT_VALUE}`
    )
    .replace(
      SENSITIVE_ASSIGNMENT_PATTERN,
      (_match, prefix: string) => `${prefix}${REDACTED_ARTIFACT_VALUE}`
    )
    .replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED_ARTIFACT_VALUE}`)
    .replace(JWT_PATTERN, REDACTED_ARTIFACT_VALUE)
    .replace(BARE_SECRET_PATTERN, REDACTED_ARTIFACT_VALUE);
  return {
    value: redacted || null,
    changed: boundedRaw.changed || redacted !== boundedRaw.value
  };
}

export function sanitizeCodexSessionArtifactExcerpt(
  value: string | null
): string | null {
  const redactedValue = redactCodexSessionArtifactValue(value).value;
  if (redactedValue === null) return null;
  const redacted = redactedValue
    .replace(/\s+/gu, ' ')
    .trim();
  if (!redacted) return null;
  if (redacted.length <= CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH) {
    return redacted;
  }
  return `${sliceWithoutSplittingSurrogatePair(
    redacted,
    CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH - 1
  )}…`;
}
