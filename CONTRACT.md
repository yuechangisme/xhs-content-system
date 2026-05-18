# xhs-content-system Contract

## v0.3.0 — Schedule Queue Contract

### 状态字段设计

在 `state.json` 的每个 post 中新增 `schedule` 字段：

```json
{
  "id": "投稿内容/待投递/2026-05-19-夏季养生",
  "status": "QA_PASSED",
  "schedule": {
    "scheduledAt": "2026-05-19T12:00:00+08:00",
    "confirmed": false,
    "status": "CONFIRMED",
    "triggeredAt": null,
    "completedAt": null,
    "note": null
  }
}
```

### schedule.status 枚举

| 状态 | 含义 | 何时设置 |
|------|------|---------|
| `CONFIRMED` | 已排期且已确认 | `schedule add --confirm-schedule` 成功后 |
| `RUNNING` | 正在执行发布 | scheduler 触发 publish 时 |
| `SUCCEEDED` | 发布成功 | publisher 返回成功 |
| `FAILED` | 发布失败 | publisher 返回失败 |
| `SKIPPED` | 被人工取消 | `schedule cancel` |

**v0.3.0 不引入**：PENDING（草稿排期）、MISSED（过期标记）、DUPLICATE（重复排期拒绝）。

### schedule add 行为

```bash
# 无 --confirm-schedule：只做预检查，不写入 state
node pipeline.js schedule add "<taskDir>" --time "2026-05-19 12:00"
# → 返回 SCHEDULE_CONFIRM_REQUIRED
# → 不修改 state.json
# → 不创建任何排期记录

# 有 --confirm-schedule：执行全部前置检查后写入 state
node pipeline.js schedule add "<taskDir>" --time "2026-05-19 12:00" --confirm-schedule
# → 检查：QA_PASSED / 未 PUBLISHED / 无重复排期
# → 写入 state.json
# → schedule.status = CONFIRMED
# → schedule.confirmed = true
```

### schedule add 前置检查清单

```
✓ posts[].status = QA_PASSED
✓ publish.status ≠ PUBLISHED
✓ 不存在 CONFIRMED / RUNNING 的重复排期
✓ --time 是未来时间
✗ QA_FAILED 不能排期
✗ PUBLISHED 不能排期
✗ 已存在 active 排期不能重复 add
```

### schedule due 行为

```bash
node pipeline.js schedule due
# → 返回所有 CONFIRMED + time ≤ now 的排期
# → 不修改 state.json
# → 不触发发布
# → 不标记 MISSED
# 纯查询操作，无副作用
```

### schedule CLI 命令汇总（v0.3.0）

| 命令 | 副作用 | 说明 |
|------|--------|------|
| `schedule add <dir> --time <t>` | 无 | 仅检查，返回 SCHEDULE_CONFIRM_REQUIRED |
| `schedule add <dir> --time <t> --confirm-schedule` | 写入 state | 创建 CONFIRMED 排期 |
| `schedule list` | 无 | 列出所有排期 |
| `schedule status <dir>` | 无 | 单个排期详情 |
| `schedule cancel <dir>` | 写入 state | 标记 SKIPPED |
| `schedule due` | 无 | 列出到期任务，不自动执行 |

### v0.3.0 禁止

- 不安装 node-schedule
- 不做常驻进程
- 不自动发布
- 不自动 mock
- 不自动标记 MISSED
- 不修改 publisher 逻辑

---

## Error Codes（新增）

| Code | 场景 |
|------|------|
| `SCHEDULE_CONFIRM_REQUIRED` | add 未带 --confirm-schedule |
| `SCHEDULE_QA_NOT_PASSED` | 帖子状态不是 QA_PASSED |
| `SCHEDULE_ALREADY_PUBLISHED` | 帖子已发布 |
| `SCHEDULE_DUPLICATE` | 已存在 active 排期 |
| `SCHEDULE_TIME_IN_PAST` | --time 是过去时间 |
| `SCHEDULE_NOT_FOUND` | 排期不存在 |

---

## v0.3.3 — Controlled Scheduled Publish Contract

### CLI 安全命令矩阵

| 命令 | 行为 | 真实发布 |
|------|------|---------|
| `schedule due` | 查询到期任务 | ❌ 纯查询 |
| `schedule run-due`（无 flag） | **拒绝** → `SCHEDULE_FLAG_REQUIRED` | ❌ |
| `schedule run-due --mock-success` | mock 成功 | ❌ |
| `schedule run-due --mock-fail` | mock 失败 | ❌ |
| `schedule run-due --confirm-scheduled-publish` | 列出到期任务，不执行 | ❌ |
| `schedule run-due --confirm-scheduled-publish --dry-run --task "<taskDir>"` | 完整前置检查，不发布 | ❌ |
| `schedule run-due --confirm-scheduled-publish --task "<taskDir>"` | **真实 scheduled publish** | **✅** |

### 安全规则

1. 无 flag → `SCHEDULE_FLAG_REQUIRED`
2. `--confirm-scheduled-publish` 但无 `--task` → 列出任务，要求 `--task`
3. `--confirm-scheduled-publish --dry-run --task` → 检查全部，不发布，不写 state
4. `--confirm-scheduled-publish --task` → 真实发布（需 13 项前置检查全部通过）
5. 即使 due tasks = 1，也必须显式指定 `--task`

### 13 项前置检查

```
schedule.confirmed / schedule.status = CONFIRMED / scheduledAt <= now
post.status = QA_PASSED / qa.status = PASSED
publish.status = PENDING / attempts < maxRetries
taskDir 物理存在 / manifest.json 存在 / output/ 有 PNG
chromePath / cookiePath / cookie 文件
```

### 职责边界（v0.3.5 修正版）

#### publisher.publish()

仅负责执行发布动作，返回结果。不更新 state，不移动文件夹。

```
输入: taskDir
动作: 验证前置条件 → 调用 publish-xhs.js（子进程）→ 捕获 stdout/stderr/exitCode
返回: { success, data?: { publishedAt, imageCount }, error?: { code, message, detail } }
```

#### caller（pipeline.js / scheduler.js）

根据 publisher 返回结果更新全层状态和移动文件夹。手动发布和排期发布遵循相同模式。

```
caller 收到 publisher 成功:
  → 更新 posts[].status = PUBLISHED
  → 更新 publish.status = PUBLISHED
  → 更新 publish.publishedAt = now
  → 更新 schedule.lastPublishedAt = now
  → 更新 schedule.status = SUCCEEDED（如适用）
  → 移动文件夹：待投递 → 已投递

caller 收到 publisher 失败:
  → 更新 posts[].status = PUBLISH_FAILED
  → 更新 publish.status = FAILED
  → 更新 publish.attempts +1
  → 更新 publish.error
  → 不移动文件夹
```

#### 禁止行为

- scheduler 不得直接调用 publish-xhs.js（必须通过 publisher.publish()）
- publisher 不得直接处理 state/文件夹（由 caller 负责）
- 任何模块不得绕过前置检查直接写 PUBLISHED

### 错误码

| 码 | 场景 |
|----|------|
| `SCHEDULE_FLAG_REQUIRED` | run-due 未指定任何 flag |
| `SCHEDULE_TASK_REQUIRED` | confirm 未带 --task |
| `SCHEDULE_TASK_NOT_IN_DUE` | --task 不在到期列表中 |
| `SCHEDULE_NO_DUE_TASKS` | 没有到期任务 |
| `SCHEDULE_PRECHECK_FAILED` | 前置检查未通过 |

---

## 附录：state.json 与物理归档的职责说明

### state.json 的边界

state.json 只记录**进入 pipeline 管理后**的帖子运行状态。它的设计目标是管线状态机，不是完整历史内容数据库。

具体边界：
- **进入时机**：`pipeline qa <taskDir>` 首次运行（通过 `findOrCreatePost`）时，帖子才进入 state.json
- **前置发布的帖子不追溯**：在 state 系统上线前已发布的历史帖子（如早期的好习惯、超级食物、高考饮食），可能在 `已投递/` 目录中归档完整，但 state.json 中无记录
- **已发布帖子不自动同步**：手动将帖子移入 `已投递/` 不会自动创建 state 记录

### 归档完整性标准

内容归档完整性应以物理目录检查为准：

```
已投递/<taskDir>/
├── 懒人养生手册-<主题>.html    ✅
├── manifest.json                ✅（v0.2+ 新增）
└── output/
    ├── <主题>-01.png             ✅
    ├── <主题>-02.png             ✅
    └── ...                       ✅ 全部 PNG
```

state.json 用于运行控制（QA 状态 / 发布状态 / 排期状态 / 重试次数），**不等同于完整历史内容数据库**。

### 实践建议

- 审计归档完整性时，以 `已投递/` 物理目录为准
- 审计运行状态一致性时，以 state.json 为准
- 如果后续需要做历史内容管理或 analytics，应单独设计 state backfill 方案，不在日常维护中手动补录

---

## v0.5 — Topic Discovery Contract

### 目标

v0.5 的目标是：

```
外部热点 / 人工灵感 / 季节节点
→ 统一转换为 TopicCandidate
→ 进入候选池
→ 用户确认
→ 再交给 xhs-planner 做完整策划
```

topic discovery **只负责发现线索**，不负责生成帖子，不负责发布。

### 系统边界

```
xhs-planner skill     = 策略层 / 内容策划（上游）
xhs-content-system    = 执行层 / render/QA/publish（下游）
v0.5 topic discovery  = 中间线索层
```

topic discovery 位于 xhs-planner 和 xhs-content-system 之间，提供选题线索输入。不替代任何现有模块。

### 热点来源 4 级分级策略

| 级别 | 分类 | 说明 | 风险 | v0.5 MVP |
|------|------|------|------|----------|
| **Tier 0** | 本地 / 人工输入 | 手动录入灵感、节气/节日/季节节点、账号历史选题复盘、已发布内容数据 | 无 | **P0** 主推 |
| **Tier 1** | 低风险公开热点 | 微博热搜、百度热搜、节日节气日历、公开新闻关键词、公开搜索趋势摘要 | 低 | P1 扩展目标 |
| **Tier 2** | 第三方工具 / MCP | trend-pulse 这类通用热点聚合工具 | 中 | P2 需验证 |
| **Tier 3** | 高风险平台内采集 | 小红书搜索、小红书热榜、xhs-cli、反指纹浏览器、登录态爬虫 | 高 | **暂缓** |

### MVP 支持范围

- **v0.5 MVP 支持 Tier 0**：本地/人工输入 + 节气/季节节点 + 手动热点导入
- Tier 1 公开热点自动适配器 **经可行性评估暂缓**（热点与养生定位匹配度低、生命周期短）
- Tier 2 先做可行性验证（v0.5.4），通过后再决定是否接入
- Tier 3 明确暂缓，v0.5 不接入

### Source Adapter Contract

每个外部热点来源必须通过 Source Adapter 适配为统一格式，不允许直接进入内容生成。

```json
{
  "sourceId": "manual | seasonal | weibo | baidu | trend-pulse | xhs-search | xhs-manual | youtube-manual | baidu-manual | weibo-manual | news-manual | other-manual",
  "sourceType": "manual | public_trend | third_party_tool | platform_internal",
  "riskLevel": "low | medium | high",
  "requiresLogin": false,
  "requiresApiKey": false,
  "fetchMode": "manual | file | http | mcp | crawler",
  "enabled": false,

  "output": "TopicCandidate[]"
}
```

**适配器生命周期：**
1. 注册：sourceId + metadata 接入候选池
2. 启用：enabled = true（人工确认后才启用）
3. 获取：fetch() → TopicCandidate[]
4. 禁用：enabled = false（随时可关闭）
5. 移除：从配置中删除

**约束：**
- 不修改任何外部状态
- 不写 topic pool 之外的存储
- 不触发发布
- 不调用 xhs-planner
- 不调用 xhs-content-system 任何模块

### TopicCandidate 最小结构

```json
{
  "id": "tc-20260518-seasonal-001",
  "title": "夏季养生冷知识",
  "source": "seasonal",
  "sourceMeta": {
    "solarTerm": "立夏",
    "date": "2026-05-05"
  },
  "rawSignal": "节气：立夏 → 夏季养生需求攀升",
  "trendReason": "立夏前后养生类搜索量上升，用户关注夏季饮食调整",
  "accountFitReason": "懒人养生定位：简单实用的夏季习惯，不折腾",
  "contentAngle": "立夏后最值得培养的3个懒人习惯",
  "scores": {
    "trendScore": 75,
    "fitScore": 85,
    "overallScore": 80
  },
  "status": "CANDIDATE",
  "createdAt": "2026-05-18T00:00:00.000Z",
  "approvedAt": null,
  "exportedAt": null,
  "note": null
}
```

| 字段 | 说明 | 必填 |
|------|------|------|
| `id` | 唯一 ID，格式 `tc-{date}-{source}-{seq}` | ✅ |
| `title` | 选题标题 | ✅ |
| `source` | 来源 ID（manual/seasonal/weibo/baidu/trend-pulse/xhs-search） | ✅ |
| `sourceMeta` | 来源附加信息 | 可选 |
| `rawSignal` | 原始信号描述 | ✅ |
| `trendReason` | 为什么这个话题目前有热度 | ✅ |
| `accountFitReason` | 为什么适合懒人养生这个账号 | ✅ |
| `contentAngle` | 建议的内容切入点 | 可选 |
| `scores` | 评分 trendScore/fitScore/overallScore（0-100） | ✅ |
| `status` | 候选状态 | ✅ |
| `createdAt` | 创建时间 | ✅ |
| `approvedAt` | 人工确认时间 | 可选 |
| `exportedAt` | 导出给 xhs-planner 的时间 | 可选 |
| `note` | 人工备注 | 可选 |

### Topic 状态流转

```
                    ┌──────────┐
                    │ CANDIDATE │ ← 初始状态，来源适配器产出
                    └────┬─────┘
                         │
                    ┌────▼──────┐
                    │ SHORTLISTED│ ← 人工初筛通过，进入候选池
                    └────┬──────┘
                         │
                    ┌────▼──────┐
              ┌─────│  APPROVED  │─────┐
              │     └────┬──────┘     │
              │          │            │
              │     ┌────▼──────┐     │
              │     │  EXPORTED  │     │
              │     └───────────┘     │
              │                      │
              │                 ┌────▼──────┐
              │                 │  REJECTED  │
              │                 └───────────┘
```

| 状态 | 含义 | 触发 |
|------|------|------|
| `CANDIDATE` | 初始候选，来源适配器产出 | 自动 |
| `SHORTLISTED` | 人工初筛，觉得有潜力，进入候选池 | 人工 |
| `APPROVED` | 最终确认，准备生产内容 | 人工 |
| `EXPORTED` | 已交给 xhs-planner 进入完整策划 | 人工触发导出 |
| `REJECTED` | 否决，可附带理由 | 人工 |

### 人工确认规则

**禁止：**
- topic discovery 不得直接创建帖子
- topic discovery 不得直接发布
- topic discovery 不得调用 render / QA / publisher / scheduler
- topic discovery 不得修改 state.json 中的 posts 记录
- 未 APPROVED 的 topic 不能交给 xhs-planner
- 未 APPROVED 的 topic 不能生成任何内容

**允许：**
- topic discovery 可以调用外部源获取原始信号
- topic discovery 可以维护独立于 state.json 的 topic pool
- topic discovery 可以写独立的 topic pool 存储（非 state.json）

### trend-pulse 后续验证清单

如需接入 trend-pulse，必须先逐项验证以下 12 项：

| # | 验证项 |
|---|--------|
| 1 | README 承诺的能力是否真实（clone 后本地运行确认） |
| 2 | 20 个内置源是否零 API Key 可用 |
| 3 | MCP Server 模式是否稳定 |
| 4 | 输出格式是否符合 TopicCandidate 要求 |
| 5 | 是否可禁用不需要的数据源 |
| 6 | 是否需要联网才能工作 |
| 7 | 本地运行资源消耗（CPU/内存/磁盘） |
| 8 | 是否引入依赖冲突 |
| 9 | MIT License 是否有附加条款 |
| 10 | 是否会污染 xhs-content-system 架构 |
| 11 | 是否可作为独立进程运行（不侵入现有系统） |
| 12 | 是否可动态开关 |

**通过标准：** 全部 12 项验证通过，才允许接入。

### 小红书爬虫暂缓理由

小红书搜索 / xhs-cli / 反指纹爬虫列为 **Tier 3 高风险来源**，v0.5 MVP 不接入。

| 风险维度 | 说明 |
|----------|------|
| 平台风控 | 小红书有反爬机制，反指纹浏览器可能被检测 |
| 稳定性不可控 | 小红书前端代码频繁更新，爬虫容易失效 |
| 需要登录态 | cookie 可能过期，需要维护登录态 |
| 账号安全 | 爬虫行为可能导致账号被限流或封禁 |
| 法律风险 | 爬虫抓取内容的法律边界不清晰 |
| 维护成本 | 需要持续跟进小红书更新，维护成本高 |
| 当前必要性 | v0.5 MVP 可以先做 Tier 0-2，不需要小红书数据 |

### v0.5 分阶段路线

| 版本 | 阶段 | 内容 |
|------|------|------|
| v0.5.0 | 策略冻结 | 当前：Source Adapter Contract、TopicCandidate 结构、分级策略 |
| v0.5.1 | 本地 Topic Pool | 手动录入候选选题、查看/筛选/确认、状态流转、独立存储 |
| v0.5.2 | 节气/季节选题生成器 | 预制节气日历、根据节气自动生成 TopicCandidate、可编辑确认 |
| v0.5.3 | 手动热点导入增强 | 增强 topic add 支持手动录入多平台热点线索（xhs/youtube/baidu/weibo/…），不做自动抓取 |
| v0.5.4 | trend-pulse 可行性验证 | 按 12 项清单逐项验证、决定是否作为外部源接入 |
| v0.5.5 | 外部源适配器原型 | 如果 v0.5.4 通过：接入 trend-pulse MCP；否则设计替代方案 |
| v0.6+ | 再评估小红书 | 再评估小红书平台内采集的可行性 |

### 登录态来源暂缓规则（v0.5.3）

以下来源无论风险等级如何，v0.5 阶段**明确不接入**：

| 来源 | 暂缓理由 |
|------|----------|
| 小红书 session | 需要用户登录态 cookie，复用发布账号有安全风险 |
| YouTube session | 需要 Google 账号登录，数据量大但选题转化率低 |
| 微博 session | 直接访问需登录，反爬机制严格 |
| 任何需要 cookie 的源 | 不读取 cookie，不复用发布账号登录态 |
| 反指纹浏览器 | 不使用反指纹浏览器 |
| 自动平台内抓取 | 不自动抓取平台内数据 |

**未来如果要接入 session source，必须满足以下全部条件：**
1. 单独做 feasibility check
2. 不能默认启用（必须 opt-in）
3. 不能复用发布账号的登录态
4. 不能使用 `--confirm-publish` 相同的 cookie 文件
5. 需要独立的 Risk Assessment 文档
6. 默认 `enabled = false`

### v0.5.3 Manual Trend Import Enhancement

#### 目标

增强现有 `topic add` 命令，支持手动录入来自多平台的热点线索。

**不改变系统自动发现热点的能力，仅提高人工录入效率。**

#### 支持的 source

```
manual, xhs-manual, youtube-manual, baidu-manual, weibo-manual, news-manual, other-manual
```

不删除已有 source（seasonal、trend-pulse、xhs-search 等），仅追加不破坏兼容。

#### 新增参数

| 参数 | 说明 |
|------|------|
| `--url` | 原始内容 URL |
| `--platform` | 中文平台名（未指定时按 source 自动推断） |
| `--observed-at` | 观察到的时间（未指定时使用当前时间） |
| `--trend-score` | 时效性评分 0-100 |
| `--fit-score` | 匹配度评分 0-100 |

**分数规则：**
- `overallScore = trendScore × 0.4 + fitScore × 0.6`
- 分数超出 0-100 返回 `TOPIC_SCORE_INVALID`
- 未提供时默认 0

#### sourceMeta 结构

```json
{
  "platform": "小红书",
  "platformSource": "xhs-manual",
  "url": "https://www.xiaohongshu.com/explore/xxx",
  "observedAt": "2026-05-19T12:00:00.000Z"
}
```

#### 禁止

- 不自动抓取
- 不联网
- 不爬虫
- 不读取 session
- 不读取 cookie
- 不调用平台 API
- 不自动写入 candidates.json（仍需 `topic add` 人工确认）
- 不生成帖子
- 不调用 xhs-planner
- 不修改 state.json

### v0.5.0 禁止

- 不写代码
- 不新增 modules/topic-discovery.js
- 不新增 topic pool 文件
- 不改 pipeline.js
- 不调用网络
- 不 clone trend-pulse
- 不安装依赖
- 不接入 MCP
- 不抓取热点
- 不生成帖子
- 不发布

---

## v0.5.2 Seasonal Topic Generator Contract

### 设计目标

Seasonal Topic Generator 只负责：
- 根据节气 / 节日 / 季节节点生成选题候选
- 输出 TopicCandidate，写入 topics/candidates.json
- 状态为 CANDIDATE

**禁止：**
- 不生成帖子
- 不调用 xhs-planner
- 不调用 render / QA / publish / schedule
- 不修改 state.json
- 不联网
- 不抓取外部热点

### Seasonal Calendar 数据结构

文件位置：`seasonal-calendar.json`（项目根目录，参考数据，可提交 Git）

```json
{
  "id": "sc-lixia",
  "name": "立夏",
  "type": "solar_term",
  "defaultDate": "05-05",
  "yearlyDates": {
    "2026": "05-05",
    "2027": "05-06"
  },
  "season": "summer",
  "weekOffset": 2,
  "userNeeds": "立夏后气温升高，用户关注清热祛湿、夏季饮食调整、防暑",
  "topicHints": [
    "立夏后最该吃的3种食材",
    "夏天怎么吃不容易犯困",
    "立夏养生记住这几点就够了"
  ],
  "riskNotes": "避免极端节食推荐，注意高温天气运动安全提示"
}
```

| 字段 | 说明 | 必填 |
|------|------|------|
| `id` | 唯一 ID，格式 `sc-{type}-{key}` | ✅ |
| `name` | 中文名称 | ✅ |
| `type` | `solar_term` / `festival` / `seasonal_scene` | ✅ |
| `defaultDate` | `MM-DD` 格式默认日期 | ✅ |
| `yearlyDates` | 按年份覆盖日期（解决节气浮动），key 为年份字符串 | 可选 |
| `season` | `spring`/`summer`/`autumn`/`winter`/`all` | ✅ |
| `weekOffset` | 提前多少周开始推荐（默认 2） | 可选 |
| `userNeeds` | 该节点下用户潜在需求描述 | ✅ |
| `topicHints` | 选题角度示例 3-5 条 | ✅ |
| `riskNotes` | 健康/医疗风险提示 | 可选 |

**日期解析逻辑：**
```
1. 如果 year + yearlyDates[year] 存在 → 使用 yearlyDates[year]
2. 否则使用 defaultDate（当前年份 + MM-DD）
3. festival / seasonal_scene 使用固定 defaultDate 或规则描述
```

**节点类型：**
| 类型 | 示例 | 预期数量 |
|------|------|---------|
| `solar_term` | 立夏、小满、芒种…… | 24 |
| `festival` | 春节、端午、中秋、国庆 | 8-10 |
| `seasonal_scene` | 入梅、三伏天、开学季、考试季、换季 | 10-15 |

### 账号定位依赖设计

Seasonal Generator **不硬编码账号方向**。

**读取链：**
```
1. 尝试读取 config.local.js 的 accountProfile 字段（本机私有配置）
2. 如果没有配置，使用 seasonal-calendar.json 中的通用 userNeeds 文本
3. 如果都没有，返回 SEASONAL_ACCOUNT_PROFILE_MISSING
```

**accountProfile 最小结构（在 config.local.js 中）：**
```json
{
  "accountProfile": {
    "niche": "养生健康",
    "audience": "25-35岁年轻人群",
    "tone": "懒人友好、不折腾",
    "topics": ["饮食", "习惯", "睡眠", "运动", "心理"],
    "avoidTopics": ["医疗建议", "药物推荐"],
    "accountFitTemplates": [
      "懒人养生定位：{simple_action}，不折腾",
      "适合{audience}的{niche}方法"
    ]
  }
}
```

**accountFitReason 生成：**
```
accountFitReason = accountProfile.accountFitTemplates[N]
                    .replace('{simple_action}', contentAngle)
                    .replace('{audience}', accountProfile.audience)
                    .replace('{niche}', accountProfile.niche)
```

目标：未来即使账号换赛道，修改 config.local.js 即可，不修改代码。

### TopicCandidate 生成规则

| TopicCandidate 字段 | 生成规则 |
|-------------------|---------|
| `id` | `tc-{生成日期}-seasonal-{seq}`（沿用 topic-store） |
| `title` | 从 `topicHints` 选取或组合，或由 LLM 基于 `userNeeds` 生成 |
| `source` | 固定 `seasonal` |
| `sourceMeta` | `{ "seasonalId": "sc-lixia", "name": "立夏", "type": "solar_term", "date": "2026-05-05" }` |
| `rawSignal` | `{type}：{name} → {short userNeeds}` |
| `trendReason` | `{name}前后{niche}类话题季节性关注上升` |
| `accountFitReason` | 见账号定位依赖设计 |
| `contentAngle` | 从 `topicHints` 选取最匹配的一条 |
| `scores` | 见评分机制 |
| `status` | 固定 `CANDIDATE` |
| `note` | `由 seasonal generator 基于 {name} 生成` |

**生成数量控制：**
- 每个节点最多生成 3 条（不同 contentAngle）
- 单次 `--all` 最多 30 条
- 所有产出为 CANDIDATE

### 评分机制

```
overallScore = trendScore × 0.4 + fitScore × 0.6
```

**trendScore（时效性，0-100）：**

| 距离节点天数 | 分数 | 说明 |
|------------|------|------|
| 0-7 天前 | 80-100 | 最佳窗口期 |
| 8-14 天前 | 60-80 | 提前准备期 |
| 15-30 天前 | 40-60 | 可储备期 |
| 节点当天 | 70-90 | 当天热度高 |
| 节点后 1-3 天 | 40-60 | 热度余量 |
| 节点后 4 天+ | 0-30 | 已过时效 |

**节点类型权重：**
| 类型 | 权重 | 理由 |
|------|------|------|
| `solar_term` | ×1.0 | 养生账号核心节点 |
| `festival` | ×0.8 | 相关性稍弱 |
| `seasonal_scene` | ×1.2 | 场景感强，收藏价值高 |

**fitScore（账号匹配度，0-100）：**

| 匹配程度 | 分数 | 示例 |
|---------|------|------|
| 直接养生 | 80-100 | 立夏饮食、三伏天祛湿 |
| 养生相关 | 60-80 | 换季睡眠、考试季减压 |
| 生活场景 | 40-60 | 开学季作息调整 |
| 弱相关 | 20-40 | 春节购物、国庆旅游 |
| 不相关 | 0-20 | 圣诞装饰、情人节礼物 |

### CLI 设计

**seasonal list — 查询节点：**
```bash
node pipeline.js topic seasonal list
node pipeline.js topic seasonal list --month 6
node pipeline.js topic seasonal list --season summer
node pipeline.js topic seasonal list --type solar_term
```
- 不写 candidates.json
- 不触发内容生成

**seasonal generate — 两步安全模式：**

第一步 — dry-run（预览，不写入）：
```bash
node pipeline.js topic seasonal generate --month 6 --dry-run
```
- 预览将生成哪些 TopicCandidate
- 不写 candidates.json
- 不修改任何文件
- 返回 `TOPIC_GENERATE_CONFIRM_REQUIRED`

第二步 — confirm-generate（确认后写入）：
```bash
node pipeline.js topic seasonal generate --month 6 --confirm-generate
```
- 执行防重复检查
- 写入 TopicCandidate，status = CANDIDATE
- 无 `--confirm-generate` 时默认返回 `TOPIC_GENERATE_CONFIRM_REQUIRED`

**参数互斥：**
```bash
seasonal generate (--term "立夏" | --month 6 | --range "2026-06-01:2026-06-30" | --all)
# 必须选一个，互斥
```

### 防重复策略

| 场景 | 规则 |
|------|------|
| 同一节点多角度 | ✅ 允许（每个 topicHint 生成一条） |
| 标题完全一致 | ❌ 跳过 |
| REJECTED 的 seasonal topic | ❌ 不重复生成。除非 reject 理由标注 `角度不对` 可手动重试 |
| EXPORTED 的 seasonal topic | ❌ 不重复生成。跨年可重新生成（note 标注"上一年已导出：{title}"） |
| 跨年复用 | ✅ 允许，但 note 标注历史记录 |

**实际检查逻辑：**
```
对每个待生成的 title：
  1. 扫描 candidates.json 中 source === "seasonal"
  2. 如果存在同 title 的 CANDIDATE/SHORTLISTED/APPROVED/EXPORTED → 跳过
  3. 如果存在同 title 的 REJECTED → 检查 reject note → 跳过或允许
```

### 人工确认边界

```
seasonal generate --confirm-generate
    ↓
TopicCandidate[]（全部 CANDIDATE）→ 写入 candidates.json
    ↓
用户: topic list
    ↓
用户: topic shortlist        ← 第一轮筛选
    ↓
用户: topic approve          ← 最终确认
    ↓
用户: topic export           ← 导出给 xhs-planner
```

**必须保持：**
- ✅ seasonal generate 只输出 CANDIDATE
- ✅ 未经 shortlist/approve 不能 export
- ✅ 用户拒绝理由不带"角度不对"时，同节点不再生成
- ❌ seasonal generate 不能创建帖子目录
- ❌ seasonal generate 不能跳过 topic pool
- ❌ seasonal generate 不能调用 xhs-planner
- ❌ seasonal generate 不能发布

### 新增错误码

| 码 | 场景 |
|----|------|
| `TOPIC_GENERATE_CONFIRM_REQUIRED` | seasonal generate 未带 --confirm-generate |
| `SEASONAL_NODE_NOT_FOUND` | 指定的节气/节点不存在 |
| `SEASONAL_DATE_INVALID` | 日期格式无效 |
| `SEASONAL_DUPLICATE_TOPIC` | 待生成的 topic 与现有候选中重复 |
| `SEASONAL_CALENDAR_INVALID` | seasonal-calendar.json 解析失败 |
| `SEASONAL_ACCOUNT_PROFILE_MISSING` | 账号定位 profile 未配置 |
