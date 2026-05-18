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
