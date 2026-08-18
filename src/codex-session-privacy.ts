export const CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES = 64 * 1024;
export const CODEX_SESSION_PRIVACY_STRING_MAX_LENGTH = 512;

export interface BoundedCodexSessionPrivacyInput {
  value: string;
  changed: boolean;
}

export function boundCodexSessionPrivacyInput(
  value: string
): BoundedCodexSessionPrivacyInput {
  const bounded: string[] = [];
  let byteLength = 0;
  let changed = false;

  for (const rawCharacter of value) {
    const firstCodeUnit = rawCharacter.charCodeAt(0);
    const character = rawCharacter.length === 1 && (
      (firstCodeUnit >= 0xd800 && firstCodeUnit <= 0xdbff) ||
      (firstCodeUnit >= 0xdc00 && firstCodeUnit <= 0xdfff)
    )
      ? '\uFFFD'
      : rawCharacter;
    if (character !== rawCharacter) changed = true;

    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (
      byteLength + characterBytes >
      CODEX_SESSION_PRIVACY_RAW_SCAN_MAX_BYTES
    ) {
      changed = true;
      break;
    }
    bounded.push(character);
    byteLength += characterBytes;
  }

  return {
    value: bounded.join(''),
    changed
  };
}
