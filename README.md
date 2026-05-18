# xhs-content-system

**AI-powered RedNote / Xiaohongshu content workflow system.**

一个 AI 驱动的小红书内容自动化执行系统，用于承接 xhs-planner skill 生成的内容，并完成状态管理、HTML 渲染、QA 检测、发布节奏管理和后续自动发布流程。

---

## 版本状态

```
当前版本: v0.5.2
当前阶段: seasonal calendar dry-run generator（季节节点预览 + 选题抽取）
```

### 已完成

- `config.js` 统一配置（含 `config.local.js` 私有覆盖）
- `state.json` 状态管理（10 状态状态机 + retry 机制）
- `error.log` 日志系统
- `pipeline.js` CLI 骨架（status / qa / schedule / publish / topic）
- `modules/qa.js` 静态 P0 检测（字号 / border-radius / manifest / emoji）
- `render.js` 1080×1440 → 1620×2160 稳定导出
- `publish --dry-run` 安全占位（仅验证前置条件，不污染 state）
- `publish --confirm-publish` 真实发布（调用 publish-xhs.js，写 PUBLISHED，移动文件夹）
- `publish --mock-success` / `--mock-fail` 模拟发布测试
- 五种发布模式：dry-run / 默认安全保护 / confirm / mock-success / mock-fail
- publish-xhs.js 正常退出（browser.close + process.exit）
- 真实发布 → 小红书平台确认成功
- 状态 reconciliation：PUBLISH_FAILED 可人工修正为 PUBLISHED
- GitHub / Gitee 双远程基线
- `modules/scheduler.js` 排期队列管理（add/list/status/cancel/due）
- 7 个 SCHEDULE_* 错误码
- 定时发布安全确认模型（`--confirm-schedule` / `CONFIRMED` 状态）
- `modules/topic-store.js` 本地选题候选池（add/list/show/shortlist/approve/reject/export）
- 7 个 TOPIC_* 错误码
- TopicCandidate 5 状态流转 + 人工确认规则
- `modules/seasonal-generator.js` 季节/节气选题生成器（预览候选，不写入）
- `seasonal-calendar.json` 季节节点参考数据（24 节气 + 节日 + 场景节点）
- 6 个 SEASONAL_* / TOPIC_GENERATE_* 错误码

### 未完成

- 节气/季节选题写入候选池（--confirm-generate）
- 公开热点适配器（微博热搜、百度热搜）
- trend-pulse 可行性验证
- 小红书平台内热点采集（暂缓）
- 自动热点获取
- 数据回流
- 多账号管理
- Web 管理界面

---

## 项目定位

```
xhs-planner skill    = 策略层 / 大脑
xhs-content-system   = 执行层 / 身体
```

**xhs-planner 负责：**
- 平台分析、内容策划、选题判断
- 账号人格、内容审核逻辑

**xhs-content-system 负责：**
- 内容状态管理、渲染导出
- QA 检测、发布前验证
- 发布节奏建议、后续真实发布接入
- 选题候选池管理（v0.5.1+）

---

## 当前工作流

```
seasonal-calendar.json
    ↓
module: seasonal-generator    ← v0.5.2 新增：季节节点预览候选
    ↓ dry-run → 用户检查质量
手动录入 / 节气节点 / 外部热点
    ↓
module: topic-store          ← v0.5.1 新增：本地选题候选池
    ↓ 人工确认（CANDIDATE → SHORTLISTED → APPROVED → EXPORTED）
Agent / xhs-planner skill
    ↓ 生成 HTML + manifest
render.js
    ↓ 导出 PNG 1620×2160
pipeline.js qa <taskDir>
    ↓ QA 检测 → QA_PASSED / QA_FAILED
pipeline.js schedule
    ↓ 推荐发布时间
pipeline.js publish <taskDir> --dry-run
    ↓ 验证发布前置条件
pipeline.js publish <taskDir> --confirm-publish
    ↓ 真实发布（需显式确认）
pipeline.js publish <taskDir>
    ↓ 安全保护：提示必须 --confirm-publish
```

---

## 快速开始

### 前置条件

```bash
# Node.js 20+
node -v

# 安装依赖
cd content && npm install
```

### 配置

```bash
# 复制配置示例，填充本机路径
cp config.example.js config.local.js
# 编辑 config.local.js，设置 chromePath 和 cookiePath
```

### 常用命令

```bash
# 查看所有帖子状态
node pipeline.js status

# 查看单个帖子状态
node pipeline.js status "投稿内容/待投递/2026-05-17-内脏脂肪食物"

# 渲染 HTML → PNG
cd content && node render.js "投稿内容/待投递/你的任务目录/xxx.html" "文件前缀"

# QA 检测
node pipeline.js qa "投稿内容/待投递/你的任务目录"

# 查看推荐发布时间
node pipeline.js schedule

# 排期管理
node pipeline.js schedule add "<taskDir>" --time "2026-05-19 12:00" --confirm-schedule
node pipeline.js schedule list
node pipeline.js schedule status "<taskDir>"
node pipeline.js schedule cancel "<taskDir>"
node pipeline.js schedule due
node pipeline.js schedule run-due --mock-success                    # 模拟到期成功（仅测试）
node pipeline.js schedule run-due --mock-fail                       # 模拟到期失败（仅测试）
node pipeline.js schedule run-due --confirm-scheduled-publish        # 列出到期任务，不执行
node pipeline.js schedule run-due --confirm-scheduled-publish --dry-run --task "<taskDir>"  # 发布前验证

# 本地选题池（v0.5.1）
node pipeline.js topic add --title "夏季养生" --source manual --raw "灵感来源" --reason "节气热点"           # 创建候选
node pipeline.js topic list                                                                                   # 查看候选列表
node pipeline.js topic show <topicId>                                                                         # 查看单个候选
node pipeline.js topic shortlist <topicId>                                                                    # 初筛通过
node pipeline.js topic approve <topicId>                                                                      # 确认选题
node pipeline.js topic reject <topicId> --reason "原因"                                                       # 否决选题
node pipeline.js topic export <topicId>                                                                       # 导出给 xhs-planner

# 季节选题生成器（v0.5.2）
node pipeline.js topic seasonal list                                                                          # 查看所有季节节点
node pipeline.js topic seasonal list --month 6                                                                # 查看6月节点
node pipeline.js topic seasonal list --season summer                                                          # 查看夏季节点
node pipeline.js topic seasonal list --type solar_term                                                        # 查看节气节点
node pipeline.js topic seasonal generate --term "立夏" --dry-run                                               # 预览立夏选题候选
node pipeline.js topic seasonal generate --month 6 --dry-run                                                  # 预览6月选题候选

# 发布前验证（dry-run，不调用真实发布脚本）
node pipeline.js publish "投稿内容/待投递/你的任务目录" --dry-run

# 默认模式（安全保护，提示必须 --confirm-publish）
node pipeline.js publish "投稿内容/待投递/你的任务目录"

# 真实发布（需显式确认，否则拒绝执行）
node pipeline.js publish "投稿内容/待投递/你的任务目录" --confirm-publish

# 模拟发布成功（仅测试用，不调真实脚本）
node pipeline.js publish "投稿内容/待投递/mock-发布测试" --mock-success

# 模拟发布失败（仅测试用，不调真实脚本）
node pipeline.js publish "投稿内容/待投递/mock-发布测试" --mock-fail
```

---

## 目录结构

```
xhs-content-system/
├── config.js                ← 统一配置（公开，上传）
├── config.example.js        ← 配置示例（公开，上传）
├── config.local.js          ← 本机私有配置（不上传）
├── pipeline.js              ← CLI 编排器
├── CLAUDE.md                ← 项目级 AI 指令
├── README.md
├── CHANGELOG.md
│
├── modules/
│   ├── state.js             ← state.json 状态管理
│   ├── qa.js                ← P0 静态检测
│   ├── logger.js            ← error.log 日志
│   ├── topic-store.js       ← TopicCandidate 选题候选池管理
│   └── seasonal-generator.js ← 季节/节气选题生成器
│
├── topics/                  ← 选题候选池（运行时状态，不上传）
│   ├── candidates.json      ← TopicCandidate 列表
│   └── exported/            ← 已导出选题（供 xhs-planner 参考）
│
├── seasonal-calendar.json   ← 季节节点参考数据（可提交 Git）
│
├── content/
│   ├── render.js            ← HTML → PNG 导出
│   ├── publish-xhs.js       ← 小红书自动发布脚本
│   ├── 投稿内容/             ← 帖子资产（已投递/待投递/待制作）
│   ├── 公共素材库/           ← 图片素材（不上传）
│   └── 账号信息/             ← 品牌元素（不上传）
│
├── state.json               ← 运行时状态（不上传）
└── error.log                ← 运行日志（不上传）
```

### 不上传的文件

| 文件 | 原因 |
|------|------|
| `config.local.js` | 包含本机 Chrome / Cookie 路径 |
| `state.json` | 运行时状态，每次变化 |
| `error.log` | 运行日志 |
| `content/**/output/` | 渲染输出的 PNG 图片 |
| `content/公共素材库/` | 个人素材 |
| `content/账号信息/` | 品牌元素 |
| `content/node_modules/` | 依赖 |
| `topics/` | 选题候选池，运行时状态 |
| `.claude/` | Claude 配置 |

---

## 安全说明

- 不提交 cookie 文件
- 不提交 `xiaohongshu.json`
- 不提交 `config.local.js`
- 不提交 `content/**/output/` 下的 PNG
- 不提交 `content/公共素材库/`
- 不提交 `content/账号信息/`
- 不提交 `state.json` / `error.log`

> 若 fork 本仓库，请先在 `.gitignore` 中确认上述规则，避免误传隐私数据。

---

## Roadmap

| 版本 | 阶段 | 说明 |
|------|------|------|
| v0.1-alpha | 执行底座 | config / state / logger / pipeline CLI / qa 静态检测 |
| v0.1.1 | 配置清理 | 移除硬编码本地路径，引入 config.local.js |
| v0.1.2 | render hotfix | 统一 viewport 1080×1440，CSS reset 注入 |
| v0.1.3 | docs baseline | README / CHANGELOG / documentation policy |
| v0.2 | publisher 接入 | 真实发布（五种模式 + 首次真实发布验证 + reconciliation） |
| v0.3 | scheduler | 排期队列管理（add/list/status/cancel/due） |
| v0.4 | 热点获取 | 自动选题建议 |
| v0.5 | 数据回流 | 发布后数据追踪 |

---

## 相关项目

- [xhs-planner (GitHub)](https://github.com/yuechangisme/xhs-planner) — 小红书内容策划 skill（策略层）
- [xhs-planner (Gitee)](https://gitee.com/yuechangIsMe/xhs-planner) — 同上，国内镜像

---

## License

MIT
