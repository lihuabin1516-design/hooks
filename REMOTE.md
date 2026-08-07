# 远端仓库与路径明文记录

## 固定远端仓库

```text
https://github.com/lihuabin1516-design/hooks.git
```

Git remote 配置应保持：

```text
origin  https://github.com/lihuabin1516-design/hooks.git (fetch)
origin  https://github.com/lihuabin1516-design/hooks.git (push)
```

核验命令：

```powershell
git -C D:\cc-pane\tool\repos\hooks remote -v
git -C D:\cc-pane\tool\repos\hooks branch --show-current
git -C D:\cc-pane\tool\repos\hooks ls-remote origin refs/heads/main
```

## 本地维护仓库

```text
D:\cc-pane\tool\repos\hooks
```

这是唯一源仓库。提交、push、长期文档和源码维护都在这里完成。

## live 运行副本

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe
```

Codex 全局 hooks 当前使用该路径下的构建产物：

```text
D:\cc-pane\tool\experiments\ccpanes-task-probe\dist\src\cli.js
```

同步原则：repo 完成验证并 push 后，备份 live 对应目录，再复制 `src`、`dist`、`templates`、`tests`、`scripts`、`examples`、`docs` 和根配置/文档文件到 live，随后在 live 跑完整验收。

## 生产工具包路径

生产工具包由 CLI 生成，常见入口：

```powershell
node dist/src/cli.js create-production-toolkit `
  --out-dir <toolkit-dir> `
  --prototype-root D:\cc-pane\tool\experiments\ccpanes-task-probe `
  --audit-root D:\cc-pane\tool\experiments\ccpanes-task-probe\live\dynamic-audits `
  --hooks-json C:\Users\AI001\.codex\hooks.json `
  --config C:\Users\AI001\.codex\config.toml `
  --expected-upstream-hook C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe `
  --expected-upstream-sha256 F2C3E4DAFE5CCA6ABF9D0E8857D863F1597E3D96E7BA8677E7C31D5CA3B0DCA4
```

## 用户配置核验路径

只读核验对象：

```text
C:\Users\AI001\.codex\hooks.json
C:\Users\AI001\.codex\config.toml
C:\Users\AI001\.cc-panes\config.toml
C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
```

推荐核验命令：

```powershell
Get-Item C:\Users\AI001\.codex\hooks.json,C:\Users\AI001\.codex\config.toml,C:\Users\AI001\.cc-panes\config.toml,C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe |
  Select-Object FullName,Length

Get-FileHash -Algorithm SHA256 `
  C:\Users\AI001\.codex\hooks.json,`
  C:\Users\AI001\.codex\config.toml,`
  C:\Users\AI001\.cc-panes\config.toml,`
  C:\Users\AI001\skills-hub\bin\skills-hub-hook.exe
```

## 参考仓库

以下仓库属于参考对象，常规 hooks 维护只检查 status：

```text
D:\cc-pane\tool\repos\comet
D:\cc-pane\tool\repos\fastctx
```

核验命令：

```powershell
git -C D:\cc-pane\tool\repos\comet status --short
git -C D:\cc-pane\tool\repos\fastctx status --short
```

## 远端发布步骤

```powershell
cd D:\cc-pane\tool\repos\hooks
npm test
npm run typecheck
npm run build
npm run smoke
git diff --check
git status --short
git add .
git commit -m "<message>"
git push origin main
git ls-remote origin refs/heads/main
```

发布后把返回的 remote HEAD 记录到交付报告。
