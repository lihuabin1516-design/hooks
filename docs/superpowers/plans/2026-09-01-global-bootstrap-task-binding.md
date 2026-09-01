# Global Bootstrap and Exact Worktree Task Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed bootstrap resolver that maps a fresh session's cwd to the exact task worktree and its handoff artifacts.

**Architecture:** A bounded JSON registry provides optional user-level exact worktree mappings. The resolver prefers the registry and falls back only to a valid local `current-task.json`; it returns a short status object and never mutates workflow state. The existing CLI task router exposes the resolver for SessionStart/bootstrap integration.

**Tech Stack:** TypeScript, Node.js standard library, Vitest.

---

### Task 1: Registry contract

**Files:**
- Create: `src/task-binding-registry.ts`
- Test: `tests/global-bootstrap.test.ts`

- [x] **Step 1: Write failing exact-match and isolation tests.**
- [x] **Step 2: Run the focused test and observe the missing-module failure.**
- [x] **Step 3: Implement bounded registry validation, atomic writing, reading, and longest-prefix matching.**
- [x] **Step 4: Run the focused test and verify the registry behaviors pass.**

### Task 2: Bootstrap result contract

**Files:**
- Create: `src/global-bootstrap.ts`
- Modify: `src/cli/task.ts`
- Test: `tests/global-bootstrap.test.ts`

- [x] **Step 1: Add tests for `READY`, `CONTEXT_MISSING`, and local task fallback.**
- [x] **Step 2: Implement typed statuses and redacted path/status output.**
- [x] **Step 3: Add `bootstrap --cwd [--registry]` to the existing task command router.**
- [x] **Step 4: Run focused tests and TypeScript typecheck.**

### Task 3: Documentation and release verification

**Files:**
- Create: `docs/superpowers/specs/2026-09-01-global-bootstrap-task-binding-design.md`
- Create: `docs/superpowers/plans/2026-09-01-global-bootstrap-task-binding.md`
- Modify: `README.md`
- Modify: `ACCEPTANCE.md`

- [ ] **Step 1: Document the command and clarify that `READY` is not MCP readiness.**
- [ ] **Step 2: Run the full repository verification suite.**
- [ ] **Step 3: Inspect diff/status and commit the implementation.**
