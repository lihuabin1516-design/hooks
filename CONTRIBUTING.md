# Contributing

Thanks for helping improve `hooks`.

## Before you open a PR

Run the repository checks from the repo root:

```powershell
npm run verify
npm audit --audit-level=high
git diff --check
```

If your change touches public docs, CLI behavior, policy behavior, or artifact
schema output, update the relevant documentation and tests in the same PR.

## Good PR shape

- one user-facing change per PR when possible
- a short summary of the problem and the fix
- exact verification output for any behavior change
- docs updated when the public contract changes

## Issue quality

When filing a bug or feature request, include:

- the command you ran
- the input you used
- the output you expected
- the output you saw
- your OS and Node.js version

## Commit style

Use short imperative messages, for example:

```text
docs: add security policy
docs: expand quick start example
```
