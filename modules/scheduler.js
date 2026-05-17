/**
 * xhs-content-system v0.3.0
 * scheduler 模块 — 排期队列管理
 *
 * 职责：schedule add / list / status / cancel / due
 * 不包含：自动发布、node-schedule、常驻进程
 *
 * 所有函数直接返回 result 对象，不操作 pipeline 输出。
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const state = require('./state');
const logger = require('./logger');
const publisher = require('./publisher');

const ACTIVE_STATUSES = ['CONFIRMED', 'RUNNING'];

/**
 * 排期 add
 *
 * @param {string} taskDir - 帖子目录（相对 content/）
 * @param {string} timeStr - "YYYY-MM-DD HH:mm" 格式
 * @param {boolean} confirmed - 是否已确认
 * @returns {object} { success, data?, error? }
 */
function add(taskDir, timeStr, confirmed) {
  // 1. 解析时间
  const parsed = parseTime(timeStr);
  if (!parsed) {
    return { success: false, error: { code: 'SCHEDULE_TIME_INVALID', message: `时间格式无效: ${timeStr}。预期格式: YYYY-MM-DD HH:mm` } };
  }

  const scheduledAt = parsed.toISOString();

  if (!confirmed) {
    return { success: false, error: { code: 'SCHEDULE_CONFIRM_REQUIRED', message: '确认排期需要 --confirm-schedule' } };
  }

  // 2. 加载 state
  let s = state.load();
  const post = state.findPost(s, taskDir);

  if (!post) {
    return { success: false, error: { code: 'SCHEDULE_POST_NOT_FOUND', message: `帖子不存在: ${taskDir}` } };
  }

  // 3. 前置检查
  if (post.status === 'PUBLISHED') {
    return { success: false, error: { code: 'SCHEDULE_ALREADY_PUBLISHED', message: `帖子已发布，不能排期 (status: ${post.status})` } };
  }

  if (post.status !== 'QA_PASSED') {
    return { success: false, error: { code: 'SCHEDULE_QA_NOT_PASSED', message: `帖子 QA 未通过，不能排期 (status: ${post.status})` } };
  }

  // 4. 检查重复排期
  const existing = post.schedule;
  if (existing && ACTIVE_STATUSES.includes(existing.status)) {
    return {
      success: false,
      error: {
        code: 'SCHEDULE_DUPLICATE',
        message: `已有 active 排期 (status: ${existing.status}, scheduledAt: ${existing.scheduledAt})。需 cancel 后重新排期`,
        detail: { existingStatus: existing.status, existingTime: existing.scheduledAt },
      },
    };
  }

  // 5. 写入排期
  post.schedule = {
    scheduledAt,
    confirmed: true,
    status: 'CONFIRMED',
    triggeredAt: null,
    completedAt: null,
    note: null,
  };

  const warning = state.save(s);
  logger.info('SCHEDULE_ADDED', 'scheduler', `排期已创建: ${taskDir}`, { scheduledAt, status: 'CONFIRMED' });

  const result = {
    success: true,
    data: {
      taskDir,
      scheduledAt,
      status: 'CONFIRMED',
      confirmed: true,
      note: '排期已创建。到点后使用 schedule due 查看到期任务',
    },
  };
  if (warning) result.warning = warning;
  return result;
}

/**
 * 列出所有排期
 */
function list() {
  const s = state.load();
  const scheduled = s.posts.filter(p => p.schedule).map(p => ({
    id: p.id,
    title: p.title,
    postStatus: p.status,
    scheduledAt: p.schedule.scheduledAt,
    status: p.schedule.status,
    confirmed: p.schedule.confirmed,
    note: p.schedule.note,
  }));

  return { success: true, data: { count: scheduled.length, schedules: scheduled } };
}

/**
 * 查看单个排期状态
 */
function status(taskDir) {
  const s = state.load();
  const post = state.findPost(s, taskDir);
  if (!post) {
    return { success: false, error: { code: 'SCHEDULE_POST_NOT_FOUND', message: `帖子不存在: ${taskDir}` } };
  }
  if (!post.schedule) {
    return { success: false, error: { code: 'SCHEDULE_NOT_FOUND', message: `该帖子没有排期: ${taskDir}` } };
  }

  return {
    success: true,
    data: {
      id: post.id,
      title: post.title,
      postStatus: post.status,
      schedule: post.schedule,
    },
  };
}

/**
 * 取消排期
 */
function cancel(taskDir) {
  let s = state.load();
  const post = state.findPost(s, taskDir);
  if (!post) {
    return { success: false, error: { code: 'SCHEDULE_POST_NOT_FOUND', message: `帖子不存在: ${taskDir}` } };
  }
  if (!post.schedule) {
    return { success: false, error: { code: 'SCHEDULE_NOT_FOUND', message: `该帖子没有排期: ${taskDir}` } };
  }

  const previousStatus = post.schedule.status;
  post.schedule.status = 'SKIPPED';
  post.schedule.note = 'Cancelled manually';
  const warning = state.save(s);
  logger.info('SCHEDULE_CANCELLED', 'scheduler', `排期已取消: ${taskDir}`);

  const result = {
    success: true,
    data: {
      taskDir,
      previousStatus,
      status: 'SKIPPED',
      note: '排期已取消',
    },
  };
  if (warning) result.warning = warning;
  return result;
}

/**
 * 查询到期任务
 * 不修改 state，无副作用
 */
function due() {
  const s = state.load();
  const now = new Date();
  const dueList = s.posts.filter(p => {
    if (!p.schedule) return false;
    if (!p.schedule.confirmed) return false;
    if (p.schedule.status !== 'CONFIRMED') return false;
    if (p.status !== 'QA_PASSED') return false;
    const t = new Date(p.schedule.scheduledAt);
    return t <= now;
  }).map(p => ({
    id: p.id,
    scheduledAt: p.schedule.scheduledAt,
    postStatus: p.status,
    scheduleStatus: p.schedule.status,
  }));

  return { success: true, data: { count: dueList.length, due: dueList } };
}

// ─── 内部工具 ──────────────────────────────────────────

/**
 * 解析 "YYYY-MM-DD HH:mm" 格式时间
 * 返回 Date 对象，或 null（格式错误）
 */
function parseTime(str) {
  if (!str || typeof str !== 'string') return null;
  // 匹配 YYYY-MM-DD HH:mm
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute), 0, 0);

  // 验证日期有效
  if (isNaN(d.getTime())) return null;

  return d;
}

/**
 * 执行到期任务的 mock 发布
 *
 * @param {string} mockType - 'success' 或 'fail'
 * @returns {object} { success, data: { processed: [...], errors: [...] } }
 */
function runDue(mockType) {
  // 1. 获取到期任务
  const dueResult = due();
  const tasks = dueResult.data.due;

  if (tasks.length === 0) {
    return { success: true, data: { processed: [], errors: [], note: '没有到期任务' } };
  }

  const processed = [];
  const errors = [];
  let s = state.load();

  for (const task of tasks) {
    const taskDir = task.id;

    // 安全限制：mock 只能用于测试任务
    if (!taskDir.includes('测试') && !taskDir.includes('mock')) {
      errors.push({ taskDir, code: 'SCHEDULE_MOCK_TASK_REQUIRED', message: 'mock 模式只能用于名称包含"测试"或"mock"的任务目录' });
      continue;
    }

    const post = state.findPost(s, taskDir);
    if (!post || !post.schedule) {
      errors.push({ taskDir, code: 'SCHEDULE_NOT_FOUND', message: '帖子或排期不存在' });
      continue;
    }

    // 2. 标记 RUNNING
    post.schedule.status = 'RUNNING';
    post.schedule.triggeredAt = new Date().toISOString();
    state.save(s);

    if (mockType === 'success') {
      // 3a. mock 成功
      const fullPath = path.join(config.contentDir, taskDir);
      post.status = 'PUBLISHED';
      post.publish.status = 'PUBLISHED';
      post.publish.publishedAt = new Date().toISOString();
      post.publish.error = null;
      post.schedule.status = 'SUCCEEDED';
      post.schedule.completedAt = new Date().toISOString();
      s.schedule.lastPublishedAt = post.publish.publishedAt;
      state.save(s);

      // 移动文件夹
      const folderName = path.basename(fullPath);
      const targetDir = path.join(config.contentDir, '投稿内容', '已投递', folderName);
      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
      try { fs.renameSync(fullPath, targetDir); } catch (_) {
        logger.warn('MOCK_MOVE_FAILED', 'scheduler', `mock 成功但文件夹移动失败`, { taskDir, targetDir });
      }

      logger.info('SCHEDULE_MOCK_SUCCESS', 'scheduler', `排期 mock 发布成功: ${taskDir}`, { scheduleStatus: 'SUCCEEDED' });
      processed.push({ taskDir, result: 'SUCCEEDED' });

    } else if (mockType === 'fail') {
      // 3b. mock 失败
      post.status = 'PUBLISH_FAILED';
      post.publish.status = 'FAILED';
      post.publish.attempts = (post.publish.attempts || 0) + 1;
      post.publish.error = { code: 'MOCK_PUBLISH_FAILED', message: 'mock 模拟发布失败' };
      post.schedule.status = 'FAILED';
      post.schedule.completedAt = new Date().toISOString();
      state.save(s);

      logger.error('SCHEDULE_MOCK_FAILED', 'scheduler', `排期 mock 发布失败: ${taskDir}`, { attempts: post.publish.attempts });
      processed.push({ taskDir, result: 'FAILED' });
    }
  }

  return {
    success: true,
    data: {
      processed,
      errors: errors.length > 0 ? errors : undefined,
      note: errors.length > 0 ? '部分任务失败，详见 errors' : undefined,
    },
  };
}

/**
 * 受控 scheduled publish — 真实发布入口
 *
 * @param {string} taskDir - 帖子目录
 * @param {boolean} dryRun - 是否仅 dry-run
 * @returns {Promise<object>}
 */
async function runDueConfirm(taskDir, dryRun) {
  const dueResult = due();
  const dueTasks = dueResult.data.due;
  const dueIds = dueTasks.map(t => t.id);

  // 校验 task 是否在到期列表中
  if (!dueIds.includes(taskDir)) {
    return { success: false, error: { code: 'SCHEDULE_TASK_NOT_IN_DUE', message: `指定任务不在到期列表中: ${taskDir}` } };
  }

  let s = state.load();
  const post = state.findPost(s, taskDir);
  if (!post || !post.schedule) {
    return { success: false, error: { code: 'SCHEDULE_NOT_FOUND', message: '帖子或排期不存在' } };
  }

  // ─── 前置检查 ─────────────────────────────────────
  const now = new Date();
  const prechecks = [
    { name: 'schedule_confirmed', pass: post.schedule.confirmed === true },
    { name: 'schedule_status', pass: post.schedule.status === 'CONFIRMED' },
    { name: 'scheduled_at', pass: new Date(post.schedule.scheduledAt) <= now },
    { name: 'post_status', pass: post.status === 'QA_PASSED' },
    { name: 'qa_status', pass: post.qa.status === 'PASSED' },
    { name: 'publish_status', pass: post.publish.status === 'PENDING' },
    { name: 'publish_attempts', pass: post.publish.attempts < post.publish.maxRetries },
    { name: 'chrome_path', pass: !!config.chromePath },
    { name: 'cookie_path', pass: !!config.cookiePath },
    { name: 'cookie_file', pass: config.cookiePath ? fs.existsSync(config.cookiePath) : false },
  ];

  // 物理文件检查
  const fullPath = path.join(config.contentDir, taskDir);
  prechecks.push({ name: 'dir_exists', pass: fs.existsSync(fullPath) });
  if (fs.existsSync(fullPath)) {
    prechecks.push({ name: 'manifest_exists', pass: fs.existsSync(path.join(fullPath, 'manifest.json')) });
    const outputDir = path.join(fullPath, 'output');
    const hasPng = fs.existsSync(outputDir) && fs.readdirSync(outputDir).some(f => /\.png$/i.test(f));
    prechecks.push({ name: 'output_exists', pass: hasPng });
  } else {
    prechecks.push({ name: 'manifest_exists', pass: false });
    prechecks.push({ name: 'output_exists', pass: false });
  }

  const failedChecks = prechecks.filter(c => !c.pass);

  // ─── dry-run 模式 ─────────────────────────────────
  if (dryRun) {
    return {
      success: true,
      data: {
        mode: 'dry-run',
        taskDir,
        scheduledAt: post.schedule.scheduledAt,
        allPassed: failedChecks.length === 0,
        checks: prechecks,
        note: failedChecks.length === 0
          ? '[DRY-RUN] 前置条件通过。使用 --task (不加 --dry-run) 执行真实 scheduled publish'
          : '[DRY-RUN] 前置条件未全部满足',
      },
    };
  }

  // ─── 前置检查失败 → 不发布 ────────────────────────
  if (failedChecks.length > 0) {
    post.schedule.status = 'FAILED';
    post.schedule.completedAt = new Date().toISOString();
    post.schedule.note = `前置检查失败: ${failedChecks.map(c => c.name).join(', ')}`;
    state.save(s);
    logger.error('SCHEDULE_PRECHECK_FAILED', 'scheduler', `scheduled publish 前置检查失败: ${taskDir}`, { failedChecks: failedChecks.map(c => c.name) });
    return { success: false, error: { code: 'SCHEDULE_PRECHECK_FAILED', message: `前置检查未通过: ${failedChecks.map(c => c.name).join(', ')}`, detail: { checks: prechecks } } };
  }

  // ─── 设置 RUNNING ─────────────────────────────────
  post.schedule.status = 'RUNNING';
  post.schedule.triggeredAt = new Date().toISOString();
  state.save(s);

  // ─── 调用 publisher ───────────────────────────────
  const pubResult = await publisher.publish(taskDir);

  if (pubResult.success) {
    // 成功：更新 post + publish + schedule 三个层的状态
    s = state.load();
    const p = state.findPost(s, taskDir);
    if (p) {
      p.status = 'PUBLISHED';
      p.publish.status = 'PUBLISHED';
      p.publish.publishedAt = pubResult.data.publishedAt;
      p.publish.error = null;
      s.schedule.lastPublishedAt = pubResult.data.publishedAt;
      if (p.schedule) {
        p.schedule.status = 'SUCCEEDED';
        p.schedule.completedAt = new Date().toISOString();
      }
      state.save(s);
    }

    // 移动文件夹：待投递 → 已投递
    const fullFolderPath = path.join(config.contentDir, taskDir);
    const folderName = path.basename(fullFolderPath);
    const targetDir = path.join(config.contentDir, '投稿内容', '已投递', folderName);
    let moved = false;
    try {
      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
      fs.renameSync(fullFolderPath, targetDir);
      moved = true;
    } catch (moveErr) {
      logger.warn('PUBLISH_MOVE_FAILED', 'scheduler', `scheduled publish 成功但文件夹移动失败: ${moveErr.message}`, { source: taskDir, target: targetDir });
    }

    logger.info('SCHEDULE_PUBLISH_SUCCEEDED', 'scheduler', `scheduled publish 成功: ${taskDir}`, { publishedAt: pubResult.data.publishedAt, scheduleStatus: 'SUCCEEDED', moved });
    return { success: true, data: { taskDir, result: 'SUCCEEDED', publishedAt: pubResult.data.publishedAt, imageCount: pubResult.data.imageCount, moved } };
  } else {
    // 失败
    s = state.load();
    const p = state.findPost(s, taskDir);
    if (p) {
      p.status = 'PUBLISH_FAILED';
      p.publish.status = 'FAILED';
      p.publish.attempts = (p.publish.attempts || 0) + 1;
      p.publish.error = pubResult.error;
      if (p.schedule) {
        p.schedule.status = 'FAILED';
        p.schedule.completedAt = new Date().toISOString();
      }
      state.save(s);
    }
    logger.error('SCHEDULE_PUBLISH_FAILED', 'scheduler', `scheduled publish 失败: ${taskDir}`, { error: pubResult.error });
    return { success: false, error: { code: 'SCHEDULE_PUBLISH_FAILED', message: pubResult.error.message, detail: pubResult.error } };
  }
}

module.exports = { add, list, status, cancel, due, runDue, runDueConfirm };
