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

### 职责边界

- scheduler：查 due → 前置检查 → 调 publisher → 更新 schedule 状态
- publisher：前置检查 → 真实发布 → 写 PUBLISHED → 移文件夹
- scheduler 禁止直接调 publish-xhs.js，禁止直接写 PUBLISHED

### 错误码

| 码 | 场景 |
|----|------|
| `SCHEDULE_FLAG_REQUIRED` | run-due 未指定任何 flag |
| `SCHEDULE_TASK_REQUIRED` | confirm 未带 --task |
| `SCHEDULE_TASK_NOT_IN_DUE` | --task 不在到期列表中 |
| `SCHEDULE_NO_DUE_TASKS` | 没有到期任务 |
| `SCHEDULE_PRECHECK_FAILED` | 前置检查未通过 |
