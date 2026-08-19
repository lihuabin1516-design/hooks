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

## What happens next

We will review the report, reproduce it in a clean fixture when possible, and
respond with fix status or follow-up questions.
