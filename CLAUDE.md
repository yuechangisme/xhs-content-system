# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

「懒人养生手册」小红书账号的内容生产基地。养生健康方向，面向 25-35 岁年轻人群，走「懒人友好、不折腾」的调性。

## 内容结构

```
content/
├── 公共素材库/               ← 所有已用图片汇总，新任务先来这里找图
├── render.js                 ← Puppeteer HTML→PNG 渲染脚本
├── 流程参考.md               ← 完整内容生产流程
├── 账号信息/                 ← 头像、背景图、品牌元素
│
├── YYYY-MM-DD-主题关键词/    ← 每篇内容一个独立文件夹
│   ├── 懒人养生手册-主题.html   ← 轮播图 HTML
│   ├── 主题-文案.md            ← 小红书发布文案
│   ├── images/                 ← 本篇用到的配图
│   ├── output/                 ← 导出的 PNG 文件
│   └── drafts/                 ← 过程文件
```

## 关键命令

```bash
# 导出 HTML 为 PNG（3x 高清，1620x2160）
cd content
node render.js "YYYY-MM-DD-主题/懒人养生手册-主题.html" "文件前缀"
# 示例
node render.js "2026-05-15-高考饮食/懒人养生手册-高考饮食.html" "高考饮食"

# 本地预览 HTML（需要 HTTP 服务，否则 html2canvas 读不到本地图片）
npx http-server -p 8080 content/ --cors
# 打开 http://127.0.0.1:8080/ 访问
```

## 账号规则

- 标题 ≤ 20 字
- 标签 ≤ 10 个
- 品牌色：暖白底 #FEFAE0 + 健康绿 #3A7D44 + 暖橙 #F4A261
- 语气：朋友式分享，不端不装，口语短句
- 禁止词："本文将介绍""姐妹们""每天坚持""绝绝子"
- 人设："我也是踩坑过来的，帮你省时间"

## 内容策划流程

使用 `xhs-planner` skill 按 9 步流程走：
选题分析 → 用户分析 → 爆点分析 → 内容策略 → 视觉策略 → 确认方向 → 内容生成 → 内容审核 → 复盘优化

## Windows 路径注意

- 本地路径：使用 `path.resolve()` 后 `replace(/\\/g, '/')` 转 Puppeteer file URL
- Chrome 位置：配置在 `config.local.js` 的 `chromePath` 字段，留空则使用 puppeteer 自动查找
- 小红书 Cookie：配置在 `config.local.js` 的 `cookiePath` 字段

## 依赖

- Node.js 20+
- Puppeteer（自动下载 Chrome）
- 图片来源：Pexels CDN（images.pexels.com 可直接热链）

## Documentation Update Policy

### 提交前检查

每次提交前必须检查 README / CHANGELOG 是否需要更新。

### 必须更新 README 的场景

- 新增或修改 CLI 命令
- 修改项目目录结构
- 修改配置方式
- 修改运行方式
- 修改 render / QA / publish 的用户可见行为
- 新增模块
- 修改当前版本状态或 roadmap

### 必须更新 CHANGELOG 的场景

- 打 tag
- 发布版本
- 完成阶段性功能
- 修复影响用户使用的 bug

### 可以不更新的场景（需说明原因）

- 内部小重构
- 注释调整
- 不影响用户行为的 bugfix
- 测试数据修复

### 提交报告必须包含

- 是否更新 README：是/否
- 是否更新 CHANGELOG：是/否
- 如果否，说明原因

### 禁止

- 功能变化但 README 不同步
- 打 tag 但 CHANGELOG 不更新
- 修改 CLI 命令但 README 快速开始命令不更新

## CLAUDE.md Update Policy

CLAUDE.md 不是普通变更记录，而是 Agent 的项目行为规则文件。只有当某条规则会影响未来 Agent 的长期行为时，才应该写入 CLAUDE.md。

### 每次任务完成的报告必须包含

```
## Documentation Check
* README 是否需要更新：
* CHANGELOG 是否需要更新：
* CONTRACT 是否需要更新：
* CLAUDE.md 是否需要更新：
* 原因：
```

### 必须考虑更新 CLAUDE.md 的场景

1. **项目工作流程发生变化** — QA、render、publish、schedule、git、release 流程变化
2. **Agent 行为边界发生变化** — 新增禁止真实发布、必须 dry-run、必须确认等规则
3. **安全规则发生变化** — 禁止提交 cookie、config.local.js、账号信息、output PNG、本地路径等
4. **文档同步规则发生变化** — README / CHANGELOG / CONTRACT 的更新要求变化
5. **架构职责边界发生变化** — xhs-planner skill 与 xhs-content-system 的职责划分变化
6. **Agent 反复踩坑的问题被总结为长期规则** — 误写 PUBLISHED、忘记更新 README、误提交本地路径、跳过 QA 等

### 一般不需要更新 CLAUDE.md 的场景

- 单次 bug 修复
- 单篇帖子内容修改
- 普通 CSS / 文案调整
- 不影响工作方式的内部代码重构
- 一次性的测试结果
- commit hash、tag 记录、临时日志

以上内容应放在 README、CHANGELOG、CONTRACT、commit message 或任务报告中，而不是 CLAUDE.md。

本规则从现在开始长期生效。

## 定时发布确认模型（排期规则）

1. **确认发生在排期时，不是执行时。** 定时发布的确认由 `--confirm-schedule` 在 `schedule add` 时完成，执行时不再要求人在场。
2. **没有 `--confirm-schedule` 不得写入 confirmed schedule。** 未带此 flag 的 `schedule add` 只做预检查，不修改 state.json。
3. **未 confirmed 的排期永不自动发布。** `schedule.confirmed = false` 时，即使到时间也不触发发布。
4. **v0.3.0 禁止真实自动发布。** 当前版本只实现 schedule queue（add/list/cancel/status/due），不安装 node-schedule，不做常驻进程，不自动执行 publisher。
5. **已 PUBLISHED 的帖子禁止排期。** `schedule add` 前置检查会拒绝。
6. **QA 未通过的帖子禁止排期。** 只有 `QA_PASSED` 状态的帖子可以排期。
7. **已存在 active 排期的帖子禁止重复 add。** 每个帖子同时只能有一个 CONFIRMED 或 RUNNING 排期。

## Destructive Operation Safety Policy

### 核心原则

删除操作不可逆，必须逐级设防。任何删除、清理、移除文件的操作必须遵守以下规则。

### 规则

1. **先 audit，后删除。** 任何删除操作前必须先执行 dry-run audit，列出完整路径、文件数量、总大小、Git 跟踪状态、风险等级。

2. **未跟踪文件必须先备份。** 对于未被 Git 跟踪的文件（如 output/、state.json、error.log、调试临时文件），删除前必须先创建本地备份到 `cleanup-backup/`。备份完成后才允许执行删除。

3. **逐项确认，禁止批量。** 删除范围必须逐项确认，禁止用宽泛通配符（如 `*.png`、`temp-*`）批量删除。

4. **不删未列明的文件。** 不允许删除未在 audit 清单中明确列出的文件。

5. **删除后回归验证。** 删除后必须执行核心命令回归验证（status、qa、publish --dry-run、schedule due 等），确保管线不受影响。

6. **删除后明确区分提交类型。** 报告删除结果时，必须明确区分：
   - **Git 已提交变更** — 可通过 `git revert` 回滚
   - **工作区文件删除** — 未提交，不能通过 git 回滚
   - **未被 Git 跟踪的文件删除** — 无法通过 git 恢复，只能依赖备份

### 审计报告规范

7. **state.json 不是内容归档的唯一事实来源。** 已投递目录中的物理文件（HTML、manifest.json、output PNG）才是归档完整性的最终依据。state.json 仅记录进入 pipeline 管理后的运行状态。

8. **物理目录与 state 分别审计、分别描述。** 审计时必须分别检查已投递物理目录和 state.json 记录，并明确报告两者是否存在差异、差异原因、是否有风险。

9. **发现不一致时暂停开发。** 如果审计中发现数据不一致（如 PNG 数量存疑、state 与目录不匹配），必须先完成差异分析并确认无风险，才允许进入下一阶段开发。

10. **总结必须准确区分事实与推断。** 对于无法确认的历史操作（如被 gitignore 的文件的旧版本内容），必须标注为"无法确认"而非默认为"已删除"。不编造未经验证的数据。

## General Agent Coding Discipline

### 优先级声明

本节的通用纪律不替代项目安全规则。如有冲突，以本项目已定义的规则为准：

1. 发布安全规则（定时发布确认模型）
2. Destructive Operation Safety Policy
3. Documentation Update Policy
4. state / archive 边界规则
5. Scheduled Publish 确认规则

### 纪律

1. **先说明假设和风险再实现。** 当需求模糊、数据状态不确定、或变更可能产生副作用时，先列出你的理解和判断，让用户确认后再动手。不要默默选择一个路径。

2. **最小实现，不做未要求的功能。** 只实现任务明确要求的逻辑。不引入未要求的抽象层、配置项、灵活性。不预判未来需求。三行相似代码优于提前封装。

3. **手术式修改，不顺手重构。** 只改与任务直接相关的文件。不改相邻代码的格式、注释、命名。不改未损坏的逻辑。如果发现无关的死代码，可以提醒但不删除。每处改动必须能回溯到用户请求。

4. **每次任务必须有验收标准。** 实现前明确：怎么验证这个任务完成了？修改后运行对应的验证命令（status、qa、list、due、topic list 等），确认管线不受影响。

5. **发现不一致先暂停，不继续开发。** 审计中发现数据不一致、状态异常、或旧的假设被推翻时，先完成差异分析并确认无风险，才允许进入下一阶段。

6. **保持报告准确。** 区分事实与推断，区分已提交变更与工作区变更，不编造未验证的数据。如果不确定，直接说明不确定。
