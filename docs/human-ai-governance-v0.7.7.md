# human-ai-governance v0.7.7 项目接入记录

日期：2026-09-06（Australia/Melbourne）

本记录记载版本来源、适配范围和验证证据；当前协作规则以 [AGENTS.md](../AGENTS.md) 为准。本文是接入记录，不是独立执行计划，也不授予未来操作权限。

## 1. 基线与来源

- 项目接入前提交：`11bd290f0988ad5b4390c5d194b7d4b7a360ffdb`，分支 `main`，远端 `huaixuanhu/mathview`；修改前工作区干净，本地与远端 `main` 相同。
- 项目此前没有内置 `AGENTS.md`、skill 副本或治理检查脚本，因此本次为首次项目适配，不声称从某个旧项目版本迁移。
- 用户已明确要求项目升级到 v0.7.7，并在完成后直接 push；该授权覆盖本次适配、验证、提交和普通 push。
- 采用本机已安装 skill 指向的规范来源：`/Users/anoria/Documents/Codex/my-skills-collection/skills/human-ai-governance`。
- 检查时源码仓库分支为 `codex/astra-skill-adaptation`；`SKILL.md` 标记版本为 `0.7.7`，相关改动尚未提交。版本说明 `releases/human-ai-governance/v0.7.7.md` 将其状态记为 `validated local candidate`（已验证的本地候选版），日期为 2026-09-05。
- 本次使用上述本机来源，不修改或发布全局 skill 仓库，也不将它描述为已提交、已推送或已发布的上游版本。

来源文件的 SHA-256（文件内容校验值）：

| 来源文件（相对于本机 skill 源码仓库） | SHA-256 |
| --- | --- |
| `skills/human-ai-governance/SKILL.md` | `ba9ecbd22565d4d32c41fa0960f3dce9d9dfe76374834c21ebfacc699c11a754` |
| `releases/human-ai-governance/v0.7.7.md` | `54109c6a1e4450692679bc098dc81918ee4bc2e8fc067573fc092ac14a433c90` |

适配依据还包括该 skill 的 `references/governance-patterns.md`、`references/persistent-completion.md`、`references/graph-governance.md`、`references/reasoning-mode-routing.md` 和 `references/technical-language-routing.md` 中的相关规则。

## 2. 项目适配

| 规则 | 项目落实 |
| --- | --- |
| v0.7.7 有效授权延续 | 已授权范围内完成安全准备、提交和普通 push，不重复询问；到期、单次、累计及未满足的审批条件仍有效。 |
| v0.7.6 任务连续性（v0.7.7 包含） | 回答中途问题后继续原目标；用户明确取消或替换时核对已启动操作，凭实际证据报告停止或撤销。 |
| v0.7.6 关系图状态（v0.7.7 包含） | 仅在需要关系图时适用，分别说明需求、授权、执行和验证；本项目不因此新增图文件或检查。 |
| 保留已有模式与表达规则 | 依任务形态选择 `xhigh`、Max 或 Ultra，独立判断并行协作；简洁和通俗表达不降低工程要求。 |
| 适合项目实际影响的约束 | Tier 2，保留浏览器计算、数学约定、现有命令及部署权限边界；README 提供当前源码入口。 |

源码版本说明记录了 GPT-6 Astra 的两项有限决策检查，分别针对已授权 push 和已用尽的单次付费执行授权。本次只依据本机规则及其版本说明完成项目适配，未重跑模型评估，也不据此宣称模型整体能力、速度或 token 效率提升。

## 3. 变更边界

- 新增 `AGENTS.md` 和本记录；在 `README.md` 补充源码入口与协作入口。
- 应用源码、数学实现、参考数据、依赖、构建配置和部署配置不变。
- 不安装检查钩子，不建立计划索引或关系图，不新增重复验证脚本。继续使用项目现有测试与构建命令。

## 4. 验证证据

- 使用 `.venv/bin/python` 进行一次性文档检查：本地 Markdown 链接、v0.7.7 标记、上述来源文件校验值及冲突标记检查通过。
- 对应用源码、测试、参考数据生成脚本、依赖和构建配置执行 Git 差异检查，确认与接入前提交相同。
- `npm test`：1 个测试文件、8 项测试全部通过。
- `npm run build`：通过；构建输出提示有压缩文件超过 500 kB，测试工具提示可考虑更换 React 编译插件。这些提示不影响本次通过结果，应用及工具配置未改动。
- 已按来源规则逐项审查授权延续、任务连续性、取消状态和项目边界；完整暂存差异审查及 `git diff --cached --check` 通过。未进行新的模型行为评估、浏览器交互验收或线上部署验证；本次文档适配不改变这些运行行为。
