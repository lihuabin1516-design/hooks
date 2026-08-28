# Git Checkpoint Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-local Git checkpoint cadence to AGENTS guidance and the CC-Panes hooks template, then verify an existing project can load the updated instruction through a fresh session.

**Architecture:** Keep the human-readable rule in AGENTS.md, propagate it to new and refreshed projects through the managed CC-Panes AGENTS template, and document the refresh path for existing projects. Verify by opening a new CC-Panes worker against an existing project and checking that the updated instruction is visible from the loaded project context.

**Tech Stack:** Markdown, CC-Panes hooks CLI/docs, MCP worker dispatch, Git.

---

### Task 1: Add the checkpoint rule to the workspace and template guidance

**Files:**
- Modify: `D:/cc-pane/AGENTS.md`
- Modify: `D:/cc-pane/tool/repos/hooks/templates/AGENTS.ccpanes-hooks.md`

- [ ] **Step 1: Add the cadence rule to the workspace AGENTS guidance**
- [ ] **Step 2: Mirror the rule into the managed project AGENTS template**
- [ ] **Step 3: Keep the wording compatible with existing hook/bootstrap authorization boundaries**

### Task 2: Document how existing projects load the new instruction

**Files:**
- Modify: `D:/cc-pane/tool/repos/hooks/docs/quick-start.md`
- Modify: `D:/cc-pane/tool/repos/hooks/README.md`

- [ ] **Step 1: Add the refresh path for existing projects (`agents-install` / `bootstrap-project`)**
- [ ] **Step 2: Mention the hook surfaces that remind or gate checkpoint timing**

### Task 3: Verify with a fresh CC-Panes worker session on an existing project

**Files:**
- None

- [ ] **Step 1: Dispatch a read-only worker against an existing project**
- [ ] **Step 2: Confirm the worker reports the updated checkpoint guidance from loaded project context**
- [ ] **Step 3: Summarize the verification result and any remaining follow-up**
