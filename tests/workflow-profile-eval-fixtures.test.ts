import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { classifyWorkflowProfile } from '../src/workflow-profile.js';

interface WorkflowProfileEvalFixture {
  schema: 'ccpanes.workflow-profile-eval-cases.v1';
  cases: WorkflowProfileEvalCase[];
}

interface WorkflowProfileEvalCase {
  id: string;
  description: string;
  prompt: string;
  changedPaths: string[];
  expected: {
    routeId: string;
    rigor: string;
    closureBucket: string;
    requiredCheckNames?: string[];
    requiredGates?: string[];
    closureFlags?: Record<string, boolean>;
    riskDimensions?: Record<string, boolean>;
    implementationStandard: {
      present: boolean;
      level?: string;
      optimizationTarget?: string;
      requiredNonNegotiables?: string[];
    };
  };
}

function readFixture(): WorkflowProfileEvalFixture {
  const fixturePath = path.resolve('examples/evals/workflow-profile-eval-cases.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as WorkflowProfileEvalFixture;
}

function implementationStandardExpectation(evalCase: WorkflowProfileEvalCase): WorkflowProfileEvalCase['expected']['implementationStandard'] {
  const standard = evalCase.expected.implementationStandard;
  if (!standard || typeof standard.present !== 'boolean') {
    throw new Error(`${evalCase.id}: missing implementationStandard expectation`);
  }
  return standard;
}

describe('workflow profile eval fixtures', () => {
  const fixture = readFixture();

  test('uses the expected fixture schema', () => {
    expect(fixture.schema).toBe('ccpanes.workflow-profile-eval-cases.v1');
    expect(fixture.cases.length).toBeGreaterThanOrEqual(6);
  });

  test('fails closed when a fixture omits the implementation standard expectation', () => {
    const evalCase = {
      ...fixture.cases[0],
      expected: {
        ...fixture.cases[0].expected,
        implementationStandard: undefined
      }
    } as unknown as WorkflowProfileEvalCase;

    expect(() => implementationStandardExpectation(evalCase)).toThrow(
      `${evalCase.id}: missing implementationStandard expectation`
    );
  });

  test.each(fixture.cases)('$id: $description', (evalCase) => {
    const result = classifyWorkflowProfile({
      prompt: evalCase.prompt,
      cwd: 'D:/cc-pane/tool/repos/hooks',
      changedPaths: evalCase.changedPaths
    });

    expect(result.schema).toBe('ccpanes.workflow-profile.v1');
    expect(result.route.id).toBe(evalCase.expected.routeId);
    expect(result.rigor).toBe(evalCase.expected.rigor);
    expect(result.closure.bucket).toBe(evalCase.expected.closureBucket);

    const checkNames = result.checks.map((check) => check.name);
    for (const expectedCheck of evalCase.expected.requiredCheckNames ?? []) {
      expect(checkNames, evalCase.id).toContain(expectedCheck);
    }

    for (const expectedGate of evalCase.expected.requiredGates ?? []) {
      expect(result.gates, evalCase.id).toContain(expectedGate);
    }

    for (const [field, expectedValue] of Object.entries(evalCase.expected.closureFlags ?? {})) {
      expect(result.closure[field as keyof typeof result.closure], `${evalCase.id}:${field}`).toBe(expectedValue);
    }

    for (const [field, expectedValue] of Object.entries(evalCase.expected.riskDimensions ?? {})) {
      expect(result.risk.dimensions[field as keyof typeof result.risk.dimensions], `${evalCase.id}:${field}`).toBe(expectedValue);
    }

    const expectedStandard = implementationStandardExpectation(evalCase);
    if (expectedStandard.present === false) {
      expect(result.implementationStandard, evalCase.id).toBeNull();
    }
    if (expectedStandard.present === true) {
      expect(result.implementationStandard, evalCase.id).not.toBeNull();
      expect(result.implementationStandard?.level, evalCase.id).toBe(expectedStandard.level);
      expect(result.implementationStandard?.optimizationTarget, evalCase.id).toBe(expectedStandard.optimizationTarget);
      for (const nonNegotiable of expectedStandard.requiredNonNegotiables ?? []) {
        expect(result.implementationStandard?.nonNegotiables, evalCase.id).toContain(nonNegotiable);
      }
    }
  });
});
