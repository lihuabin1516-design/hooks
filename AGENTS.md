# hooks

> CC-Panes hooks governance repo

## Purpose

This repository uses the CC-Panes hook stack and the managed AGENTS template for
downstream projects. Do not install ad hoc project-local hooks here.

## Local Git checkpoint cadence

- Take a local Git checkpoint before a large edit burst, after the burst, and
  after a major update.
- Take one when a session crosses a day boundary with uncommitted work.
- Take one when the branch has stayed dirty for roughly 4 hours.
- Treat cross-file refactors, batch replacements, dependency upgrades, schema
  changes, migrations, and multi-bug repair batches as large edits.
- Minimum evidence: `git status --short --branch` and `git diff --stat`.
- If the task is authorized for commits, make a local checkpoint commit;
  otherwise keep the snapshot and continue.

## Template propagation

If you update `templates/AGENTS.ccpanes-hooks.md`, refresh existing projects
with `agents-install` or `bootstrap-project` so they load the updated managed
block in a fresh session.
