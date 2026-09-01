# Global Bootstrap and Exact Worktree Task Binding

## Goal

Make a fresh Codex App/CLI session able to resolve the correct task handoff
artifacts from its current worktree without relying on a copied chat history or
an ambiguous parent-directory binding.

## Non-goals

- This change does not inject full `HANDOFF.md` or `context.md` into a model
  context.
- This change does not call, restart, or mutate the Coordinator or Official
  CC-Panes.
- This change does not modify user Codex/CC-Panes configuration or install the
  upstream Hook executable.
- This change does not claim that Companion MCP is loaded; MCP inventory and
  preflight remain a separate runtime check.

## Design

The Hooks tooling gains a strict JSON registry with schema
`ccpanes.task-binding-registry.v1`. Each entry names one canonical worktree and
the corresponding handoff/context files. A bootstrap resolver selects the
longest matching worktree prefix, so a nested cwd resolves to its exact linked
worktree while sibling and parent projects remain isolated.

When the user registry is absent, the resolver falls back to a valid local
`.ccpanes-task/current-task.json` binding in the current worktree. This keeps
existing project-local tasks usable while the optional user-level registry is
being rolled out. Invalid registries fail closed rather than silently falling
back to another project.

The CLI exposes `bootstrap --cwd <dir> [--registry <file>]` and emits a small,
machine-readable `ccpanes.bootstrap.v1` result. `READY` means only that the
worktree binding and both handoff files resolved. It does not mean that MCP,
Coordinator, Worker, or Session runtime state is ready.

## Error semantics

The resolver returns typed statuses:

- `READY`
- `MISSING_TASK_BINDING`
- `REGISTRY_MISSING`
- `REGISTRY_INVALID`
- `CONTEXT_MISSING`

Paths are canonical absolute paths. Handoff and context paths must be inside
their registered worktree. Registry size, binding count, string lengths, and
duplicate worktree roots are bounded and validated.

## Verification

Tests cover exact nested-worktree resolution, sibling isolation, missing
context fail-closed behavior, local `current-task.json` fallback, and the
existing TypeScript type contract. A later rollout task can add registry
registration and SessionStart integration after the user-level installation
boundary is explicitly approved.
