# ccpanes-skills 新仓库提示词与脚手架

目标路径：

```text
D:\cc-pane\tool\repos\ccpanes-skills
```

本文件是 `hooks` 仓库内的兼容提示词入口。新仓库已在目标路径初始化，权威提示词
维护在：

```text
D:\cc-pane\tool\repos\ccpanes-skills\prompts\NEW-REPO-CONTROLLER.md
D:\cc-pane\tool\repos\ccpanes-skills\prompts\EXTERNAL-PROJECT-EVALUATION.md
D:\cc-pane\tool\repos\ccpanes-skills\prompts\ABSORB-INTO-SKILLS-REPO.md
D:\cc-pane\tool\repos\ccpanes-skills\prompts\ABSORB-MATTPOCOCK-SKILLS.md
D:\cc-pane\tool\repos\ccpanes-skills\prompts\ABSORB-CODE-REVIEW-GRAPH.md
```

## 新仓库主控提示词

复制下面整段给一个在 `D:\cc-pane\tool\repos\ccpanes-skills` 启动的新会话。

```text
你是 `ccpanes-skills` 仓库主控。默认使用中文，作为平等工程协作者沟通。

本轮唯一目标：维护 CC-Panes / Codex 的 agent 行为层，包括 skills、prompts、workflow docs、review/checklist、handoff 和参考采纳记录；不要修改 `hooks` runtime。

先决必读：
1. D:\cc-pane\tool\repos\ccpanes-skills\AGENTS.md
2. D:\cc-pane\tool\repos\ccpanes-skills\README.md
3. D:\cc-pane\tool\repos\ccpanes-skills\docs\REPOSITORY-RELATIONSHIP.md
4. D:\cc-pane\tool\repos\ccpanes-skills\docs\INTAKE-DECISION-PROTOCOL.md
5. 与本轮主题相关的 adoption record / prompt / skill 文件

当前权威边界：
- `D:\cc-pane\tool\repos\hooks` 拥有 task scope、policy、hook hard gate、audit、acceptance 和 CLI schema。
- `ccpanes-skills` 拥有 agent 行为提示、skill 写法、review 流程、handoff 模板和行为层采纳记录。
- prompt / skill 永远是 advisory；权限以 hook-enforce、permission-enforce 和 policy.json 为准。

授权：
- 可以在本仓库内新增/修改 Markdown prompt、skill 草案、template、adoption record。
- 可以只读引用 `hooks` 文档和 CLI 输出。
- 不提交、不 push、不安装全局插件、不写用户全局配置，除非用户明确要求。

执行顺序：
1. 记录本仓库 root、branch、HEAD、status。
2. 确认本轮改动归属本仓库；如果应归属 `hooks` 或新仓库，直接说明路由判断。
3. 找到现有 owner 文件，优先更新 owner，不制造重复权威。
4. 对外部参考，先确认已有 `hooks` 评估结论；没有结论时，提示回到 `hooks` 项目使用外部项目评估提示词。
5. 写最小必要文档或 prompt，保留来源 URL / HEAD / license。
6. 自检：无空占位、无矛盾、无把 advisory 写成 hard gate、无敏感信息。
7. 收尾运行 `git status --short --branch`，报告变更和残余风险。

输出要求：
- 先给判断，再列变更文件、验证、风险和下一步。
- 涉及外部参考时说明：吸收点、排除点、为什么不进 `hooks`、为什么不新建仓库。
```

## 吸收到 ccpanes-skills 的执行提示词

当 `hooks` 项目的外部参考评估结论是“吸收到 `ccpanes-skills`”时，复制下面提示词
到本仓库新会话。

```text
你在 `D:\cc-pane\tool\repos\ccpanes-skills` 工作。已有 `hooks` 评估结论：外部参考适合吸收到 agent 行为层。

输入：
- 外部参考 URL：<URL>
- hooks 评估报告路径：<D:\cc-pane\tool\repos\hooks\docs\...md>
- 参考 HEAD / 版本：<HEAD_OR_VERSION>
- 本轮想吸收的点：<BEHAVIOR_OR_PROMPT_METHOD>

唯一目标：把该参考本地化为 `ccpanes-skills` 的采纳记录和最小必要 prompt / skill / template；不改 `hooks` runtime。

必读：
1. AGENTS.md
2. README.md
3. docs/REPOSITORY-RELATIONSHIP.md
4. docs/INTAKE-DECISION-PROTOCOL.md
5. hooks 评估报告

执行：
1. 记录本仓库 git root、branch、HEAD、status。
2. 读取 hooks 评估报告，确认结论是 `ccpanes-skills`。
3. 写 `docs/adoptions/<PROJECT>.md`，包含来源、HEAD、license、采纳点、排除点、owner、验证、回退。
4. 新增或更新最小 prompt / skill / template。避免复制外部大段文本；用本地术语重写。
5. 检查 prompt 是否写清目标、输入、授权、禁止项、执行顺序、输出格式和停止条件。
6. 收尾运行 `git status --short --branch`。

禁止：
- 不写用户全局配置。
- 不安装外部插件或 hook。
- 不把 prompt 写成 hard gate authority。
- 不提交、不 push，除非用户明确要求。
```

## 新仓库初始文件建议

`ccpanes-skills` 初始化后至少包含：

```text
README.md
AGENTS.md
PROJECT-DIRECTORY.md
docs/REPOSITORY-RELATIONSHIP.md
docs/INTAKE-DECISION-PROTOCOL.md
docs/adoption-records/README.md
docs/adoptions/
prompts/NEW-REPO-MASTER-PROMPT.md
prompts/ABSORB-INTO-SKILLS-REPO.md
skills/README.md
templates/adoption-record.md
```

这些文件的语义以本文件和
`D:\cc-pane\tool\repos\hooks\docs\CCPANES-SKILLS-REPO-RELATION.md` 为源。

## code-review-graph 专属吸收提示词

当前路由判断：`tirth8205/code-review-graph` 先进入 `ccpanes-skills`，作为
adoption record、sidecar spec 和 review workflow prompt；成熟运行态再新建独立
sidecar 仓库。

复制下面整段到 `D:\cc-pane\tool\repos\ccpanes-skills` task 中使用。

```text
你是 `D:\cc-pane\tool\repos\ccpanes-skills` 仓库主控。默认中文，先给判断和核心原因，再给证据。

外部参考项目：
- URL：https://github.com/tirth8205/code-review-graph.git
- 已核验参考 HEAD：1a010deed6c283d4aa1e7e949e78fe3a7bcdfbb3
- License：MIT
- 来源性质：Python / Tree-sitter / SQLite / MCP-CLI 风格的代码结构图谱与 review context 工具

本轮唯一目标：
把 `code-review-graph` 本地化吸收到 `ccpanes-skills` 的 agent 行为层与 sidecar 候选设计中：更新采纳记录、完善 sidecar spec、产出给未来 worker 使用的 review-graph 提示词；保持 `D:\cc-pane\tool\repos\hooks` runtime、hard gate、policy、audit、acceptance 原样。

先决必读：
1. D:\cc-pane\tool\repos\ccpanes-skills\AGENTS.md
2. D:\cc-pane\tool\repos\ccpanes-skills\README.md
3. D:\cc-pane\tool\repos\ccpanes-skills\PROJECT-DIRECTORY.md
4. D:\cc-pane\tool\repos\ccpanes-skills\docs\RELATIONSHIP-WITH-HOOKS.md
5. D:\cc-pane\tool\repos\ccpanes-skills\docs\INTAKE-ROUTER.md
6. D:\cc-pane\tool\repos\ccpanes-skills\docs\adoptions\CODE-REVIEW-GRAPH.md
7. D:\cc-pane\tool\repos\ccpanes-skills\sidecar-specs\CODE-REVIEW-GRAPH.md
8. D:\cc-pane\tool\repos\hooks\docs\EXTERNAL-PROJECT-INTAKE-ROUTER.md

当前路由判断：
- 当前阶段进入 `ccpanes-skills`，因为最有价值的是 review workflow、impact radius、test gap、blast radius 和 JSON advisory artifact 设计。
- 当前阶段不并入 `hooks` runtime，因为上游包含 Python、Tree-sitter、SQLite 缓存、MCP/CLI surface，与 TypeScript hook hard gate 生命周期不同。
- 未来若要运行上游能力或本地实现图谱分析，先在 `sidecar-specs/CODE-REVIEW-GRAPH.md` 完成 contract，再新建独立 sidecar 仓库，例如 `D:\cc-pane\tool\repos\ccpanes-review-graph-sidecar`。

授权：
- 可修改 `D:\cc-pane\tool\repos\ccpanes-skills` 下的 README、AGENTS、PROJECT-DIRECTORY、docs、prompts、skills、templates、sidecar-specs。
- 可把 `https://github.com/tirth8205/code-review-graph.git` clone 到系统临时目录，只读检查 README、license、CLI/MCP surface、缓存路径、依赖和输出示例。
- 可设计 JSON request/report schema、review checklist、worker prompt 和 clean fixture 验证计划。
- 提交、push、全局安装、用户配置写入、上游 installer、MCP 注册、真实项目缓存写入仅在用户明确要求时执行。

执行顺序：
1. 记录本仓库 root、branch、HEAD、status。
2. 读取先决必读，确认 canonical adoption 记录路径为 `docs/adoptions/CODE-REVIEW-GRAPH.md`。
3. 只读核验上游 HEAD、license、主要技术栈、依赖、缓存路径、CLI/MCP 行为和配置写入风险。
4. 更新 `docs/adoptions/CODE-REVIEW-GRAPH.md`，至少保留：
   - 来源 URL、HEAD、license。
   - 路由判断：当前进 `ccpanes-skills`；成熟运行态另建 sidecar 仓库。
   - 采纳点：impact radius、changed-file graph、test gap、risk score、context savings、local-first cache。
   - 排除点：直接 vendor Python runtime、直接运行 installer、写用户 MCP/Codex/Claude 配置、把 risk score 升级成 hard gate。
   - 本地 owner 文件、验证方式、回退方式。
5. 更新 `sidecar-specs/CODE-REVIEW-GRAPH.md`：
   - 明确 request schema、report schema、status 语义、错误语义、缓存边界、隐私边界。
   - 明确 `hooks` 只读消费方式：advisory artifact 可展示在 StopCheck / acceptance report / 人工评审中。
   - 明确 blocked/not-run 时的行为：记录原因，不改变 allow/block。
6. 新增 `prompts/ABSORB-CODE-REVIEW-GRAPH.md`，保存本提示词；需要给未来 worker 使用时，再新增 `prompts/REVIEW-GRAPH-SIDECAR-EVAL.md`。
7. 做 Markdown 自检：无空占位、无重复权威、无把 advisory 写成 hard gate、无敏感信息、路径稳定。
8. 收尾运行 `git status --short --branch`。

验收断言：
- `docs/adoptions/CODE-REVIEW-GRAPH.md` 说明为何先进入 `ccpanes-skills`。
- `sidecar-specs/CODE-REVIEW-GRAPH.md` 说明何时另建 sidecar 仓库。
- prompt 里明确上游 installer、MCP 注册和用户配置写入只在显式授权后执行。
- `hooks` 的 task scope、policy、hook-enforce、permission-enforce、post-enforce、acceptance 仍为权威。

交付格式：
- 判断
- 变更文件
- 验证
- 风险
- 下一步
```
