import { describe, expect, test } from 'vitest';
import { createHostAdapterRegistry, getHostAdapter, validateHostAdapterRegistry } from '../src/host-adapter-registry.js';

describe('host adapter registry', () => {
  test('exposes a machine-readable registry with Codex as the supported default', () => {
    const registry = createHostAdapterRegistry();

    expect(registry.schema).toBe('ccpanes.host-adapter-registry.v1');
    expect(registry.defaultHost).toBe('codex');
    expect(registry.sourceModel.adaptedFrom).toContain('https://github.com/foryourhealth111-pixel/Vibe-Skills/tree/main/adapters');

    const codex = registry.adapters.find((adapter) => adapter.id === 'codex');
    expect(codex).toMatchObject({ status: 'supported' });
    expect(codex?.surfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'hard-gate', name: 'PreToolUse', owner: 'hook-enforce' }),
      expect.objectContaining({ kind: 'hard-gate', name: 'PermissionRequest', owner: 'permission-enforce' })
    ]));
    expect(codex?.verification.map((check) => check.name)).toContain('installed-hooks');
  });

  test('keeps unproven hosts out of hard-gate authority', () => {
    const registry = createHostAdapterRegistry();
    const candidates = registry.adapters.filter((adapter) => adapter.status === 'candidate');

    expect(candidates.map((adapter) => adapter.id)).toEqual(['cursor', 'gemini', 'kimi', 'opencode']);
    for (const adapter of candidates) {
      expect(adapter.surfaces.every((surface) => surface.kind !== 'hard-gate')).toBe(true);
      expect(adapter.boundaries.join('\n')).toContain('current-task.json remains the task scope authority');
    }
  });

  test('returns one adapter by id without mutating registry state', () => {
    const first = getHostAdapter('codex');
    expect(first?.id).toBe('codex');
    first?.boundaries.push('local mutation');

    const second = getHostAdapter('codex');
    expect(second?.boundaries).not.toContain('local mutation');
  });

  test('rejects duplicate adapter ids', () => {
    const registry = createHostAdapterRegistry();
    registry.adapters.push({ ...registry.adapters[0] });

    expect(() => validateHostAdapterRegistry(registry)).toThrow('duplicate host adapter id: codex');
  });
});
