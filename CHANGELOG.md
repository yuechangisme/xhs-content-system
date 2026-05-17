# Changelog

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
