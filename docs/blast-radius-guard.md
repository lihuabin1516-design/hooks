# Destructive Command Semantic Guard

This repository absorbs the command-analysis ideas from
[`xinghe-labs/blast-radius-guard`](https://github.com/xinghe-labs/blast-radius-guard),
pinned to release `v0.3.0` at commit
`aa2721d9b7c4e5620ccfdc27b54e30821405cb8f`. The upstream project is MIT licensed
and was used as a read-only reference before the TypeScript implementation was
written here.

## Ownership

`src/blast-radius-guard.ts` owns semantic analysis. It is called by
`src/hook-shell-analyzer.ts` for shell, Bash, PowerShell, and FastCtx `run` /
`run_background` events. The existing task binding, project policy, dry-run,
permission, and audit modules remain authoritative.

The analyzer reports a typed `paneforge.blast-radius-guard.v1` value containing:

- `allow`, `warn`, or `block` verdict;
- hazard codes and evidence identifiers;
- normalized command targets;
- bounded file counts, byte counts, and link counts when a recursive target is
  inspectable;
- explicit unknown-platform notes.

## Gate mapping

The upstream hook is fail-open when Python, the judge, or a timeout is missing.
That behavior is not imported. In this repository, a semantic `warn` or
`block` produces a policy reason and therefore remains blocked by the existing
fail-closed dry-run gate. Analyzer errors also remain hook errors rather than an
allow path.

The analyzer currently covers the high-value upstream hazards H0-H13 that can
be evaluated without a separate runtime: ambiguous quoting and variables,
volume roots, case collisions, recursive links, CJK paths, cwd ancestors,
recursive globs, permanent deletion, privilege escalation, Linux system
prefixes and mount points, and macOS home-special directories. It also handles
`find -delete`, `git clean`, `git worktree remove`, `rsync --delete`, and
`robocopy /MIR` intent forms.

This is semantic evidence, not a permission bypass. A target outside the active
task worktree, a forbidden user-config path, or a task-phase restriction still
blocks independently.

The analyzer recognizes the command forms listed above and selected inline
interpreter filesystem APIs. It does not inspect arbitrary script files or
prove the effects of unknown programs. Generic shell path authorization is not
a process sandbox, so opaque scripts that can mutate the filesystem remain a
separate enforcement boundary.

## Verification

The focused contract is covered by:

- `tests/blast-radius-guard.test.ts` for hazard and bounded filesystem cases;
- `tests/hook-shell-analyzer.test.ts` for policy and audit attachment;
- `tests/hook-event-adapter.test.ts` for FastCtx shell events;
- `tests/hook-runner.test.ts` for the final fail-closed decision.

Do not install the upstream Python hook, pi extension, global skill, or user
configuration as part of this integration. If future compatibility requires
running the upstream Python engine unchanged, write a separate sidecar
contract before adding that runtime.
