# Changelog

## v0.5.3 (2026-05-18)

### 新增

- **topic add 手动热点导入增强**：支持手动录入来自多平台的热点线索
  - 新增 6 个 manual source：`xhs-manual`、`youtube-manual`、`baidu-manual`、`weibo-manual`、`news-manual`、`other-manual`
  - 新增参数：`--url`（原始内容 URL）、`--platform`（中文平台名）、`--observed-at`（观察到的时间）
  - 新增评分参数：`--trend-score`（0-100）、`--fit-score`（0-100），自动计算 `overallScore`
  - platform 自动推断：xhs-manual → 小红书、youtube-manual → YouTube 等
  - observedAt 未提供时自动使用当前时间
  - sourceMeta 规范化：含 platform、platformSource、url、observedAt

- **分数越界校验**：`TOPIC_SCORE_INVALID` 错误码，trend-score / fit-score 超出 0-100 时拒绝

### 安全边界

- 不自动抓取、不联网、不爬虫
- 不读取 session、不读取 cookie
- 不调用平台 API
- 不调用 render / QA / publish / schedule
- 不修改 state.json

### 变更

- `modules/topic-store.js`：VALID_SOURCES 扩展、add() 新增 url/platform/observedAt/trendScore/fitScore 参数、sourceMeta 规范化构建、分数越界校验
- `pipeline.js`：cmdTopicAdd() 传递新参数
- `CONTRACT.md`：新增 v0.5.3 Manual Trend Import Enhancement 章节、登录态来源暂缓规则、更新路线图
- `README.md`：更新版本状态、已完成清单、topic add CLI 示例

### 测试验证

| 场景 | 结果 |
|------|------|
| topic add --source xhs-manual --url --trend-score 70 --fit-score 85 | 写入 CANDIDATE，sourceMeta完整，overallScore=79 ✅ |
| topic add --source youtube-manual --url | 写入 CANDIDATE，platform自动推断为"YouTube" ✅ |
| topic add --source news-manual | 写入 CANDIDATE ✅ |
| topic show | sourceMeta.url / observedAt / scores 可见 ✅ |
| topic list | 新增 topic 正常显示 ✅ |
| trend-score > 100 | TOPIC_SCORE_INVALID 拒绝 ✅ |
| fit-score < 0 | TOPIC_SCORE_INVALID 拒绝 ✅ |
| pipeline status 回归 | ✅ |
| 未修改 state.json | ✅ |
| 未调用执行层模块 | ✅ |

---

## v0.5.2 (2026-05-18)

### Phase 1 — Dry-run（已完成）

- **季节/节气选题生成器（Phase 1 — Dry-run）**：`seasonal-calendar.json` + `modules/seasonal-generator.js`
  - `topic seasonal list` — 查询季节节点（支持 `--month`、`--season`、`--type`、`--term` 过滤）
  - `topic seasonal generate --dry-run` — 预览候选选题（不写入，不修改文件）
  - 支持 `--term`、`--month`、`--range`、`--all` 四种生成模式
- **季节节点参考数据**：`seasonal-calendar.json` 包含 33 个节点（24 节气 + 4 节日 + 5 场景节点），可提交 Git
- **节气日期浮动支持**：通过 `yearlyDates` 字段覆盖年份特定日期
- **账号定位解耦**：从 `config.local.js` 的 `accountProfile` 读取，无配置时返回 warning 不阻断
- **评分机制**：`trendScore`（时效性）+ `fitScore`（账号匹配度）+ `overallScore`（综合）
- 新增 6 个错误码：`TOPIC_GENERATE_CONFIRM_REQUIRED`、`SEASONAL_NODE_NOT_FOUND`、`SEASONAL_DATE_INVALID`、`SEASONAL_DUPLICATE_TOPIC`、`SEASONAL_CALENDAR_INVALID`、`SEASONAL_ACCOUNT_PROFILE_MISSING`

### Phase 1 安全边界

- dry-run 不写入 `candidates.json`
- generate 无 `--dry-run` 或 `--confirm-generate` 时拒绝执行
- seasonal generator 不调用任何执行层模块

### Phase 2 — confirm-generate（本轮新增）

- **`generate --confirm-generate` 模式**：将 seasonal TopicCandidate 正式写入 `topics/candidates.json`
  - 支持 `--term`、`--month`、`--range` 参数
  - 写入的候选状态为 `CANDIDATE`
  - 不生成帖子、不调用 xhs-planner、不修改 state.json
- **防重复写入**：`topic-store.js` 新增 `importSeasonalCandidates()`
  - 同一年、同一 `seasonalId`、同一 `title` 自动跳过
  - 跳过时不阻断，返回 `skipped` 列表含 `SEASONAL_DUPLICATE_TOPIC`
  - 跨年同节点允许重新生成
  - 已 CANDIDATE / SHORTLISTED / APPROVED / EXPORTED / REJECTED 均跳过
- **管线编排**：`pipeline.js` `cmdTopicSeasonalGenerate()` 增加 confirm-generate 路由
  - 生成 → 批量写入 → 返回 added/skipped 数量
- **dry-run 行为保持不变**：无 `--confirm-generate` 时不写入

### 测试验证

| 场景 | 结果 |
|------|------|
| `generate --term "立夏" --dry-run` | 不写入 candidates.json ✅ |
| `generate --term "立夏" --confirm-generate` | 写入 3 条 CANDIDATE ✅ |
| 再次执行同一命令 | 跳过 3 条 duplicate ✅ |
| `topic list` 可见 seasonal 候选 | ✅ |
| `topic show` 字段完整 | ✅ |
| `topic shortlist / approve / export` | 状态流转正常 ✅ |
| 无 flag 的 generate | TOPIC_GENERATE_CONFIRM_REQUIRED ✅ |
| `pipeline status` 回归正常 | ✅ |
| 未修改 state.json | ✅ |
| 未调用执行层模块 | ✅ |

### 变更

- `modules/seasonal-generator.js`：generatePreview 新增 confirmGenerate 模式支持
- `modules/topic-store.js`：新增 `importSeasonalCandidates()` 批量导入含防重复
- `pipeline.js`：`cmdTopicSeasonalGenerate()` 实现 confirm-generate 完整路由
- `README.md`：更新版本状态、已完成清单、新增 confirm-generate CLI 示例

---

## v0.5.1 (2026-05-18)

### 新增

- **本地选题候选池（Local Topic Pool）**：`modules/topic-store.js` + `pipeline.js topic` 子命令
  - `topic add` — 手动录入候选选题（CANDIDATE）
  - `topic list` — 查看候选列表（默认隐藏 REJECTED / EXPORTED，支持 `--all`）
  - `topic show` — 查看单个候选完整信息
  - `topic shortlist` — 初筛通过（CANDIDATE → SHORTLISTED）
  - `topic approve` — 确认选题（SHORTLISTED → APPROVED）
  - `topic reject` — 否决选题（CANDIDATE/SHORTLISTED → REJECTED，必须带理由）
  - `topic export` — 导出已确认选题给 xhs-planner（APPROVED → EXPORTED，写入 `topics/exported/`）
- 新增 7 个 TOPIC_* 错误码（TOPIC_NOT_FOUND, TOPIC_INVALID_STATUS, TOPIC_TITLE_REQUIRED, TOPIC_STORE_INVALID, TOPIC_EXPORT_NOT_APPROVED, TOPIC_ALREADY_EXPORTED, TOPIC_STATE_WRITE_FAILED）
- `topics/` 目录管理：`candidates.json`（候选池）+ `exported/`（导出目录）
- `.gitignore` 新增 `topics/`（运行时状态，不上传）

### 安全边界

- topic discovery 只生成候选，不生成帖子、不发布
- CANDIDATE 不允许直接 export
- REJECTED 不允许 approve
- EXPORTED 不允许重复导出
- `topic-store.js` 不调用 render / QA / publisher / scheduler / state.json

### 变更

- `pipeline.js`：新增 topic 子命令路由
- `README.md`：更新版本状态、目录结构、工作流、新增 topic CLI 命令
- `.gitignore`：排除 `topics/`

---

## v0.5.0 (2026-05-18)

### 新增

- **v0.5 Topic Discovery Contract**（CONTRACT.md）：热点/选题线索发现层合约，覆盖数据源分级、Source Adapter Contract、TopicCandidate 结构、状态流转、人工确认规则
  - 明确 topic discovery 只负责热点/选题线索，不生成帖子、不发布
  - 热点来源 4 级分级策略（Tier 0 本地/人工 → Tier 1 公开热点 → Tier 2 第三方工具 → Tier 3 高风险采集）
  - 明确 v0.5 MVP 只支持 Tier 0，Tier 3 小红书爬虫暂缓
  - 新增 Source Adapter Contract：统一接口定义，任何外部来源必须先转换为 TopicCandidate
  - 新增 TopicCandidate 最小结构（14 字段）
  - 新增 Topic 5 状态流转：CANDIDATE → SHORTLISTED → APPROVED → EXPORTED / REJECTED
  - 明确人工确认规则：APPROVED 后才能进入 xhs-planner，topic discovery 不得直接发布
  - 明确 trend-pulse 12 项验证清单
  - 明确小红书爬虫 7 项暂缓理由，列为 Tier 3 高风险

### 变更

- CONTRACT.md：新增 v0.5 Topic Discovery Contract 章节

### 背景

v0.5 是热点搜集 / 选题线索发现阶段。本轮只做策略冻结和数据契约设计，不写代码、不实现 topic pool、不接入任何外部来源。

---

## v0.4.2 (2026-05-18)

### 新增

- **Destructive Operation Safety Policy**（CLAUDE.md）：10 条长期安全规则，覆盖删除操作全流程
  - 删除前必须 dry-run audit（列出完整路径、数量、大小、Git 跟踪状态、风险等级）
  - 未跟踪文件删除前必须先本地备份到 `cleanup-backup/`
  - 逐项确认，禁止宽泛通配符批量删除
  - 删除后必须回归验证核心命令
  - 删除后报告必须区分 Git 已提交 / 工作区删除 / 未跟踪删除
- **state.json 与物理归档职责说明**（CONTRACT.md 附录）
  - state.json 不是内容归档唯一事实来源
  - 已发布内容归档完整性以物理目录（HTML + manifest + output PNG）为准
  - 物理目录归档与 state.json 必须分别审计、分别描述
  - 发现不一致时暂停开发，先做 reconciliation audit

### 变更

- CLAUDE.md：新增 Destructive Operation Safety Policy 章节
- CONTRACT.md：新增附录，明确 state.json 边界与归档完整性标准

### 背景

v0.4.0 cleanup 执行过程中暴露了流程风险：对 state.json 与物理目录的区分不清、worktree 删除与 git 提交混淆。本轮纯规则沉淀，不修改代码、不修改 state.json、不涉及功能变更。

---

## v0.3.5 (2026-05-17)

### 修复

- scheduled publish 成功后缺少文件夹归档：`runDueConfirm()` 在 publisher 成功后未执行 `fs.renameSync()`，导致待发布稿件发布后仍留在 `待投递/`。已补齐文件夹移动逻辑，与手动发布路径行为一致。
- CONTRACT.md 职责边界描述与实际架构不一致：原写"publisher 写 PUBLISHED"和"scheduler 禁止写 PUBLISHED"，但实际架构是 publisher 只返回结果，caller 负责状态更新和文件夹移动。已修正为真实描述。

### 变更

- CONTRACT.md：职责边界章节重写，明确 publisher.publish() 只负责执行发布，caller（pipeline.js / scheduler.js）负责状态更新和文件夹移动

### 回归验证

| 场景 | 结果 |
|------|------|
| 已发布任务 dry-run 拒绝 | ✅ |
| 已发布任务 schedule add 拒绝 | ✅ SCHEDULE_ALREADY_PUBLISHED |
| mock-success 文件夹移动到已投递 | ✅ |
| mock-fail 文件夹不移动 | ✅ |
| schedule due 无副作用 | ✅ state diff 确认 |

---

## v0.3.4 (2026-05-17)

### 里程碑

**首次真实 scheduled publish 闭环完成。** 三部曲全部发布成功。

### 新增

- `schedule run-due --confirm-scheduled-publish --task "<taskDir>"` 首次真实执行成功
- 帖子「内脏脂肪习惯」通过排期自动发布到小红书
- 完整链路：HTML → PNG → QA → schedule → due → dry-run → real publish → state 归档

### 修复

- `runDueConfirm()` 成功路径漏更新 `post.status` / `publish.status` / `publishedAt`：
  - 修复前：schedule=SUCCEEDED 但 post=QA_PASSED / publish=PENDING（状态不一致）
  - 修复后：post=PUBLISHED / publish=PUBLISHED / publishedAt=写入 / schedule=SUCCEEDED
- 失败路径同步修复：漏更新 `post.status` / `publish.status` / `publish.attempts`

### 职责边界审计

- scheduler 不直接调 publish-xhs.js ✅
- publisher 是唯一调用 publish-xhs.js 的模块 ✅
- caller（pipeline.js / scheduler.js）负责状态更新和文件夹移动（架构既定模式）
- 边界描述与实现存在差异，建议在 v0.4.0 contract 更新中修正

### 三部曲发布状态

| 帖子 | 发布方式 | 状态 |
|------|---------|------|
| 压力肚自测 | 手动 --confirm-publish | ✅ |
| 内脏脂肪食物 | 手动 --confirm-publish | ✅ |
| 内脏脂肪习惯 | scheduled --confirm-scheduled-publish | ✅ |

---

## v0.3.3 (2026-05-17)

### 新增

- `schedule run-due --confirm-scheduled-publish` — 受控排期发布入口（列出到期任务，不执行）
- `schedule run-due --confirm-scheduled-publish --dry-run --task "<taskDir>"` — 完全前置检查，不发布
- `schedule run-due --confirm-scheduled-publish --task "<taskDir>"` — 真实 scheduled publish 入口

### 安全

- 无 flag 的 run-due → `SCHEDULE_FLAG_REQUIRED`
- confirm 无 --task → `SCHEDULE_TASK_REQUIRED`（列出任务，不执行）
- 即使 due tasks = 1，也必须显式指定 --task 才允许执行
- dry-run 不调用 publisher，不写 state，不移动文件夹
- 13 项前置检查，任一失败不发布
- scheduler 禁止直接调 publish-xhs.js，禁止直接写 PUBLISHED

### 职责边界

- scheduler 只负责：查 due → 前置检查 → 调 publisher → 更新 schedule 状态
- publisher 继续负责：前置检查 → 真实发布 → 写 PUBLISHED → 移文件夹

### 测试验证

| 场景 | 结果 |
|------|------|
| run-due 无 flag | SCHEDULE_FLAG_REQUIRED ✅ |
| confirm 无 --task | SCHEDULE_TASK_REQUIRED + due list ✅ |
| confirm + dry-run + task | 13 项检查，不修改 state ✅ |
| mock-success / mock-fail | 原行为保持不变 ✅ |
| dry-run 无副作用 | state diff 确认 ✅ |

---

## v0.3.2 (2026-05-17)

### 清理

- 删除 `content/diagnose-render.js` — 一次性诊断工具（未追踪，无引用）
- 删除 `content/render-trilogy.js` — 已被 pipeline 替代的批量渲染脚本（未追踪，无引用）
- 删除 `state.json.pre-publish` — 发布前 state 备份（未追踪，无引用）

### 验证

- `pipeline status` ✅
- `schedule list` / `due` ✅
- `publish --dry-run` ✅
- 无代码修改，不影响任何现有功能

---

## v0.3.1 (2026-05-17)

### 新增

- scheduler.runDue() — 到期任务 mock 执行
- `schedule run-due --mock-success` — 模拟排期到期后成功发布流程
- `schedule run-due --mock-fail` — 模拟排期到期后失败流程
- 安全限制：run-due mock 只能用于名称含"测试"或"mock"的任务

### 状态流转验证

mock-success:
  CONFIRMED → RUNNING → SUCCEEDED
  post.status: QA_PASSED → PUBLISHED
  文件夹：待投递 → 已投递

mock-fail:
  CONFIRMED → RUNNING → FAILED
  post.status: QA_PASSED → PUBLISH_FAILED
  publish.attempts: +1
  文件夹：不移

### 测试验证

| 场景 | 结果 |
|------|------|
| due 查到到期任务 | ✅ |
| run-due --mock-success | SUCCEEDED，文件夹已移动 ✅ |
| run-due --mock-fail | FAILED，attempts+1，文件夹不移 ✅ |
| due 无副作用 | state diff 确认 ✅ |
| 安全限制 | 非 mock 任务拒绝 ✅ |

---

## v0.3.0 (2026-05-17)

### 新增

- modules/scheduler.js — 排期队列管理模块
- pipeline.js schedule 子命令路由（add/list/status/cancel/due）
- 6 条 schedule 命令：
  - `schedule add <dir> --time <t> --confirm-schedule` — 创建已确认排期
  - `schedule list` — 列出全部排期
  - `schedule status <dir>` — 查看单篇排期
  - `schedule cancel <dir>` — 取消排期
  - `schedule due` — 查看到期任务（纯查询，无副作用）
  - `schedule`（无子命令）— 保留原有推荐时间功能
- 7 个错误码：SCHEDULE_CONFIRM_REQUIRED, SCHEDULE_POST_NOT_FOUND, SCHEDULE_QA_NOT_PASSED, SCHEDULE_ALREADY_PUBLISHED, SCHEDULE_DUPLICATE, SCHEDULE_TIME_INVALID, SCHEDULE_NOT_FOUND

### 安全

- 无 `--confirm-schedule` 的 add 不写入 state
- 已 PUBLISHED / QA_FAILED 的帖子禁止排期
- 重复 active 排期被拒绝
- due 是纯查询，不修改 state

### 测试验证

| 场景 | 结果 |
|------|------|
| add 无 --confirm-schedule | SCHEDULE_CONFIRM_REQUIRED，state 不变 ✅ |
| add --confirm-schedule | CONFIRMED，写入 state ✅ |
| list | 列出全部排期 ✅ |
| status | 返回单篇详情 ✅ |
| due（未来时间） | 空列表，state 不变 ✅ |
| duplicate | SCHEDULE_DUPLICATE ✅ |
| cancel | SKIPPED ✅ |
| due 无副作用 | state diff 确认 ✅ |

---

## v0.2.2 (2026-05-17)

### 修复

- publish-xhs.js：新增退出逻辑。成功时 `process.exit(0)`，失败时 `process.exit(1)`，`finally` 中关闭 browser。解决 publisher 模块因脚本不退出导致的 PUBLISH_SCRIPT_FAILED 误判
- state reconciliation：平台确认发布成功后，将 `PUBLISH_FAILED` 修正为 `PUBLISHED`，清空误判 error

### 首次真实发布验证

- 帖子：内脏脂肪最怕8种家常食物
- 平台确认：✅ 发布成功
- 本地 publisher 超时误判：已人工 reconciled
- 文件夹：待投递 → 已投递
- 记录 `PUBLISH_RECONCILED` 到 error.log

---

## v0.2.1 (2026-05-17)

### 新增

- publish `--mock-success` 模式：模拟发布成功（不调用 publish-xhs.js，写 PUBLISHED，移动文件夹）
- publish `--mock-fail` 模式：模拟发布失败（不调用 publish-xhs.js，写 PUBLISH_FAILED，增加 attempts）
- 安全限制：mock 模式仅允许 taskDir 包含 "测试" 或 "mock" 字样
- 新增错误码：PUBLISH_MOCK_TASK_REQUIRED、MOCK_PUBLISH_FAILED

### 测试验证

- dry-run：7 项前置检查通过/未通过
- 默认模式：返回 PUBLISH_CONFIRM_REQUIRED
- mock-success：state → PUBLISHED，文件夹移入 已投递
- mock-fail：state → PUBLISH_FAILED，attempts +1，文件夹不移
- 安全限制：真实 taskDir 拒绝 mock 模式

---

## v0.2.0 (2026-05-17)

### 新增

- modules/publisher.js — 真实发布模块（前置条件验证 + 子进程调用 publish-xhs.js + 状态更新）
- publish 三种模式：
  - `--dry-run`：仅验证前置条件，不调用发布脚本，不写 PUBLISHED
  - 默认模式（无 flag）：安全保护，提示必须使用 `--confirm-publish`
  - `--confirm-publish`：通过所有前置验证后，调用 publish-xhs.js，成功写入 PUBLISHED

### 变更

- pipeline.js publish 命令：从占位实现升级为三种模式
- README.md：更新工作流、快速开始、已完成清单、roadmap
- 新增错误码：PUBLISH_CONFIRM_REQUIRED, PUBLISH_SCRIPT_FAILED, PUBLISH_CHROME_NOT_FOUND, PUBLISH_COOKIE_NOT_FOUND, PUBLISH_ALREADY_DONE

### 安全

- 真实发布必须 `--confirm-publish` 显式确认，默认模式禁止发布
- 发布前验证 6 项前置条件（QA 状态、manifest、PNG、Chrome、Cookie、重试次数）
- 发布失败不写 PUBLISHED，不移动文件夹
- 发布成功自动移动文件夹：待投递 → 已投递

---

## v0.1.3 (2026-05-17)

### 新增

- README.md — 完整项目说明文档（项目定位、工作流、快速开始、目录结构、安全说明、roadmap）
- CLAUDE.md — 新增 Documentation Update Policy 章节（提交前文档检查规则）
- CHANGELOG.md — 版本记录初始化

### 变更

- 无功能代码变更。本轮纯文档。

---

## v0.1.2 (2026-05-17)

### 修复

- render.js viewport: 540×720, 3x → 1080×1440, 1.5x（匹配 HTML 设计规范）
- 增加导出模式 CSS reset：截图前注入，覆盖 body preview 布局
- 输出 PNG 稳定为 1620×2160（修复 x=-270 偏移和 3240×4320 错误尺寸）

---

## v0.1.1 (2026-05-17)

### 变更

- config.js: 新增 chromePath / cookiePath 字段，支持 config.local.js 覆盖
- config.example.js: 公开配置示例
- config.local.js: 本机私有配置（gitignored，不上传）
- publish-xhs.js / render.js: 硬编码路径改为从 config 读取
- CLAUDE.md: 移除硬编码的本地 Chrome / Cookie 路径
- .gitignore: 新增 config.local.js 排除

### 修复

- 移除已提交文件中的本地绝对路径（用户名、Chrome 位置）

---

## v0.1-alpha (2026-05-17)

### 新增

- config.js — 统一路径与全局配置
- pipeline.js — CLI 编排器（status / qa / schedule / publish）
- modules/state.js — state.json 读写、10 状态状态机、retry 机制
- modules/qa.js — P0 静态检测（字号 / border-radius / manifest / emoji）
- modules/logger.js — error.log 统一记录
- publish 安全占位（--dry-run 仅验证，不写 PUBLISHED）
