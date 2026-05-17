# Changelog

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
