# Codex Plugin Distribution Notes

目标：记录把 CC-Panes hooks 工具层包装为 Codex plugin 的后续方案。本文件只描述
设计和门禁，本轮仅产出设计记录，真实插件生成、用户配置变更和 live 同步留到后续授权步骤。

参考 do-it plugin 形态：

- commit: `7c2f60896fe6391f6cb364917351325f0aca85aa`
- Codex manifest: <https://github.com/tdwhere123/do-it/blob/7c2f60896fe6391f6cb364917351325f0aca85aa/plugins/do-it/.codex-plugin/plugin.json>
- build script: <https://github.com/tdwhere123/do-it/blob/7c2f60896fe6391f6cb364917351325f0aca85aa/scripts/build-codex-plugin.mjs>
- maintenance guide: <https://github.com/tdwhere123/do-it/blob/7c2f60896fe6391f6cb364917351325f0aca85aa/docs/maintenance.md>

## Candidate Package Shape

```text
plugins/ccpanes-hooks/
  .codex-plugin/plugin.json
  hooks/hooks.json
  dist/src/cli.js
  docs/
  templates/
  examples/
```

`plugin.json` 应声明：

- `name`: `ccpanes-hooks`
- `skills`: optional future surface
- `hooks`: `./hooks/hooks.json`
- `interface.capabilities`: `Hooks`
- `defaultPrompt`: 提醒模型读取 task context、尊重 task worktree 和验收证据

## Generated Artifacts

后续新增构建脚本时采用单一来源：

```text
src/ + templates/ + docs/
  -> npm run build
  -> scripts/build-codex-plugin.mjs
  -> plugins/ccpanes-hooks/
```

生成物校验要求：

- manifest version 与 `package.json` 版本一致。
- bundled hook commands 只指向 plugin 内相对路径。
- `hooks.json` 中 PreToolUse / PermissionRequest / PostToolUse / SessionStart /
  Stop 与 `installed-hooks.ts` 的期望配置保持一致。
- 生成后用 `git diff --exit-code -- plugins/ccpanes-hooks` 证明 artifact 已登记。

## Doctor / Install Strategy

优先采用 marketplace-first 路径；CLI doctor 只做核验和迁移辅助：

```powershell
npm run build
node scripts/build-codex-plugin.mjs
CODEX_HOME=<tmp-home> codex plugin marketplace add <repo-root>
CODEX_HOME=<tmp-home> codex plugin add ccpanes-hooks@<marketplace-name>
node dist/src/cli.js verify-installed-hooks --hooks-json <tmp-home>\hooks.json --prototype-root <plugin-root> --audit-root <tmp-audit>
```

live 全局配置仍通过现有 production toolkit / approval package / final runbook
流程处理，并记录配置快照和回滚指令。

## Rollback Shape

plugin 分发包必须同时产出：

- `manifest.json`：文件清单和 SHA-256。
- `INSTALL-HOOKS.ps1`：逐项应用。
- `VERIFY-INSTALLED.ps1`：只读核验。
- `ROLLBACK-HOOKS.ps1`：从备份恢复。
- `EVIDENCE-INDEX.md`：连接生成物、检查和审批记录。

## Release Gates

插件化进入实现前，本仓库先满足：

```powershell
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
```

插件化实现完成后，增加：

```powershell
node scripts/build-codex-plugin.mjs
git diff --exit-code -- plugins/ccpanes-hooks
CODEX_HOME=<tmp-home> codex plugin marketplace add <repo-root>
CODEX_HOME=<tmp-home> codex plugin add ccpanes-hooks@<marketplace-name>
```

真实用户环境采用独立授权包推进，授权包内必须包含 exact diff、备份路径、
rollback command 和安装后 verify-installed-hooks 证据。
