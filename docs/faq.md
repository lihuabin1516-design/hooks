# FAQ

## Is this tied to one host?

No. The core model is agent-agnostic. CC-Panes is a compatible host, not the whole project.

## What problem does this solve?

It turns soft coordination into enforceable contracts: task scope, policy gates, hook audits, session handoff, and acceptance evidence.

## What does it replace?

It does not replace your agent runtime, editor, or desktop shell. It adds a governance layer around them.

## What if my runtime is not listed yet?

If it can emit comparable hook events or call the CLI, it can usually adopt the same contract. Otherwise treat it as a candidate until you have fixtures and verification evidence.

## How do I know it works?

Run the verification commands in the README, then check the compatibility page and live consistency output.

## Where are operational details?

[`MAINTENANCE.md`](../MAINTENANCE.md) keeps internal paths, sync flow, and maintainer-only notes out of the public README.

## How do I upgrade safely?

Pull the latest repo, rerun verification, then sync the live runtime and rerun the live checks.
