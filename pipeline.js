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
 *   node pipeline.js publish <taskDir> --mock-success         # 模拟发布成功（仅测试用）
 *   node pipeline.js publish <taskDir> --mock-fail            # 模拟发布失败（仅测试用）
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const state = require('./modules/state');
const logger = require('./modules/logger');
const qa = require('./modules/qa');
const publisher = require('./modules/publisher');
const scheduler = require('./modules/scheduler');

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
  const sub = args[0];

  // 无子命令时保留原有推荐时间功能
  if (!sub) {
    let s;
    try { s = state.load(); } catch (err) { errorOut('STATE_INVALID', 'state.json 格式错误', 'pipeline'); return; }
    const pendingPosts = s.posts.filter(p => p.status === 'QA_PASSED');
    const lastPublished = s.schedule.lastPublishedAt ? new Date(s.schedule.lastPublishedAt) : new Date();
    const nextDate = new Date(lastPublished);
    nextDate.setDate(nextDate.getDate() + 2);
    nextDate.setHours(12, 0, 0, 0);
    if (nextDate <= new Date()) nextDate.setDate(nextDate.getDate() + 1);
    output({ success: true, command, data: { lastPublishedAt: s.schedule.lastPublishedAt, nextRecommendedAt: nextDate.toISOString(), reason: '上次发布后间隔 2 天，取午休 12:00 时段', pendingPosts: pendingPosts.map(p => ({ id: p.id, status: p.status })) } });
    return;
  }

  // ─── 子命令路由 ────────────────────────────────────
  switch (sub) {
    case 'add':
      return cmdScheduleAdd();
    case 'list':
      return cmdScheduleList();
    case 'status':
      return cmdScheduleStatus();
    case 'cancel':
      return cmdScheduleCancel();
    case 'due':
      return cmdScheduleDue();
    case 'run-due':
      return cmdScheduleRunDue();
    default:
      errorOut('UNKNOWN_COMMAND', `未知 schedule 子命令: ${sub}。可用命令: add, list, status, cancel, due, run-due`, 'pipeline');
  }
}

function cmdScheduleAdd() {
  const taskDir = args[1];
  const timeIndex = args.indexOf('--time');
  const timeStr = timeIndex >= 0 ? args[timeIndex + 1] : null;
  const confirmed = args.includes('--confirm-schedule');

  if (!taskDir || !timeStr) {
    errorOut('SCHEDULE_MISSING_ARGS', '用法: pipeline schedule add <taskDir> --time "YYYY-MM-DD HH:mm" [--confirm-schedule]', 'scheduler');
    return;
  }

  const result = scheduler.add(taskDir, timeStr, confirmed);
  if (!result.success) {
    errorOut(result.error.code, result.error.message, 'scheduler', result.error.detail);
    return;
  }
  output({ success: true, command, data: result.data, ...(result.warning ? { warning: result.warning } : {}) });
}

function cmdScheduleList() {
  const result = scheduler.list();
  output({ success: true, command, data: result.data });
}

function cmdScheduleStatus() {
  const taskDir = args[1];
  if (!taskDir) {
    errorOut('SCHEDULE_MISSING_ARGS', '用法: pipeline schedule status <taskDir>', 'scheduler');
    return;
  }
  const result = scheduler.status(taskDir);
  if (!result.success) {
    errorOut(result.error.code, result.error.message, 'scheduler');
    return;
  }
  output({ success: true, command, data: result.data });
}

function cmdScheduleCancel() {
  const taskDir = args[1];
  if (!taskDir) {
    errorOut('SCHEDULE_MISSING_ARGS', '用法: pipeline schedule cancel <taskDir>', 'scheduler');
    return;
  }
  const result = scheduler.cancel(taskDir);
  if (!result.success) {
    errorOut(result.error.code, result.error.message, 'scheduler');
    return;
  }
  output({ success: true, command, data: result.data, ...(result.warning ? { warning: result.warning } : {}) });
}

function cmdScheduleDue() {
  const result = scheduler.due();
  output({ success: true, command, data: result.data });
}

function cmdScheduleRunDue() {
  const isMockSuccess = args.includes('--mock-success');
  const isMockFail = args.includes('--mock-fail');

  if (!isMockSuccess && !isMockFail) {
    errorOut('SCHEDULE_MISSING_ARGS', '用法: pipeline schedule run-due --mock-success 或 --mock-fail', 'scheduler');
    return;
  }

  const mockType = isMockSuccess ? 'success' : 'fail';
  const result = scheduler.runDue(mockType);

  if (!result.success) {
    errorOut('SCHEDULE_RUN_FAILED', '执行到期任务失败', 'scheduler');
    return;
  }

  output({ success: true, command, data: result.data });
}

function cmdPublish() {
  const taskDir = args[0];
  const isDryRun = args.includes('--dry-run');
  const isConfirm = args.includes('--confirm-publish');
  const isMockSuccess = args.includes('--mock-success');
  const isMockFail = args.includes('--mock-fail');

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

  // ─── 模式 B: mock 模式（仅测试用）────────────────
  if (isMockSuccess || isMockFail) {
    // 安全限制：只能用于测试任务
    if (!taskDir.includes('测试') && !taskDir.includes('mock')) {
      errorOut('PUBLISH_MOCK_TASK_REQUIRED',
        'mock 模式只能用于名称包含"测试"或"mock"的任务目录', 'publisher');
      return;
    }
    if (isMockSuccess) return cmdPublishMockSuccess(taskDir, fullPath, s, post);
    return cmdPublishMockFail(taskDir, fullPath, s, post);
  }

  // ─── 模式 C: 默认模式（无 flag）───────────────────
  if (!isConfirm) {
    errorOut('PUBLISH_CONFIRM_REQUIRED',
      '安全保护：真实发布需要 --confirm-publish 确认。使用 --dry-run 进行前置检查', 'publisher');
    return;
  }

  // ─── 模式 D: confirm 模式 ─────────────────────────
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

// ─── 模式 B1: mock-success ─────────────────────────────

function cmdPublishMockSuccess(taskDir, fullPath, s, post) {
  const outputDir = path.join(fullPath, 'output');
  const pngFiles = fs.existsSync(outputDir) ? fs.readdirSync(outputDir).filter(f => /\.png$/i.test(f)) : [];

  state.updatePublishResult(s, taskDir, { status: 'PUBLISHED', publishedAt: new Date().toISOString(), error: null, attempts: 1 });
  state.updatePostStatus(s, taskDir, 'PUBLISHED');
  s.schedule.lastPublishedAt = new Date().toISOString();
  state.save(s);

  // 移动文件夹
  const folderName = path.basename(fullPath);
  const targetDir = path.join(config.contentDir, '投稿内容', '已投递', folderName);
  try {
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(fullPath, targetDir);
    logger.info('PUBLISH_MOCK_SUCCESS', 'publisher', `mock 发布成功: ${taskDir}`, { targetDir });
  } catch (moveErr) {
    logger.warn('PUBLISH_MOVE_FAILED', 'publisher', `mock 成功但文件夹移动失败: ${moveErr.message}`, { targetDir });
  }

  output({
    success: true,
    command: 'publish',
    data: {
      mode: 'mock-success',
      taskDir,
      publishedAt: new Date().toISOString(),
      imageCount: pngFiles.length,
      note: 'MOCK 发布成功：未调用真实 publish-xhs.js，state 已更新为 PUBLISHED，文件夹已移动',
    },
  });
}

// ─── 模式 B2: mock-fail ────────────────────────────────

function cmdPublishMockFail(taskDir, fullPath, s, post) {
  const outputDir = path.join(fullPath, 'output');
  const pngFiles = fs.existsSync(outputDir) ? fs.readdirSync(outputDir).filter(f => /\.png$/i.test(f)) : [];
  const attempts = (post.publish.attempts || 0) + 1;

  state.updatePublishResult(s, taskDir, {
    status: 'FAILED', error: { code: 'MOCK_PUBLISH_FAILED', message: 'mock 模拟发布失败' },
    attempts,
  });
  state.updatePostStatus(s, taskDir, 'PUBLISH_FAILED');
  state.save(s);

  logger.error('MOCK_PUBLISH_FAILED', 'publisher', `mock 发布失败: ${taskDir}`, { attempts });

  output({
    success: false,
    command: 'publish',
    error: {
      code: 'MOCK_PUBLISH_FAILED',
      message: `MOCK 模拟发布失败 (attempt ${attempts})：未调用真实 publish-xhs.js`,
      module: 'publisher',
      timestamp: new Date().toISOString(),
      detail: { taskDir, attempts },
    },
  });
}

// ─── 模式 D: confirm 发布 ─────────────────────────────

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
