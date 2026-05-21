# Handoff — xhs-content-system

## 项目一句话目标

```
外部热点 / 人工灵感 / 季节节点
→ TopicCandidate
→ xhs-planner 策划
→ HTML / PNG 渲染
→ QA 检测
→ 排期
→ 小红书发布
```

## 当前系统分层

| 层 | 职责 | 所属 |
|---|------|------|
| **策略层** | 内容策划、选题判断、账号人格 | xhs-planner skill |
| **执行层** | 渲染、QA、发布、排期、状态管理 | xhs-content-system |
| **线索层** | 选题候选发现、季节节点生成、热点适配 | topic discovery（v0.5+） |

**关键约束：**
- topic discovery 不能替代 xhs-planner（不生成帖子、不策划内容）
- topic discovery 不能替代 xhs-content-system（不渲染、不发布、不排期）
- topic discovery 只能提供 TopicCandidate，必须经人工确认后才能进入策划

## 当前版本进度

| 版本 | 阶段 | 状态 |
|------|------|------|
| v0.1 | 执行底座（config/state/logger/CLI/QA） | ✅ 完成 |
| v0.2 | 真实发布闭环（publisher/publish-xhs.js） | ✅ 完成 |
| v0.3 | 排期发布闭环（scheduler/scheduled publish） | ✅ 完成 |
| v0.4 | 清理 + 安全规则 + 归档一致性 | ✅ 完成 |
| v0.5.0 | Topic Discovery Contract | ✅ 完成 |
| v0.5.1 | Local Topic Pool（add/list/show/shortlist/approve/reject/export） | ✅ 完成 |
| **v0.5.2** | **Seasonal Topic Generator** | **✅ 完成** |
| **v0.5.3** | **Manual Trend Import Enhancement** | **✅ 完成** |
| **v0.5.4** | **Post Performance Analytics** | **✅ 完成** |
| **v0.5.5** | **Render Exit Code Hotfix** | **✅ 完成** |
| **v0.5.6** | **Publish Precheck Hotfix** | **✅ 最新** |
| v0.6.0 | 无人值守自动发布 | ⏳ 已设计合约，暂未实现 |
| — | 公开热点适配器 | ❌ 经评估暂缓 |
| — | 小红书爬虫/平台内采集 | ❌ 暂缓 |

## 已完成能力清单

### 执行层

- config.js / config.local.js 配置体系
- state.json 10 状态状态机 + retry 机制
- error.log 统一日志
- render.js 1080×1440 → 1620×2160 Puppeteer 导出
- qa.js P0 静态检测（字号/border-radius/manifest/emoji）
- publish --dry-run（前置条件验证）
- publish --confirm-publish（真实发布，写 PUBLISHED，移文件夹）
- publish --mock-success / --mock-fail
- publish-xhs.js 正常退出（browser.close + process.exit）
- 5 种发布模式：dry-run / 默认安全 / confirm / mock-success / mock-fail
- 状态 reconciliation（PUBLISH_FAILED → PUBLISHED）
- scheduler queue（add/list/status/cancel/due）
- scheduled mock publish（success/fail）
- scheduled dry-run
- scheduled real publish（13 项前置检查）
- 文件夹归档：待投递 → 已投递
- GitHub / Gitee 双远程基线

### 安全与文档

- Documentation Update Policy（CLAUDE.md）
- Destructive Operation Safety Policy（10 条删除安全规则）
- General Agent Coding Discipline（6 条编码纪律）
- state.json 与物理归档职责边界（CONTRACT.md 附录）
- CONTRACT.md 合约管理（v0.3 schedule / v0.3.3 controlled publish / v0.5 topic discovery）
- README.md 用户入口说明
- CHANGELOG.md 版本记录

### Topic Discovery

- v0.5.0 Topic Discovery Contract（4 级分级、Source Adapter、TopicCandidate 结构）
- v0.5.1 Local Topic Pool（topic add/list/show/shortlist/approve/reject/export）
- topics/candidates.json 运行时候选池
- topics/exported/ 导出目录
- 7 个 TOPIC_* 错误码
- v0.5.2 Phase 1 seasonal-calendar.json（34 个节点：24 节气 + 4 节日 + 6 场景）
- v0.5.2 Phase 1 seasonal-generator.js（list/generate dry-run）
- v0.5.2 Phase 2 confirm-generate（`--confirm-generate` 写入候选池）
- v0.5.2 Phase 2 防重复写入（importSeasonalCandidates，同一年/seasonalId/title 跳过）
- 6 个 SEASONAL_* 错误码
- 评分机制（trendScore/fitScore/overallScore）
- v0.5.3 topic add 手动热点导入增强（--url/--platform/--observed-at/--trend-score/--fit-score）
- v0.5.3 多平台 manual source（xhs-manual / youtube-manual / baidu-manual / weibo-manual / news-manual / other-manual）
- v0.5.3 分数越界校验（TOPIC_SCORE_INVALID 错误码）
- v0.5.4 analytics 模块（add/list/summary，Tier 0 手动录入）
- v0.5.4 衍生指标自动计算 + 6 个 ANALYTICS_* 错误码

## 当前关键规则

### 发布安全
- 不允许未确认真实发布
- 真实发布必须显式 `--confirm-publish`
- scheduled real publish 必须指定 `--task`
- dry-run 不得修改 state
- 发布成功后才能写 PUBLISHED
- 发布失败不能移动文件夹

### 删除安全
- 删除前必须 dry-run audit（完整路径/数量/大小/Git 状态）
- 未跟踪文件删除前必须备份到 `cleanup-backup/`
- 不允许宽泛通配符批量删除
- 不允许删除未列入清单的文件
- 删除后必须回归验证核心命令

### state / archive 边界
- state.json 不是内容归档唯一事实来源
- 物理目录（HTML + manifest + output PNG）才是归档完整性最终依据
- 物理目录与 state.json 必须分别审计、分别描述
- 发现不一致时暂停开发，先做 reconciliation audit

### Topic Discovery 规则
- topic discovery 不得直接生成帖子
- topic discovery 不得调用 xhs-planner
- topic discovery 不得调用 render / QA / publish / schedule
- topic discovery 不得修改 state.json
- 未 APPROVED 的 topic 不得 export
- EXPORTED 后才允许交给 xhs-planner
- seasonal generate 必须 dry-run / confirm-generate 两步
- 当前 Phase 1 只支持 dry-run
- Phase 2 才允许实现 confirm-generate 写入 topic pool
- 不接入外部热点源
- 不接入小红书爬虫
- 不调用 trend-pulse

## v0.5.6 当前状态

**最新正式 tag：** v0.5.6
**当前阶段：** 发布前置检查已增强，完整链路已验证通过（analytics → xhs-planner → render → QA → schedule → scheduled publish）

### 全流程闭环验证完成
- analytics 真实数据录入（6 篇帖子）
- analytics summary 复盘 → 数据驱动选题
- TopicCandidate → shortlist → approve → export
- xhs-planner 策划方案
- HTML + manifest 生成
- render 9 张 PNG（1620×2160）
- QA PASSED
- schedule add → scheduled publish dry-run → scheduled real publish
- 小红书平台确认发布成功

### v0.5.6 发布前置检查增强（最新）
- publish dry-run / scheduled dry-run 新增 5 项检查：
  - `chrome_exists` — 验证 Chrome 文件真实存在
  - `manifest_valid` — 验证 manifest.json 可解析
  - `manifest_xiaohongshu_title` — 检查 outputs.xiaohongshu.copy.title
  - `manifest_xiaohongshu_body` — 检查 outputs.xiaohongshu.copy.body
  - `manifest_xiaohongshu_tags` — 检查 tags 非空且 ≤ 10
- 三个入口已覆盖：pipeline.js dry-run / publisher.js 真实发布 / scheduler.js runDueConfirm

### 当前仍为受控排期发布
- schedule add 只是创建排期
- schedule due 只是查询到期任务
- schedule run-due 需要手动执行
- 没有后台常驻 scheduler
- 没有接入 Windows Task Scheduler
- 到点不会自动发布

### v0.6.0 无人值守发布（已设计合约，暂未实现）
- 合约已设计但未实现代码
- 依赖本次发布的 precheck 增强作为安全基线
- 进入前需先确认本次 scheduled publish 稳定

## 重要文件说明

| 文件 | 说明 | Git |
|------|------|-----|
| `README.md` | 项目入口说明 | ✅ |
| `CHANGELOG.md` | 版本变更记录 | ✅ |
| `CONTRACT.md` | 接口、状态、模块合约 | ✅ |
| `CLAUDE.md` | Agent 行为规则 | ✅ |
| `docs/HANDOFF.md` | 新对话交接文档 | ✅ |
| `pipeline.js` | CLI 主入口 | ✅ |
| `modules/state.js` | state.json 状态管理 | ✅ |
| `modules/qa.js` | QA 静态检测 | ✅ |
| `modules/publisher.js` | 发布执行封装 | ✅ |
| `modules/scheduler.js` | 排期队列与 scheduled publish | ✅ |
| `modules/topic-store.js` | TopicCandidate 本地候选池 | ✅ |
| `modules/seasonal-generator.js` | 季节节点 dry-run 生成器 | ✅ |
| `seasonal-calendar.json` | 静态季节节点参考数据 | ✅ |
| `topics/candidates.json` | 运行时 topic 候选池 | ❌ gitignored |
| `topics/exported/` | 运行时 topic 导出目录 | ❌ gitignored |
| `content/render.js` | HTML → PNG Puppeteer 渲染 | ✅ |
| `content/publish-xhs.js` | 小红书 Puppeteer 发布脚本 | ✅ |
| `state.json` | 运行时状态 | ❌ gitignored |
| `config.local.js` | 本机私有配置 | ❌ gitignored |

## 新对话启动提示词

```
请先阅读项目中的以下文件：

* README.md
* CHANGELOG.md
* CONTRACT.md
* CLAUDE.md
* docs/HANDOFF.md

先不要写代码。

请先复述：

1. 当前项目目标
2. 当前版本进度
3. 已完成能力
4. 当前正在做的任务
5. 下一步应该做什么
6. 当前禁止做什么

确认理解后，再等待我下达任务。
```
