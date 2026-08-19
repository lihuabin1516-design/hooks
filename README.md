# Agent Hooks Governance Layer

<p align="center">
  <a href="https://github.com/lihuabin1516-design/hooks/actions/workflows/verify.yml"><img src="https://github.com/lihuabin1516-design/hooks/actions/workflows/verify.yml/badge.svg" alt="verify" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22-339933" alt="Node.js >= 22" />
  <a href="https://github.com/lihuabin1516-design/hooks/blob/main/docs/quick-start.md"><img src="https://img.shields.io/badge/docs-quick%20start-0ea5e9" alt="docs quick start" /></a>
  <a href="https://github.com/lihuabin1516-design/hooks/blob/main/docs/compatibility.md"><img src="https://img.shields.io/badge/compatibility-matrix-8b5cf6" alt="compatibility matrix" /></a>
  <img src="https://img.shields.io/badge/hooks-fail--closed-111827" alt="fail closed hooks" />
</p>

> 面向所有 hook-capable agent runtime 的外部治理层。它把 task binding、policy gates、workflow advice、session bridge 和 acceptance evidence 变成可审计、可验证、可推广的工程边界。

在多 agent、多 worktree、多终端并行协作时，最容易失控的不是“模型能不能写代码”，而是：

- 谁在负责这个 task；
- 哪些操作真的被授权；
- hook 结果有没有证据；
- 不同宿主之间的行为是否一致；
- 发布前能不能重新验证。

这个仓库把这些问题收成一组 TypeScript CLI、策略文件、审计 artifact 和验证命令。

## Why this repo

| Problem | This repo gives you |
| --- | --- |
| Task drift | Current task binding with canonical worktree ownership checks |
| Soft rules | Policy capture that turns intent into executable gates |
| Invisible side effects | Block / allow / audit outputs with durable evidence |
| Host differences | One core contract, host-specific adapters |
| Release uncertainty | Verification, compatibility, and live consistency checks |

## Why teams choose it

- **Fail-closed by default** — ambiguity blocks instead of guessing.
- **Typed contracts end-to-end** — task, policy, hook, session, and acceptance artifacts stay schema-driven.
- **Audit before trust** — every block, approval, and release step leaves evidence.
- **Host-agnostic core** — one contract across supported runtimes.
- **Fast verification loop** — typecheck, test, build, smoke, install checks, and live consistency are all built in.

## Use cases

- Multiple agent sessions touching the same repo or worktree.
- Projects that need prompt-time guidance without losing hard gates.
- Teams that want policy, audit, and acceptance evidence instead of ad hoc conventions.
- Tooling that must stay compatible across hosts over time.

## Compatibility

| Target | Status | Notes |
| --- | --- | --- |
| Node.js 22+ | required | Repository scripts and CI target this baseline. |
| Windows | primary validated | GitHub Actions runs on `windows-latest`. |
| Codex App | supported | First-class hook path. |
| CC-Panes | compatible | Same core contract, with a host-specific integration path. |
| Other hook-capable runtimes | candidate | Track them through the generic CLI / adapter model. |

If a runtime can emit comparable hook events or invoke the CLI, the core contracts still apply.

## Core capabilities

| Capability | What it does |
| --- | --- |
| Task Binding | Writes and verifies the current task for a project / worktree. |
| Project Policy Gate | Captures human rules into machine-readable policy. |
| Hook Enforcement | Applies allow / deny / audit logic to hook events. |
| Workflow Advisory | Suggests risk level, workflow shape, and checks before work starts. |
| Session Bridge | Builds read-only session indexes and handoff artifacts. |
| Acceptance Evidence | Records checks, artifact hashes, truth layers, and completion gates. |
| Live Consistency | Compares repo source, build output, and live runtime state. |

## How it works

```text
agent runtime event
  -> node dist/src/cli.js <command>
  -> current task binding + project policy
  -> hook / workflow / session logic
  -> audit artifact / acceptance evidence
```

Default mode is fail closed: if task scope, policy, path scope, Git topology, or command semantics are unclear, the hook does not guess.

## Quick start

```powershell
git clone https://github.com/lihuabin1516-design/hooks.git
cd hooks
npm ci
npm run verify
```

Bootstrap a project:

```powershell
node dist/src/cli.js bootstrap-project `
  --root <project-root> `
  --task-id <task-id> `
  --phase shape
```

Capture a plan-stage rule:

```powershell
node dist/src/cli.js policy-capture-plan `
  --root <project-root> `
  --utterance "计划阶段规则：禁止运行 publish-artifact，除非我明确解除。"
```

Run a hook gate:

```powershell
node dist/src/cli.js hook-enforce `
  --resolve-task-from-cwd `
  --audit-root <audit-root>
```

## FAQ

### Is this tied to one host?
No. CC-Panes is a compatible host, not the whole story. The core contract is agent-agnostic.

### Does this replace my agent runtime or IDE?
No. It sits beside the runtime and adds task scope, policy gates, audits, and verification.

### What if my host is not listed yet?
If it can expose hook-like events or call the CLI, it can usually join the same model. Otherwise it belongs in the candidate lane until you have fixtures and verification.

### Where do maintenance details live?
[`MAINTENANCE.md`](./MAINTENANCE.md) keeps internal paths, sync flow, and operational notes.

## Docs

- [`docs/quick-start.md`](./docs/quick-start.md) — first steps and short commands.
- [`docs/compatibility.md`](./docs/compatibility.md) — supported hosts, surfaces, and verification notes.
- [`docs/faq.md`](./docs/faq.md) — expanded questions and answers.
- [`docs/releases/2026-08-19-agent-hooks-homepage-refresh.md`](./docs/releases/2026-08-19-agent-hooks-homepage-refresh.md) — this publicization release note.
- [`docs/architecture.md`](./docs/architecture.md) — source-level module boundaries.
- [`docs/artifacts.md`](./docs/artifacts.md) — artifact and schema index.
- [`docs/codex-session-bridge.md`](./docs/codex-session-bridge.md) — session bridge details.
- [`MAINTENANCE.md`](./MAINTENANCE.md) — verification and live sync for maintainers.

## Support

- Issues: [github.com/lihuabin1516-design/hooks/issues](https://github.com/lihuabin1516-design/hooks/issues)
- Discussions: [github.com/lihuabin1516-design/hooks/discussions](https://github.com/lihuabin1516-design/hooks/discussions)
