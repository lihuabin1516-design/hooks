# Hooks Linked Worktrees Registry

**Registry date:** 2026-08-28
**Repository:** `D:\cc-pane\tool\repos\hooks`
**Authority:** Git worktree metadata, queried with `git worktree list --porcelain`

This file is a navigation record for the linked worktrees currently registered
for this repository. The Git worktree metadata remains authoritative and
survives closure of the Codex task or conversation.

## Registered worktrees

| Path | Branch / state | Baseline | Use |
|---|---|---|---|
| `D:\cc-pane\tool\repos\hooks` | `main` | `0a70b9f` | primary checkout; contains pre-existing local changes |
| `C:\Users\AI001\.config\superpowers\worktrees\hooks\codex-cli-resume-lock` | `fix/codex-cli-resume-lock` | `0a70b9f` | historical isolated repair |
| `C:\Users\AI001\.config\superpowers\worktrees\hooks\production-readiness-20260828` | `fix/production-readiness-20260828` | `0a70b9f` | historical production-readiness worktree |
| `D:\cc-pane\.worktrees\hooks-phase51-task-binding` | `codex/hooks-phase51-task-binding` | `e5e4fbd` | historical task-binding fixture |
| `D:\cc-pane\.worktrees\hooks-production-readiness-20260828` | `fix/production-readiness-20260828-local` | `0a70b9f` | historical test-isolation repair; contains local changes |
| `D:\cc-pane\.worktrees\hooks-production-runtime-20260828` | `codex/hooks-production-runtime-20260828` | `0a70b9f` | clean execution entry for the production-runtime task |

## Recovery

```powershell
git -C D:\cc-pane\tool\repos\hooks worktree list --porcelain
git -C D:\cc-pane\tool\repos\hooks worktree repair
git -C D:\cc-pane\.worktrees\hooks-production-runtime-20260828 status --short --branch
```

Do not remove a worktree based only on this document. Inspect Git metadata and
the worktree status first. Existing local changes are preserved by policy.
