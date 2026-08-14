export interface ImplementationStandardSourceModel {
  name: 'ccpanes.production-grade-solution-economy.v1';
  adaptedFrom: string;
  referenceHead: string;
  adoptedIdeas: string[];
  rejectedIdeas: string[];
}

export interface ImplementationStandard {
  schema: 'ccpanes.implementation-standard.v1';
  level: 'production-grade';
  optimizationTarget: 'unnecessary-complexity';
  principles: string[];
  nonNegotiables: string[];
  removalCandidates: string[];
  boundaries: string[];
  sourceModel: ImplementationStandardSourceModel;
}

const PONYTAIL_REPOSITORY = 'https://github.com/DietrichGebert/ponytail.git';
const PONYTAIL_REFERENCE_HEAD = '2ed6c52c9d7e5e56942508591085fd45dea277d3';

const standard: ImplementationStandard = {
  schema: 'ccpanes.implementation-standard.v1',
  level: 'production-grade',
  optimizationTarget: 'unnecessary-complexity',
  principles: [
    'understand the complete production contract before reducing the implementation',
    'reuse the canonical owner before adding another implementation',
    'prefer standard-library and platform capabilities when they satisfy the complete production contract',
    'add dependencies and abstractions only when they provide evidenced production value',
    'choose the smallest design that preserves every required production capability'
  ],
  nonNegotiables: [
    'correctness and explicit edge-case behavior',
    'input validation at trust boundaries',
    'security, authorization, and privacy requirements',
    'data integrity, idempotency, ordering, and consistency requirements',
    'error semantics, unknown-outcome handling, recovery, and reconciliation',
    'compatibility, migration, rollout, and rollback requirements',
    'logging, auditability, metrics, tracing, and operational observability',
    'measured performance and capacity requirements',
    'tests, type checks, builds, smoke checks, and verification evidence',
    'deployment, support, and maintainability requirements'
  ],
  removalCandidates: [
    'duplicate implementations when a canonical owner already exists',
    'speculative abstractions with no current consumer',
    'unsupported configuration with no operational requirement',
    'avoidable dependencies when existing capabilities satisfy the full contract',
    'semantics-free wrappers and layers with no ownership value',
    'boilerplate that carries no required behavior'
  ],
  boundaries: [
    'implementation economy is advisory and never grants or denies tool execution',
    'production capabilities are necessary cost and are outside the removal target',
    'line count, token count, cost, and duration are secondary to production correctness',
    'current-task.json, .ccpanes-task/policy.json, hook gates, and acceptance evidence retain their existing authority'
  ],
  sourceModel: {
    name: 'ccpanes.production-grade-solution-economy.v1',
    adaptedFrom: PONYTAIL_REPOSITORY,
    referenceHead: PONYTAIL_REFERENCE_HEAD,
    adoptedIdeas: [
      'reuse existing owners before adding code',
      'prefer standard-library and native platform capabilities',
      'remove speculative abstractions and avoidable dependencies',
      'isolate agentic benchmark arms from global hook and plugin contamination'
    ],
    rejectedIdeas: [
      'runtime mode state',
      'user-config and statusline writes',
      'prompt guidance as hard-gate authority',
      'line count as a production-readiness metric',
      'reduced verification obligations'
    ]
  }
};

function validateValues(values: string[], field: string): void {
  if (values.length === 0) throw new Error(`empty implementation standard ${field}`);
  if (values.some((value) => value.trim().length === 0)) {
    throw new Error(`blank implementation standard ${field}`);
  }
  if (new Set(values.map((value) => value.trim())).size !== values.length) {
    throw new Error(`duplicate implementation standard ${field}`);
  }
}

function cloneStandard(input: ImplementationStandard): ImplementationStandard {
  return {
    ...input,
    principles: [...input.principles],
    nonNegotiables: [...input.nonNegotiables],
    removalCandidates: [...input.removalCandidates],
    boundaries: [...input.boundaries],
    sourceModel: {
      ...input.sourceModel,
      adoptedIdeas: [...input.sourceModel.adoptedIdeas],
      rejectedIdeas: [...input.sourceModel.rejectedIdeas]
    }
  };
}

export function validateImplementationStandard(input: ImplementationStandard): ImplementationStandard {
  if (input.schema !== 'ccpanes.implementation-standard.v1') {
    throw new Error(`invalid implementation standard schema: ${input.schema}`);
  }
  if (input.level !== 'production-grade') {
    throw new Error(`invalid implementation standard level: ${input.level}`);
  }
  if (input.optimizationTarget !== 'unnecessary-complexity') {
    throw new Error(`invalid implementation standard optimization target: ${input.optimizationTarget}`);
  }
  if (input.sourceModel.name !== 'ccpanes.production-grade-solution-economy.v1') {
    throw new Error(`invalid implementation standard source model: ${input.sourceModel.name}`);
  }
  if (input.sourceModel.adaptedFrom !== PONYTAIL_REPOSITORY) {
    throw new Error(`invalid implementation standard source repository: ${input.sourceModel.adaptedFrom}`);
  }
  if (input.sourceModel.referenceHead !== PONYTAIL_REFERENCE_HEAD) {
    throw new Error(`invalid implementation standard reference HEAD: ${input.sourceModel.referenceHead}`);
  }

  validateValues(input.principles, 'principles');
  validateValues(input.nonNegotiables, 'nonNegotiables');
  validateValues(input.removalCandidates, 'removalCandidates');
  validateValues(input.boundaries, 'boundaries');
  validateValues(input.sourceModel.adoptedIdeas, 'sourceModel.adoptedIdeas');
  validateValues(input.sourceModel.rejectedIdeas, 'sourceModel.rejectedIdeas');
  return cloneStandard(input);
}

export function createImplementationStandard(): ImplementationStandard {
  return validateImplementationStandard(cloneStandard(standard));
}
