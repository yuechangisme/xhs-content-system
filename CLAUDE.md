# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

「懒人养生手册」小红书账号的内容生产基地。养生健康方向，面向 25-35 岁年轻人群，走「懒人友好、不折腾」的调性。

## 内容结构

```
content/
├── 公共素材库/               ← 所有已用图片汇总，新任务先来这里找图
├── render.js                 ← Puppeteer HTML→PNG 渲染脚本
├── 流程参考.md               ← 完整内容生产流程
├── 账号信息/                 ← 头像、背景图、品牌元素
│
├── YYYY-MM-DD-主题关键词/    ← 每篇内容一个独立文件夹
│   ├── 懒人养生手册-主题.html   ← 轮播图 HTML
│   ├── 主题-文案.md            ← 小红书发布文案
│   ├── images/                 ← 本篇用到的配图
│   ├── output/                 ← 导出的 PNG 文件
│   └── drafts/                 ← 过程文件
```

## 关键命令

```bash
# 导出 HTML 为 PNG（3x 高清，1620x2160）
cd content
node render.js "YYYY-MM-DD-主题/懒人养生手册-主题.html" "文件前缀"
# 示例
node render.js "2026-05-15-高考饮食/懒人养生手册-高考饮食.html" "高考饮食"

# 本地预览 HTML（需要 HTTP 服务，否则 html2canvas 读不到本地图片）
npx http-server -p 8080 content/ --cors
# 打开 http://127.0.0.1:8080/ 访问
```

## 账号规则

- 标题 ≤ 20 字
- 标签 ≤ 10 个
- 品牌色：暖白底 #FEFAE0 + 健康绿 #3A7D44 + 暖橙 #F4A261
- 语气：朋友式分享，不端不装，口语短句
- 禁止词："本文将介绍""姐妹们""每天坚持""绝绝子"
- 人设："我也是踩坑过来的，帮你省时间"

## 内容策划流程

使用 `xhs-planner` skill 按 9 步流程走：
选题分析 → 用户分析 → 爆点分析 → 内容策略 → 视觉策略 → 确认方向 → 内容生成 → 内容审核 → 复盘优化

## Windows 路径注意

- 本地路径：`D:\AI workspace\fish-contend-pipeline\content\xxx`
- Puppeteer file URL：`file:///D:/AI%20workspace/...`
- 路径拼接：`path.resolve()` 后 `replace(/\\/g, '/')`
- Chrome 位置：`C:/Users/MECHREUO/.cache/puppeteer/chrome/win64-131.0.6778.204/chrome-win64/chrome.exe`

## 依赖

- Node.js 20+
- Puppeteer（已安装 Chrome 131，.cache 目录下）
- 图片来源：Pexels CDN（images.pexels.com 可直接热链）
