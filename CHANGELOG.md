# Changelog

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
