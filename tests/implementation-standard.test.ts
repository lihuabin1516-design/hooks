import { describe, expect, test } from 'vitest';
import {
  createImplementationStandard,
  validateImplementationStandard
} from '../src/implementation-standard.js';

describe('implementation standard', () => {
  test('defines production-grade solution economy without removing production capabilities', () => {
    const result = createImplementationStandard();

    expect(result.schema).toBe('ccpanes.implementation-standard.v1');
    expect(result.level).toBe('production-grade');
    expect(result.optimizationTarget).toBe('unnecessary-complexity');
    expect(result.nonNegotiables).toEqual(expect.arrayContaining([
      expect.stringContaining('correctness'),
      expect.stringContaining('security'),
      expect.stringContaining('data integrity'),
      expect.stringContaining('recovery'),
      expect.stringContaining('compatibility'),
      expect.stringContaining('observability'),
      expect.stringContaining('performance'),
      expect.stringContaining('verification'),
      expect.stringContaining('deployment')
    ]));
    expect(result.removalCandidates).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate implementations'),
      expect.stringContaining('speculative abstractions'),
      expect.stringContaining('unsupported configuration'),
      expect.stringContaining('avoidable dependencies'),
      expect.stringContaining('semantics-free wrappers'),
      expect.stringContaining('boilerplate')
    ]));

    const protectedTerms = [
      'tests',
      'security',
      'validation',
      'recovery',
      'observability',
      'compatibility',
      'rollback'
    ];
    const removalText = result.removalCandidates.join(' ').toLowerCase();
    for (const term of protectedTerms) {
      expect(removalText).not.toContain(term);
    }
  });

  test('records the upstream reference and rejects its runtime authority', () => {
    const result = createImplementationStandard();

    expect(result.sourceModel).toMatchObject({
      name: 'ccpanes.production-grade-solution-economy.v1',
      adaptedFrom: 'https://github.com/DietrichGebert/ponytail.git',
      referenceHead: '2ed6c52c9d7e5e56942508591085fd45dea277d3'
    });
    expect(result.sourceModel.adoptedIdeas).toContain('reuse existing owners before adding code');
    expect(result.sourceModel.rejectedIdeas).toEqual(expect.arrayContaining([
      'runtime mode state',
      'user-config and statusline writes',
      'prompt guidance as hard-gate authority',
      'line count as a production-readiness metric',
      'reduced verification obligations'
    ]));
    expect(result.boundaries).toContain(
      'current-task.json, .ccpanes-task/policy.json, hook gates, and acceptance evidence retain their existing authority'
    );
  });

  test('returns isolated copies and validates duplicate or blank entries', () => {
    const first = createImplementationStandard();
    first.nonNegotiables.push('mutated by consumer');
    first.sourceModel.adoptedIdeas.push('mutated source');

    const second = createImplementationStandard();
    expect(second.nonNegotiables).not.toContain('mutated by consumer');
    expect(second.sourceModel.adoptedIdeas).not.toContain('mutated source');

    expect(() => validateImplementationStandard({
      ...second,
      principles: [...second.principles, second.principles[0]]
    })).toThrow('duplicate implementation standard principles');

    expect(() => validateImplementationStandard({
      ...second,
      principles: [...second.principles, ` ${second.principles[0]} `]
    })).toThrow('duplicate implementation standard principles');

    expect(() => validateImplementationStandard({
      ...second,
      boundaries: [...second.boundaries, ' ']
    })).toThrow('blank implementation standard boundaries');
  });

  test('rejects invalid contract identity and empty required collections', () => {
    const standard = createImplementationStandard();

    expect(() => validateImplementationStandard({
      ...standard,
      schema: 'wrong' as typeof standard.schema
    })).toThrow('invalid implementation standard schema');
    expect(() => validateImplementationStandard({
      ...standard,
      level: 'wrong' as typeof standard.level
    })).toThrow('invalid implementation standard level');
    expect(() => validateImplementationStandard({
      ...standard,
      optimizationTarget: 'wrong' as typeof standard.optimizationTarget
    })).toThrow('invalid implementation standard optimization target');
    expect(() => validateImplementationStandard({
      ...standard,
      sourceModel: { ...standard.sourceModel, name: 'wrong' as typeof standard.sourceModel.name }
    })).toThrow('invalid implementation standard source model');
    expect(() => validateImplementationStandard({
      ...standard,
      sourceModel: { ...standard.sourceModel, adaptedFrom: 'https://example.invalid/ponytail.git' }
    })).toThrow('invalid implementation standard source repository');
    expect(() => validateImplementationStandard({
      ...standard,
      sourceModel: { ...standard.sourceModel, referenceHead: 'wrong' }
    })).toThrow('invalid implementation standard reference HEAD');
    const emptyCollectionCases = [
      {
        field: 'principles',
        input: { ...standard, principles: [] },
        error: 'empty implementation standard principles'
      },
      {
        field: 'nonNegotiables',
        input: { ...standard, nonNegotiables: [] },
        error: 'empty implementation standard nonNegotiables'
      },
      {
        field: 'removalCandidates',
        input: { ...standard, removalCandidates: [] },
        error: 'empty implementation standard removalCandidates'
      },
      {
        field: 'boundaries',
        input: { ...standard, boundaries: [] },
        error: 'empty implementation standard boundaries'
      },
      {
        field: 'sourceModel.adoptedIdeas',
        input: {
          ...standard,
          sourceModel: { ...standard.sourceModel, adoptedIdeas: [] }
        },
        error: 'empty implementation standard sourceModel.adoptedIdeas'
      },
      {
        field: 'sourceModel.rejectedIdeas',
        input: {
          ...standard,
          sourceModel: { ...standard.sourceModel, rejectedIdeas: [] }
        },
        error: 'empty implementation standard sourceModel.rejectedIdeas'
      }
    ];
    for (const { field, input, error } of emptyCollectionCases) {
      expect(() => validateImplementationStandard(input), field).toThrow(error);
    }
  });
});
