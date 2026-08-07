# CC-Panes Task Probe Examples

这些样例是 synthetic fixture，只用于本地 dry-run 和文档说明。

推荐验证入口：

```powershell
npm run build
npm run smoke
```

手动命令形态：

```powershell
node dist/src/cli.js dry-run-hook --input examples/hook-batch.json
```

`examples/hook-batch.json` 使用相对路径，需从 prototype 根目录执行。
`examples/hook-events/` 提供 adapter 输入样例；实际执行 `adapt-hook-event` 时需配套一个已存在的 `current-task.json`：

```powershell
node dist/src/cli.js adapt-hook-event --task <project>\.ccpanes-task\current-task.json --event examples/hook-events/claude-edit.json
```

hook-runner stdin 形态：

```powershell
Get-Content examples/hook-runner-event.json -Raw | node dist/src/cli.js hook-runner --task <project>\.ccpanes-task\current-task.json
```

hook-enforce stdin 形态：

```powershell
Get-Content examples/hook-runner-event.json -Raw | node dist/src/cli.js hook-enforce --task <project>\.ccpanes-task\current-task.json --audit-out <project>\.ccpanes-task\hook-enforce-audit.json
Get-Content examples/hook-runner-event.json -Raw | node dist/src/cli.js hook-enforce --resolve-task-from-cwd --audit-root D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits
```

`hook-enforce` 用于 Codex `PreToolUse`：允许时输出为空；拒绝时输出 Codex deny JSON。多项目模式使用
`--resolve-task-from-cwd`，它会从 hook event 的 `cwd` 向上查找最近的
`.ccpanes-task/current-task.json`；没找到时自动 no-op。

项目启动或 plan 阶段初始化 current-task：

```powershell
node dist/src/cli.js write-current --root <project-root> --task-id <task-id> --phase shape
```

hook-shadow audit 形态：

```powershell
Get-Content examples/hook-shadow-event.json -Raw | node dist/src/cli.js hook-shadow --task <project>\.ccpanes-task\current-task.json --upstream-hook C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe --out <project>\.ccpanes-task\shadow-audit.json
```

hook install plan 形态：

```powershell
node dist/src/cli.js plan-hook-install --prototype-root D:\cc-pane\tool\experiments\ccpanes-task-probe --task <project>\.ccpanes-task\current-task.json --target both --upstream-hook C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe --out <project>\.ccpanes-task\hook-install-plan.json
```

hook rollback package 形态：

```powershell
node dist/src/cli.js create-hook-package --prototype-root D:\cc-pane\tool\experiments\ccpanes-task-probe --task <project>\.ccpanes-task\current-task.json --target both --upstream-hook C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe --out-dir <project>\.ccpanes-task\hook-package
```

hook package rehearsal 形态：

```powershell
node dist/src/cli.js rehearse-hook-package --package-dir <project>\.ccpanes-task\hook-package --expected-upstream-sha256 F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4 --out <project>\.ccpanes-task\hook-package-rehearsal.json
```

release gate 形态：

```powershell
node dist/src/cli.js release-gate --package-dir <project>\.ccpanes-task\hook-package --expected-upstream-sha256 F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4 --config C:\Users\AI001\.codex\config.toml --config C:\Users\AI001\.cc-panes\config.toml --repo D:\cc-pane\tool\repos\comet --repo D:\cc-pane\tool\repos\fastctx --check "smoke=pass=SMOKE_PASS" --out <project>\.ccpanes-task\release-gate.json
```

staged apply plan 形态：

```powershell
node dist/src/cli.js create-hook-apply-plan --release-gate <project>\.ccpanes-task\release-gate.json --out-dir <project>\.ccpanes-task\hook-apply-plan
```

approval check 形态：

```powershell
node dist/src/cli.js check-hook-approval --apply-plan <project>\.ccpanes-task\hook-apply-plan\apply-plan.json --approval <project>\.ccpanes-task\hook-approval.json --out <project>\.ccpanes-task\hook-approval-check.json
```

write preview dry-run 形态：

```powershell
node dist/src/cli.js preview-hook-write --approval-check <project>\.ccpanes-task\hook-approval-check.json --out-dir <project>\.ccpanes-task\hook-write-preview
```

guarded write apply 形态：

```powershell
node dist/src/cli.js apply-hook-write --write-preview <project>\.ccpanes-task\hook-write-preview\write-preview.json --approval-check <project>\.ccpanes-task\hook-approval-check.json --out <project>\.ccpanes-task\hook-write-apply.json --allow-root <project>\synthetic-config-root
```

guarded write restore 形态：

```powershell
node dist/src/cli.js restore-hook-write --apply-report <project>\.ccpanes-task\hook-write-apply.json --out <project>\.ccpanes-task\hook-write-restore.json --allow-root <project>\synthetic-config-root
```

production readiness 形态：

```powershell
node dist/src/cli.js production-readiness --release-gate <project>\.ccpanes-task\release-gate.json --approval-check <project>\.ccpanes-task\hook-approval-check.json --write-preview <project>\.ccpanes-task\hook-write-preview\write-preview.json --apply-report <project>\.ccpanes-task\hook-write-apply.json --restore-report <project>\.ccpanes-task\hook-write-restore.json --out <project>\.ccpanes-task\production-readiness.json
```

go-live approval package 形态：

```powershell
node dist/src/cli.js create-go-live-approval-package --readiness <project>\.ccpanes-task\production-readiness.json --out-dir <project>\.ccpanes-task\go-live-approval-package --approved-by AI001 --approval-note "manual authorization approved" --upstream-hook C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
```

final manual runbook 形态：

```powershell
node dist/src/cli.js create-final-runbook --go-live-manifest <project>\.ccpanes-task\go-live-approval-package\manifest.json --out-dir <project>\.ccpanes-task\final-runbook
```

生成的 `PRE-FLIGHT.ps1` / `POST-FLIGHT.ps1` 只是人工执行清单，生成 runbook 时不运行脚本、不写用户配置、不注册 Hook。

真实接入前仍应保持 dry-run，不写入 `~/.codex`、`~/.claude`、`~/.cc-panes`。
