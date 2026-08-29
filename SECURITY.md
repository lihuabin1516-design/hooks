# Security Policy

This repository is a governance layer that can block tool use, shape policy
decisions, and write audit artifacts. Treat any issue that could bypass a
fail-closed decision, escape the authorized worktree, or expose secrets as
security-sensitive.

## Supported branches

- `main`
- the latest commit that has been verified with `npm run verify`

## How to report a security issue

Use GitHub's private security advisory flow for this repository.

Include:

- the affected command or hook path
- the minimal repro input
- the expected result
- the actual result
- whether the issue touches secrets, audit data, or path boundaries

Do not include live credentials, tokens, or production data in public issues.

## External publication scope

External publication is fail-closed by default. A task may contain
`authorizedExternalWriteRoots`, an audited list of at most eight canonical
absolute paths, when a reviewed workflow needs to publish Git history.

That list has deliberately narrow semantics:

- only the `external_publication_git_push` policy reason can use it;
- the target path must be inside one of the registered roots;
- ordinary file writes and unrelated shell commands do not inherit the scope;
- a root must not be used as a proxy for a user or organization approval;
- credentials, tokens, personal configuration directories, and production data
  must never be placed in the task file.

Hooks must reject malformed, relative, non-canonical, duplicate, or
over-capacity root lists. Any change to publication scope should remain
reviewable in the task binding and its enforcement audit.

## What happens next

We will review the report, reproduce it in a clean fixture when possible, and
respond with fix status or follow-up questions.
