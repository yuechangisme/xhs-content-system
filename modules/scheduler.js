/**
 * xhs-content-system v0.3.0
 * scheduler 模块 — 排期队列管理
 *
 * 职责：schedule add / list / status / cancel / due
 * 不包含：自动发布、node-schedule、常驻进程
 *
 * 所有函数直接返回 result 对象，不操作 pipeline 输出。
 */

const state = require('./state');
const logger = require('./logger');

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

module.exports = { add, list, status, cancel, due };
