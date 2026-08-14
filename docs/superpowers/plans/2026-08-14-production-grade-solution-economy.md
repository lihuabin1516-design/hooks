# Production-Grade Solution Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic production-grade implementation guidance to code-affecting workflow profiles while preserving all existing hard-gate, policy, closure, and acceptance behavior.

**Architecture:** A new `implementation-standard.ts` module owns one immutable-by-copy advisory record. `workflow-profile.ts` attaches it only to code-affecting routes. Tests and eval fixtures prove that “minimal” removes unnecessary complexity but never downgrades security, reliability, observability, recovery, compatibility, or verification.

**Tech Stack:** TypeScript ESM, Vitest, JSON eval fixtures, Node.js 22.

**Authorization:** Modify only the files named below. Do not stage, commit, sync to live, install dependencies, write user configuration, or modify reference repositories.

---

## File Map

- Create `src/implementation-standard.ts`: canonical advisory contract, validation, and copy-returning factory.
- Create `tests/implementation-standard.test.ts`: direct contract and mutation-isolation tests.
- Modify `src/workflow-profile.ts`: optional `implementationStandard` field and route attachment.
- Modify `tests/workflow-profile.test.ts`: route-level presence and absence assertions.
- Modify `examples/evals/workflow-profile-eval-cases.json`: production-grade guidance expectations.
- Modify `tests/workflow-profile-eval-fixtures.test.ts`: generic nested guidance assertions.
- Modify `tests/cli.test.ts`: CLI serialization assertion.
- Modify `scripts/smoke.mjs`: built CLI smoke assertion.
- Create `docs/PONYTAIL-ADOPTION.md`: reference boundary and benchmark isolation rules.
- Modify `tests/plan-intake.test.ts`: nested workflow compatibility assertions.
- Modify `src/host-adapter-registry.ts`, `tests/host-adapter-registry.test.ts`, and
  `docs/CCPANES-HOOK-HOST-ADAPTER-MATRIX.md`: correct the mechanical policy
  authority path discovered during review.
- Keep `docs/superpowers/specs/2026-08-14-production-grade-solution-economy-design.md` as the approved design.

### Task 1: Define the implementation-standard contract

**Files:**
- Create: `tests/implementation-standard.test.ts`
- Create: `src/implementation-standard.ts`

- [ ] **Step 1: Write the failing contract tests**

Add tests that import `createImplementationStandard` and assert:

```ts
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
```

Also assert that removal candidates contain duplicate implementations,
speculative abstractions, unsupported configuration, avoidable dependencies,
semantics-free wrappers, and boilerplate, while not naming tests, security,
validation, recovery, observability, compatibility, or rollback as removal
targets.

Finally mutate arrays on one returned object and assert a second call returns
the original canonical values.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/implementation-standard.test.ts
```

Expected: FAIL because `src/implementation-standard.ts` does not exist.

- [ ] **Step 3: Implement the canonical record**

Create exported interfaces:

```ts
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
```

Implement:

```ts
export function validateImplementationStandard(
  input: ImplementationStandard
): ImplementationStandard

export function createImplementationStandard(): ImplementationStandard
```

Validation must reject empty arrays, blank values, duplicate values within each
array, a wrong schema, level, optimization target, source name, reference URL,
or reference HEAD. Return a deep copy so callers cannot mutate the canonical
record.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run tests/implementation-standard.test.ts
```

Expected: PASS.

### Task 2: Attach guidance to workflow profiles

**Files:**
- Modify: `tests/workflow-profile.test.ts`
- Modify: `src/workflow-profile.ts`

- [ ] **Step 1: Write failing route-level tests**

Update existing tests to assert:

```ts
expect(readOnlyResult.implementationStandard).toBeNull();
expect(documentationResult.implementationStandard).toBeNull();
expect(hookResult.implementationStandard).toMatchObject({
  schema: 'ccpanes.implementation-standard.v1',
  level: 'production-grade',
  optimizationTarget: 'unnecessary-complexity'
});
expect(productionResult.implementationStandard?.nonNegotiables)
  .toContain('security, authorization, and privacy requirements');
```

Add an implementation-route case using:

```ts
{
  prompt: '实现最小版本，但必须达到生产级可靠性',
  changedPaths: ['src/feature.ts', 'tests/feature.test.ts']
}
```

Assert the existing production-risk classifier promotes the route to
`production-gate`, closure remains `production`, and the guidance includes
recovery, observability, and verification requirements. Do not weaken the
existing production route to satisfy a smaller implementation expectation.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx vitest run tests/workflow-profile.test.ts
```

Expected: FAIL because `implementationStandard` is absent.

- [ ] **Step 3: Add the workflow field**

Import the implementation-standard type and factory. Add:

```ts
implementationStandard: ImplementationStandard | null;
```

Define code-affecting routes as:

```ts
project-bootstrap
project-policy
hook-runtime
production-gate
implementation
```

Return a fresh standard for those routes and `null` for
`read-only-review`, `documentation`, and `other`.

Do not change route detection, risk classification, checks, gates, boundaries,
closure flags, or schema names.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx vitest run tests/workflow-profile.test.ts
```

Expected: PASS.

### Task 3: Extend deterministic eval fixtures

**Files:**
- Modify: `examples/evals/workflow-profile-eval-cases.json`
- Modify: `tests/workflow-profile-eval-fixtures.test.ts`

- [ ] **Step 1: Add failing fixture expectations**

Add optional fixture fields:

```ts
implementationStandard: {
  present: boolean;
  level?: string;
  optimizationTarget?: string;
  requiredNonNegotiables?: string[];
}
```

Update cases:

- Read-only architecture research: `present: false`.
- Hook runtime adapter: `present: true`, production-grade, require security,
  recovery, observability, and verification entries.
- Production user config: `present: true`, production-grade.
- Documentation adoption record: `present: false`.

Add a case whose prompt requests a minimal production implementation and whose
changed paths are source and tests. Require `production` closure, local and
acceptance checks, and the production-grade standard.

- [ ] **Step 2: Run the fixture test and verify RED**

Run:

```powershell
npx vitest run tests/workflow-profile-eval-fixtures.test.ts
```

Expected: FAIL because the test harness does not inspect the new field or the
workflow output lacks it.

- [ ] **Step 3: Implement generic fixture assertions**

When `present` is true, require a non-null standard and verify all specified
fields and non-negotiable entries. When false, require `null`.

- [ ] **Step 4: Run the fixture test and verify GREEN**

Run:

```powershell
npx vitest run tests/workflow-profile-eval-fixtures.test.ts
```

Expected: PASS.

### Task 4: Verify CLI and built smoke surfaces

**Files:**
- Modify: `tests/cli.test.ts`
- Modify: `scripts/smoke.mjs`

- [ ] **Step 1: Add failing CLI assertion**

In the existing `classify-workflow` CLI test, assert:

```ts
expect(parsed.implementationStandard).toMatchObject({
  schema: 'ccpanes.implementation-standard.v1',
  level: 'production-grade'
});
```

- [ ] **Step 2: Run the focused CLI test**

Run:

```powershell
npx vitest run tests/cli.test.ts -t "classifies workflow profile through CLI"
```

Expected: PASS after Task 2 because CLI serializes the workflow result without a
separate adapter. This is a serialization coverage check, not a new production
behavior test.

- [ ] **Step 3: Add smoke assertion**

After the built CLI creates `workflowProfile`, assert:

```js
assert(
  workflowProfile.implementationStandard?.level === 'production-grade',
  'workflow profile expected production-grade implementation standard'
);
```

- [ ] **Step 4: Defer smoke execution until the build gate**

The smoke script imports built `dist` output. Run it only after
`npm run build` in the final verification phase.

### Task 5: Record adoption and benchmark isolation

**Files:**
- Create: `docs/PONYTAIL-ADOPTION.md`

- [ ] **Step 1: Write the adoption record**

Document:

- Reference repository, reviewed HEAD, date, and MIT license.
- Adopted: reuse-first ladder, standard-library/platform preference,
  unnecessary-complexity review, thin adapter principle, isolated agentic
  benchmark method.
- Rejected: runtime modes, user-config state, statusline writes, prompt rules as
  hard gates, line count as the primary production metric, and reduced test
  obligations.
- Local owner mapping.
- Production-grade invariant and removal boundary.
- Baseline isolation, pinned repositories, disposable workspaces, treatment-only
  plugin loading, raw artifact retention, environment prerequisite recording,
  and blocked-check semantics.

- [ ] **Step 2: Review the document against the implementation**

Verify names, schemas, route lists, reference commit, and local owner paths match
the code and approved design.

### Task 6: Full verification and scope audit

**Files:**
- Inspect all changed files.

- [ ] **Step 1: Run focused tests together**

```powershell
npx vitest run tests/implementation-standard.test.ts tests/workflow-profile.test.ts tests/workflow-profile-eval-fixtures.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run all repository gates**

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Inspect reference repositories**

```powershell
git -C D:\cc-pane\tool\repos\comet status --short --branch
git -C D:\cc-pane\tool\repos\fastctx status --short --branch
```

Expected: no changed paths.

- [ ] **Step 4: Inspect final task diff and status**

```powershell
git diff --stat
git diff -- src tests examples docs scripts
git status --short --branch
```

Expected:

- Only authorized files changed.
- Existing untracked `.ccpanes/` and `CLAUDE.md` remain untouched.
- No staged changes.
- No live, user-config, dependency, or reference-repository changes.

- [ ] **Step 5: Report verification**

Use `pass/fail/blocked/not-run` for each required check. Include residual
compatibility risk from the additive workflow-profile field and state that no
commit, live synchronization, or user-config write occurred.
