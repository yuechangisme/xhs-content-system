# xhs-content-system

**AI-powered RedNote / Xiaohongshu content workflow system.**

一个 AI 驱动的小红书内容自动化执行系统，用于承接 xhs-planner skill 生成的内容，并完成状态管理、HTML 渲染、QA 检测、发布节奏管理和后续自动发布流程。

---

## 版本状态

```
当前版本: v0.1.2
当前阶段: execution baseline + render/export hotfix
```

### 已完成

- `config.js` 统一配置（含 `config.local.js` 私有覆盖）
- `state.json` 状态管理（10 状态状态机 + retry 机制）
- `error.log` 日志系统
- `pipeline.js` CLI 骨架（status / qa / schedule / publish）
- `modules/qa.js` 静态 P0 检测（字号 / border-radius / manifest / emoji）
- `render.js` 1080×1440 → 1620×2160 稳定导出
- `publish --dry-run` 安全占位（仅验证前置条件，不污染 state）
- GitHub / Gitee 双远程基线

### 未完成

- publisher 真实接入
- 自动定时发布
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

---

## 当前工作流

```
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
[后续] publisher 真实接入
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

# 发布前验证（仅 dry-run，不会真实发布）
node pipeline.js publish "投稿内容/待投递/你的任务目录" --dry-run
```

> ⚠️ 当前 `publish` 仅支持 `--dry-run`，不会真实发布到小红书。

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
│   └── logger.js            ← error.log 日志
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
| v0.2 | publisher 接入 | 真实发布到小红书 |
| v0.3 | scheduler | 定时发布 |
| v0.4 | 热点获取 | 自动选题建议 |
| v0.5 | 数据回流 | 发布后数据追踪 |

---

## 相关项目

- [xhs-planner](https://github.com/yuechangisme/xhs-planner) — 小红书内容策划 skill（策略层）

---

## License

MIT
