/**
 * xhs-content-system v0.5.4
 * analytics 模块 — 发布后数据手动录入与分析
 *
 * 职责：analytics add / list / summary
 * 不包含：小红书后台自动抓取、cookie/session 读取、TopicCandidate 生成
 *
 * 所有函数直接返回 result 对象，不操作 state / topics / content。
 */

const fs = require('fs');
const path = require('path');

const ANALYTICS_DIR = path.join(__dirname, '..', 'analytics');
const METRICS_FILE = path.join(ANALYTICS_DIR, 'post-metrics.json');

// ─── 内部工具 ──────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function ensureDir() {
  if (!fs.existsSync(ANALYTICS_DIR)) {
    fs.mkdirSync(ANALYTICS_DIR, { recursive: true });
  }
}

function load() {
  ensureDir();
  if (!fs.existsSync(METRICS_FILE)) {
    return { version: 'v0.5.4', updatedAt: now(), records: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(METRICS_FILE, 'utf-8'));
  } catch (err) {
    return null;
  }
}

function save(store) {
  store.updatedAt = now();
  try {
    fs.writeFileSync(METRICS_FILE, JSON.stringify(store, null, 2), 'utf-8');
    return null;
  } catch (err) {
    return { warning: true, code: 'ANALYTICS_WRITE_FAILED', message: `post-metrics.json 写入失败: ${err.message}` };
  }
}

function calcRate(numerator, denominator) {
  if (!denominator || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100000) / 100000;
}

// ─── 公开 API ──────────────────────────────────────────

/**
 * 手动录入帖子指标
 *
 * @param {object} opts
 * @param {string} opts.taskDir - 必填
 * @param {string} opts.title - 必填
 * @param {number} [opts.views=0]
 * @param {number} [opts.likes=0]
 * @param {number} [opts.favorites=0]
 * @param {number} [opts.comments=0]
 * @param {number} [opts.shares=0]
 * @param {number} [opts.followersGained=0]
 * @param {string} [opts.publishedAt]
 * @param {string} [opts.topicSource]
 * @param {string} [opts.topicTitle]
 * @param {string} [opts.notes]
 * @returns {object} { success, data?, error? }
 */
function add(opts) {
  if (!opts.taskDir || !opts.taskDir.trim()) {
    return { success: false, error: { code: 'ANALYTICS_TASKDIR_REQUIRED', message: 'taskDir 不能为空' } };
  }
  if (!opts.title || !opts.title.trim()) {
    return { success: false, error: { code: 'ANALYTICS_TITLE_REQUIRED', message: 'title 不能为空' } };
  }

  // 数值校验
  const numericFields = ['views', 'likes', 'favorites', 'comments', 'shares', 'followersGained'];
  const metrics = {};
  for (const field of numericFields) {
    const val = opts[field];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'number' || val < 0 || !Number.isFinite(val)) {
        return {
          success: false,
          error: {
            code: 'ANALYTICS_METRIC_INVALID',
            message: `${field} 必须为非负数字，收到: ${val}`,
          },
        };
      }
      metrics[field] = val;
    } else {
      metrics[field] = 0;
    }
  }

  const store = load();
  if (!store) {
    return { success: false, error: { code: 'ANALYTICS_STORE_INVALID', message: 'post-metrics.json 解析失败' } };
  }

  const views = metrics.views;

  const record = {
    postId: opts.postId || opts.taskDir,
    taskDir: opts.taskDir.trim(),
    title: opts.title.trim(),
    publishedAt: opts.publishedAt || null,
    topicSource: opts.topicSource || null,
    topicTitle: opts.topicTitle || null,
    recordedAt: now(),
    metrics: {
      views,
      likes: metrics.likes,
      favorites: metrics.favorites,
      comments: metrics.comments,
      shares: metrics.shares,
      followersGained: metrics.followersGained,
    },
    engagement: {
      likeRate: calcRate(metrics.likes, views),
      favRate: calcRate(metrics.favorites, views),
      commentRate: calcRate(metrics.comments, views),
    },
    commentSignals: opts.commentSignals || null,
    notes: opts.notes || null,
  };

  store.records.push(record);
  const warning = save(store);

  const result = { success: true, data: record };
  if (warning) result.warning = warning;
  return result;
}

/**
 * 查看所有记录
 *
 * @returns {object} { success, data: { total, records } }
 */
function list() {
  const store = load();
  if (!store) {
    return { success: false, error: { code: 'ANALYTICS_STORE_INVALID', message: 'post-metrics.json 解析失败' } };
  }

  const records = [...store.records].sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));

  return {
    success: true,
    data: {
      total: records.length,
      records,
    },
  };
}

/**
 * 简单统计汇总
 *
 * @returns {object} { success, data }
 */
function summary() {
  const store = load();
  if (!store) {
    return { success: false, error: { code: 'ANALYTICS_STORE_INVALID', message: 'post-metrics.json 解析失败' } };
  }

  if (store.records.length === 0) {
    return { success: true, data: { totalRecords: 0, note: '暂无数据，请先使用 analytics add 录入' } };
  }

  const records = store.records;

  // 汇总
  const totals = { views: 0, likes: 0, favorites: 0, comments: 0, shares: 0, followersGained: 0 };
  for (const r of records) {
    totals.views += r.metrics.views || 0;
    totals.likes += r.metrics.likes || 0;
    totals.favorites += r.metrics.favorites || 0;
    totals.comments += r.metrics.comments || 0;
    totals.shares += r.metrics.shares || 0;
    totals.followersGained += r.metrics.followersGained || 0;
  }

  // 平均值
  const count = records.length;
  const avgLikeRate = records.reduce((s, r) => s + (r.engagement ? r.engagement.likeRate : 0), 0) / count;
  const avgFavRate = records.reduce((s, r) => s + (r.engagement ? r.engagement.favRate : 0), 0) / count;
  const avgCommentRate = records.reduce((s, r) => s + (r.engagement ? r.engagement.commentRate : 0), 0) / count;

  // Top 3
  const byFavRate = [...records].sort((a, b) => (b.engagement ? b.engagement.favRate : 0) - (a.engagement ? a.engagement.favRate : 0));
  const byCommentRate = [...records].sort((a, b) => (b.engagement ? b.engagement.commentRate : 0) - (a.engagement ? a.engagement.commentRate : 0));
  const byLikes = [...records].sort((a, b) => (b.metrics.likes || 0) - (a.metrics.likes || 0));

  return {
    success: true,
    data: {
      totalRecords: count,
      totals,
      averages: {
        likeRate: Math.round(avgLikeRate * 100000) / 100000,
        favRate: Math.round(avgFavRate * 100000) / 100000,
        commentRate: Math.round(avgCommentRate * 100000) / 100000,
      },
      topByFavRate: byFavRate.slice(0, 3).map(r => ({
        taskDir: r.taskDir,
        title: r.title,
        favRate: r.engagement ? r.engagement.favRate : 0,
      })),
      topByCommentRate: byCommentRate.slice(0, 3).map(r => ({
        taskDir: r.taskDir,
        title: r.title,
        commentRate: r.engagement ? r.engagement.commentRate : 0,
      })),
      topByLikes: byLikes.slice(0, 3).map(r => ({
        taskDir: r.taskDir,
        title: r.title,
        likes: r.metrics.likes || 0,
      })),
    },
  };
}

module.exports = { add, list, summary };
