# Production-Grade Solution Economy Design

Date: 2026-08-14

## 1. Goal

Add a machine-readable advisory standard that helps CC-Panes agents remove
unnecessary implementation complexity while preserving every capability needed
for production operation.

The governing principle is:

```text
Minimize unnecessary complexity, not production capability.
```

This work adapts selected ideas from Ponytail without importing its runtime,
mode state, user-configuration writes, or permission semantics.

Reference:

- Repository: `https://github.com/DietrichGebert/ponytail.git`
- Reviewed HEAD: `2ed6c52c9d7e5e56942508591085fd45dea277d3`
- License: MIT

## 2. Scope

### In scope

- Add an implementation-standard owner that produces deterministic,
  machine-readable production-grade guidance.
- Attach that guidance to workflow profiles for code-affecting routes.
- Keep read-only and documentation-only routes free of implementation guidance.
- Add deterministic unit tests and eval fixtures.
- Record the external reference, adopted ideas, rejected ideas, benchmark
  isolation requirements, and local ownership.
- Document that correctness, security, operability, recovery, and verification
  are necessary implementation costs rather than removable complexity.

### Out of scope

- Changing `hook-enforce`, `permission-enforce`, or project policy decisions.
- Adding a new hard gate or permission authority.
- Installing or vendoring Ponytail.
- Adding `lite`, `full`, `ultra`, or `off` runtime modes.
- Writing user-level Codex, Claude, or CC-Panes configuration.
- Changing task-binding, audit, acceptance, deployment, or live synchronization
  semantics.
- Treating line count as a production-readiness measure.

## 3. Architecture

### Canonical owner

Create:

```text
src/implementation-standard.ts
```

This module owns the meaning of the production-grade solution-economy
advisory. It does not own task risk, workflow routing, permissions, policy,
acceptance state, or live configuration.

### Consumer

`src/workflow-profile.ts` consumes the implementation-standard owner and adds
an optional `implementationStandard` field to
`ccpanes.workflow-profile.v1`.

The field is present for:

- `project-bootstrap`
- `project-policy`
- `hook-runtime`
- `production-gate`
- `implementation`

The field is `null` for:

- `read-only-review`
- `documentation`
- `other`

This keeps the guidance attached to implementation work without turning it into
generic prose on unrelated tasks.

### Contract shape

```ts
interface ImplementationStandard {
  schema: 'ccpanes.implementation-standard.v1';
  level: 'production-grade';
  optimizationTarget: 'unnecessary-complexity';
  principles: string[];
  nonNegotiables: string[];
  removalCandidates: string[];
  boundaries: string[];
  sourceModel: {
    name: 'ccpanes.production-grade-solution-economy.v1';
    adaptedFrom: string;
    referenceHead: string;
    adoptedIdeas: string[];
    rejectedIdeas: string[];
  };
}
```

The structure is deterministic and contains no model-generated classification.
Its purpose is to make the engineering standard reusable by CLI output,
SessionStart consumers, UI consumers, eval fixtures, and future planning tools.

## 4. Production-Grade Invariant

The implementation standard must state that the following are production
requirements and therefore outside the complexity-removal target:

- Correctness and explicit edge-case behavior.
- Input validation at trust boundaries.
- Authentication, authorization, security, and privacy.
- Data integrity, idempotency, ordering, and consistency where applicable.
- Error semantics, unknown-outcome handling, recovery, and reconciliation.
- Compatibility, migration, rollout, and rollback requirements.
- Logging, auditability, metrics, tracing, and operational diagnostics.
- Measured performance and capacity requirements.
- Tests, type checks, builds, smoke checks, and acceptance evidence.
- Deployment, support, and maintainability requirements owned by the product.

The optimization target is limited to:

- Duplicate implementations when a canonical owner exists.
- Speculative abstractions with no current consumer.
- Configuration with no supported operational need.
- New dependencies where existing code, standard libraries, or platform
  capabilities meet the full production contract.
- Layers and wrappers that do not improve ownership, contracts, testing,
  observability, recovery, or compatibility.
- Boilerplate that carries no required semantics.

The advisory must not recommend a smaller implementation when that
implementation weakens any production invariant.

## 5. Workflow and Authority

```text
prompt + changed paths
  -> task-risk.ts
  -> workflow-profile.ts
  -> implementation-standard.ts advisory
  -> workflow profile JSON

tool event
  -> hook-event-adapter.ts
  -> hook-enforce / permission-enforce
  -> allow or block
```

These flows remain separate:

- `implementation-standard.ts` advises what quality and economy mean.
- `workflow-profile.ts` routes tasks and recommends closure checks.
- `current-task.json` remains the task-scope authority.
- `policy.json` remains the executable project-policy authority.
- `hook-enforce` and `permission-enforce` remain hard-gate authorities.
- Acceptance artifacts remain the completion evidence.

No advisory field may independently permit, deny, approve, complete, deploy,
or modify a task.

## 6. Evaluation

### Unit tests

Add `tests/implementation-standard.test.ts` covering:

- The standard is explicitly `production-grade`.
- The optimization target is only `unnecessary-complexity`.
- Every required production capability is represented.
- Removal candidates do not include tests, validation, security,
  observability, recovery, compatibility, or rollback.
- The source reference and rejected runtime ideas are recorded.
- Returned records are isolated copies so consumers cannot mutate the
  canonical standard.

### Workflow tests

Update `tests/workflow-profile.test.ts` to verify:

- Implementation and production routes include the standard.
- Read-only and documentation routes return `null`.
- Existing route, rigor, closure, gate, and check behavior remains unchanged.

### Eval fixtures

Extend `examples/evals/workflow-profile-eval-cases.json` and
`tests/workflow-profile-eval-fixtures.test.ts` with assertions that:

- A production request keeps production closure and production-grade guidance.
- A hook-runtime change keeps synthetic fixtures and production-quality
  non-negotiables.
- A request to “make it minimal” does not downgrade required verification.
- A documentation-only adoption record remains light and has no implementation
  standard.

Eval fixtures remain deterministic and do not use an LLM judge.

### Benchmark isolation

`docs/PONYTAIL-ADOPTION.md` must require future agentic comparisons to:

- Pin the target repository and commit.
- Use a clean disposable workspace per arm.
- Isolate user/global plugins, hooks, skills, configuration, and conversation
  history from the baseline.
- Load only the intended treatment for each arm.
- Record actual `git diff`, status, commands, exit codes, duration, and
  environment prerequisites.
- Score correctness, security, scope, and required production behavior before
  LOC, tokens, cost, or duration.
- Preserve raw workspaces or artifacts for offline rescoring.
- Treat missing dependencies as `blocked`, not as a passing or failing product
  result.

## 7. Error and Compatibility Behavior

- The implementation standard is static and cannot fail due to filesystem,
  network, user configuration, or external model availability.
- Validation rejects duplicate or empty entries before returning the standard.
- Adding `implementationStandard` is an additive workflow-profile field.
- Existing consumers that ignore unknown JSON fields remain compatible.
- TypeScript consumers compiling directly against
  `WorkflowProfileResult` must be updated in this repository.
- The schema name remains `ccpanes.workflow-profile.v1` because existing fields
  and semantics are unchanged; the new nested record carries its own versioned
  schema.

## 8. Verification and Acceptance

Required checks:

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
git status --short --branch
```

Acceptance assertions:

1. All code-affecting workflow routes expose
   `ccpanes.implementation-standard.v1`.
2. The standard always identifies itself as `production-grade`.
3. No standard text treats production safeguards as removable complexity.
4. Read-only and documentation routes do not receive implementation guidance.
5. Existing hard-gate, policy, task-binding, closure, and acceptance behavior
   remains unchanged.
6. No dependency, user configuration, live prototype, or external repository is
   modified.
7. Reference repositories remain clean.

## 9. Recovery

The change is additive and stateless. Recovery consists of reverting:

```text
src/implementation-standard.ts
tests/implementation-standard.test.ts
src/workflow-profile.ts
tests/workflow-profile.test.ts
examples/evals/workflow-profile-eval-cases.json
tests/workflow-profile-eval-fixtures.test.ts
docs/PONYTAIL-ADOPTION.md
```

No migration, backfill, user-config restoration, live rollback, or data
reconciliation is required.
