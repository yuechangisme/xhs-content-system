#!/usr/bin/env node

/**
 * xhs-content-system v0.1
 * pipeline.js — 主编排器
 *
 * 职责：命令路由 + 调用模块 + 汇总输出 + 更新状态
 * 禁止：包含任何 QA 规则、发布细节、调度算法、业务判断
 *
 * 用法：
 *   node pipeline.js status
 *   node pipeline.js status <taskDir>
 *   node pipeline.js qa <taskDir>
 *   node pipeline.js schedule
 *   node pipeline.js publish <taskDir> [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const state = require('./modules/state');
const logger = require('./modules/logger');
const qa = require('./modules/qa');

// ─── 命令路由 ────────────────────────────────────────────

const [,, command, ...args] = process.argv;
const startTime = Date.now();

function output(result) {
  result.duration = Date.now() - startTime;
  console.log(JSON.stringify(result, null, 2));
}

function errorOut(code, message, moduleName, detail) {
  logger.error(code, moduleName, message, detail);
  output({
    success: false,
    command,
    error: {
      code,
      message,
      module: moduleName,
      timestamp: new Date().toISOString(),
      detail: detail || null,
    },
  });
}

switch (command) {

  // ─── status ────────────────────────────────────────────
  case 'status':
    cmdStatus();
    break;

  // ─── qa ────────────────────────────────────────────────
  case 'qa':
    cmdQa();
    break;

  // ─── schedule ──────────────────────────────────────────
  case 'schedule':
    cmdSchedule();
    break;

  // ─── publish ───────────────────────────────────────────
  case 'publish':
    cmdPublish();
    break;

  default:
    errorOut('UNKNOWN_COMMAND', `未知命令: ${command}`, 'pipeline');
    process.exit(1);
}

// ─── 命令实现 ────────────────────────────────────────────

function cmdStatus() {
  let s;
  try {
    s = state.load();
  } catch (err) {
    errorOut('STATE_INVALID', 'state.json 格式错误', 'pipeline');
    return;
  }

  const taskDir = args[0];

  if (taskDir) {
    // 查看单个帖子
    const post = state.findPost(s, taskDir);
    if (!post) {
      errorOut('POST_NOT_FOUND', `帖子不存在: ${taskDir}`, 'pipeline');
      return;
    }
    output({ success: true, command, data: post });
  } else {
    // 查看全部
    output({
      success: true,
      command,
      data: {
        posts: s.posts,
        schedule: s.schedule,
        updatedAt: s.updatedAt,
      },
    });
  }
}

function cmdQa() {
  const taskDir = args[0];
  if (!taskDir) {
    errorOut('QA_MISSING_ARGS', '请指定帖子目录: pipeline qa <taskDir>', 'qa');
    return;
  }

  // 执行真实静态检测
  const result = qa.run(taskDir);

  // 更新 state
  let s = state.load();
  state.findOrCreatePost(s, taskDir);

  // 每次 QA 前清空上一次的 qa.error 和 qa.checks
  state.updateQaResult(s, taskDir, {
    status: result.data.status,
    checks: result.data.checks,
    error: null,
  });
  state.updatePostStatus(s, taskDir, result.success ? 'QA_PASSED' : 'QA_FAILED');
  const warning = state.save(s);

  // 记录日志
  if (result.success) {
    logger.info('QA_COMPLETED', 'qa', `QA 通过: ${taskDir}`, { checkCount: result.data.checks.length });
  } else {
    const fails = result.data.checks.filter(c => !c.pass).map(c => c.name);
    logger.warn('QA_FAILED', 'qa', `QA 失败: ${taskDir}`, { failedChecks: fails });
  }

  output({
    success: result.success,
    command,
    data: result.data,
    warnings: result.warnings,
    ...(warning ? { warning } : {}),
  });
}

function cmdSchedule() {
  let s;
  try {
    s = state.load();
  } catch (err) {
    errorOut('STATE_INVALID', 'state.json 格式错误', 'pipeline');
    return;
  }

  const pendingPosts = s.posts.filter(p => p.status === 'QA_PASSED');

  if (pendingPosts.length === 0) {
    errorOut('SCHEDULER_NO_PENDING_POSTS', '没有待发布的帖子', 'scheduler');
    return;
  }

  // ─── 占位实现 ─────────────────────────────────────────
  // v0.1 MVP: 简单返回最近发布时间 + 2 天
  // 后续版本实现完整调度算法

  const lastPublished = s.schedule.lastPublishedAt
    ? new Date(s.schedule.lastPublishedAt)
    : new Date();

  const nextDate = new Date(lastPublished);
  nextDate.setDate(nextDate.getDate() + 2);
  nextDate.setHours(12, 0, 0, 0);

  // 如果今天 12:00 已过，推到明天
  const now = new Date();
  if (nextDate <= now) {
    nextDate.setDate(nextDate.getDate() + 1);
  }

  output({
    success: true,
    command,
    data: {
      lastPublishedAt: s.schedule.lastPublishedAt,
      nextRecommendedAt: nextDate.toISOString(),
      reason: `上次发布后间隔 2 天，取午休 12:00 时段`,
      pendingPosts: pendingPosts.map(p => ({ id: p.id, status: p.status })),
    },
  });
}

function cmdPublish() {
  const taskDir = args[0];
  const isDryRun = args.includes('--dry-run');

  if (!taskDir) {
    errorOut('PUBLISH_MISSING_ARGS', '请指定帖子目录: pipeline publish <taskDir> [--dry-run]', 'publisher');
    return;
  }

  // 验证任务目录存在
  const fullPath = path.join(config.contentDir, taskDir);
  if (!fs.existsSync(fullPath)) {
    errorOut('PUBLISH_DIR_NOT_FOUND', `目录不存在: ${fullPath}`, 'publisher');
    return;
  }

  // 验证 output 目录
  const outputDir = path.join(fullPath, 'output');
  if (!fs.existsSync(outputDir)) {
    errorOut('PUBLISH_IMAGES_NOT_FOUND', `output/ 目录不存在: ${outputDir}`, 'publisher');
    return;
  }

  // 验证 manifest.json
  const manifestPath = path.join(fullPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    errorOut('PUBLISH_MANIFEST_NOT_FOUND', `manifest.json 不存在: ${manifestPath}`, 'publisher');
    return;
  }

  // 检查 state.json 中 QA 状态
  let s = state.load();
  const post = state.findPost(s, taskDir);
  if (post && post.status !== 'QA_PASSED') {
    errorOut('PUBLISH_QA_NOT_PASSED', `QA 未通过，禁止发布 (当前状态: ${post.status})`, 'publisher');
    return;
  }

  // 检查重试次数
  if (post && post.publish.attempts >= post.publish.maxRetries) {
    errorOut('PUBLISH_MAX_RETRIES_EXCEEDED', `发布失败已达 ${post.publish.maxRetries} 次上限`, 'publisher');
    return;
  }

  // ─── 占位实现 ─────────────────────────────────────────
  // v0.1 MVP: 仅验证前置条件，不做真实发布
  // 不写 PUBLISHED，不移动文件夹，不污染 schedule

  const imageFiles = fs.readdirSync(outputDir).filter(f => /\.png$/i.test(f)).sort();

  if (!isDryRun) {
    // 安全占位：不使用 --dry-run 时返回未实现错误
    errorOut('PUBLISH_NOT_IMPLEMENTED', '发布模块尚未接入真实发布。使用 --dry-run 进行前置检查', 'publisher');
    return;
  }

  // --dry-run 仅验证前置条件，不修改任何状态
  output({
    success: true,
    command,
    data: {
      taskDir,
      dryRun: true,
      publishedAt: null,
      manifestPath: path.join(taskDir, 'manifest.json'),
      imageCount: imageFiles.length,
      note: '[DRY-RUN] 前置条件通过，未执行真实发布，未修改 state.json',
    },
  });
}
