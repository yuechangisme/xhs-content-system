#!/usr/bin/env node

/**
 * xhs-content-system v0.2
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
 *   node pipeline.js publish <taskDir> --dry-run              # 仅验证，不调用
 *   node pipeline.js publish <taskDir>                        # 提示需要 --confirm-publish
 *   node pipeline.js publish <taskDir> --confirm-publish      # 真实发布
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const state = require('./modules/state');
const logger = require('./modules/logger');
const qa = require('./modules/qa');
const publisher = require('./modules/publisher');

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
  const isConfirm = args.includes('--confirm-publish');

  if (!taskDir) {
    errorOut('PUBLISH_MISSING_ARGS', '请指定帖子目录: pipeline publish <taskDir> [--dry-run|--confirm-publish]', 'publisher');
    return;
  }

  // 验证任务目录存在
  const fullPath = path.join(config.contentDir, taskDir);
  if (!fs.existsSync(fullPath)) {
    errorOut('PUBLISH_DIR_NOT_FOUND', `目录不存在: ${fullPath}`, 'publisher');
    return;
  }

  // 加载 state
  let s = state.load();
  const post = state.findOrCreatePost(s, taskDir);

  // ─── 模式 A: dry-run ─────────────────────────────
  if (isDryRun) {
    return cmdPublishDryRun(taskDir, fullPath, post);
  }

  // ─── 模式 B: 默认模式（无 flag）───────────────────
  if (!isConfirm) {
    errorOut('PUBLISH_CONFIRM_REQUIRED',
      '安全保护：真实发布需要 --confirm-publish 确认。使用 --dry-run 进行前置检查', 'publisher');
    return;
  }

  // ─── 模式 C: confirm 模式 ─────────────────────────
  return cmdPublishConfirm(taskDir, fullPath, s, post);
}

// ─── 模式 A: dry-run ──────────────────────────────────

function cmdPublishDryRun(taskDir, fullPath, post) {
  const outputDir = path.join(fullPath, 'output');
  const manifestPath = path.join(fullPath, 'manifest.json');
  const checks = [];

  checks.push({ name: 'dir_exists', pass: fs.existsSync(fullPath) });
  checks.push({ name: 'manifest_exists', pass: fs.existsSync(manifestPath) });

  if (fs.existsSync(manifestPath)) {
    try {
      JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      checks.push({ name: 'manifest_valid', pass: true });
    } catch (e) {
      checks.push({ name: 'manifest_valid', pass: false });
    }
  } else {
    checks.push({ name: 'manifest_valid', pass: false });
  }

  const outputExists = fs.existsSync(outputDir);
  const pngCount = outputExists ? fs.readdirSync(outputDir).filter(f => /\.png$/i.test(f)).length : 0;
  checks.push({ name: 'output_exists', pass: outputExists && pngCount > 0 });

  checks.push({ name: 'qa_passed', pass: post ? post.status === 'QA_PASSED' : false });
  checks.push({ name: 'chrome_configured', pass: !!config.chromePath });
  checks.push({ name: 'cookie_configured', pass: !!config.cookiePath });

  const allPassed = checks.every(c => c.pass);

  output({
    success: allPassed,
    command: 'publish',
    data: {
      mode: 'dry-run',
      taskDir,
      publishedAt: null,
      checks,
      imageCount: pngCount,
      note: allPassed
        ? '[DRY-RUN] 前置条件通过，可执行 --confirm-publish 真实发布'
        : '[DRY-RUN] 前置条件未全部满足，请修复后重试',
    },
  });
}

// ─── 模式 C: confirm 发布 ─────────────────────────────

async function cmdPublishConfirm(taskDir, fullPath, s, post) {
  // 前置检查
  if (post.status !== 'QA_PASSED') {
    errorOut('PUBLISH_QA_NOT_PASSED', `QA 未通过，禁止发布 (当前状态: ${post.status})`, 'publisher');
    return;
  }

  if (post.publish.status === 'PUBLISHED') {
    errorOut('PUBLISH_ALREADY_DONE', `帖子已发布 (publishedAt: ${post.publish.publishedAt})`, 'publisher');
    return;
  }

  if (post.publish.attempts >= post.publish.maxRetries) {
    errorOut('PUBLISH_MAX_RETRIES_EXCEEDED', `发布失败已达 ${post.publish.maxRetries} 次上限`, 'publisher');
    return;
  }

  if (!config.chromePath) {
    errorOut('PUBLISH_CHROME_NOT_FOUND', 'config.chromePath 未配置，无法启动浏览器', 'publisher');
    return;
  }

  if (!config.cookiePath || !fs.existsSync(config.cookiePath)) {
    errorOut('PUBLISH_COOKIE_NOT_FOUND', 'config.cookiePath 未配置或文件不存在', 'publisher');
    return;
  }

  // 标记 PUBLISHING
  state.updatePublishResult(s, taskDir, {
    status: 'RUNNING',
    attempts: post.publish.attempts + 1,
    lastAttemptAt: new Date().toISOString(),
    error: null,
  });
  state.updatePostStatus(s, taskDir, 'PUBLISHING');
  state.save(s);

  // 执行发布
  const result = await publisher.publish(taskDir);

  if (result.success) {
    // 成功：写 PUBLISHED
    state.updatePublishResult(s, taskDir, {
      status: 'PUBLISHED',
      publishedAt: result.data.publishedAt,
      error: null,
    });
    state.updatePostStatus(s, taskDir, 'PUBLISHED');

    // 更新全局 schedule
    s.schedule.lastPublishedAt = result.data.publishedAt;
    state.save(s);

    // 移动文件夹：待投递 → 已投递
    const parentDir = path.dirname(fullPath);
    const folderName = path.basename(fullPath);
    const targetDir = path.join(config.contentDir, '投稿内容', '已投递', folderName);

    try {
      // 如果目标已存在先删除
      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
      fs.renameSync(fullPath, targetDir);
    } catch (moveErr) {
      logger.error('PUBLISH_MOVE_FAILED', 'publisher',
        `发布成功但文件夹移动失败: ${moveErr.message}`, { source: fullPath, target: targetDir });
    }

    logger.info('PUBLISH_SUCCEEDED', 'publisher', `发布成功: ${taskDir}`,
      { imageCount: result.data.imageCount });

    output({
      success: true,
      command: 'publish',
      data: {
        mode: 'confirm',
        taskDir,
        publishedAt: result.data.publishedAt,
        imageCount: result.data.imageCount,
        note: '发布成功',
      },
    });

  } else {
    // 失败：写 PUBLISH_FAILED
    state.updatePublishResult(s, taskDir, {
      status: 'FAILED',
      error: result.error,
    });
    state.updatePostStatus(s, taskDir, 'PUBLISH_FAILED');
    state.save(s);

    logger.error(result.error.code || 'PUBLISH_FAILED', 'publisher',
      `发布失败: ${taskDir}`, { message: result.error.message });

    errorOut(result.error.code || 'PUBLISH_FAILED', result.error.message, 'publisher', result.error.detail);
  }
}
