/**
 * xhs-content-system v0.5.1
 * topic-store 模块 — TopicCandidate 候选池管理
 *
 * 职责：topic add / list / show / shortlist / approve / reject / export
 * 不包含：热点采集、外部数据源、xhs-planner 调用、内容生成
 *
 * 所有函数直接返回 result 对象，不操作 pipeline 输出。
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const TOPICS_DIR = path.join(path.dirname(config.stateJsonPath), 'topics');
const TOPICS_FILE = path.join(TOPICS_DIR, 'candidates.json');
const EXPORT_DIR = path.join(TOPICS_DIR, 'exported');

const VALID_SOURCES = ['manual', 'seasonal', 'weibo', 'baidu', 'trend-pulse', 'xhs-search'];

// ─── 状态流转规则 ──────────────────────────────────────

const TRANSITIONS = {
  'CANDIDATE':   ['SHORTLISTED', 'REJECTED'],
  'SHORTLISTED': ['APPROVED', 'REJECTED'],
  'APPROVED':    ['EXPORTED'],
  'EXPORTED':    [],
  'REJECTED':    [],
};

function isValidTransition(from, to) {
  return TRANSITIONS[from] && TRANSITIONS[from].includes(to);
}

// ─── 内部工具 ──────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function dateStr() {
  return now().slice(0, 10).replace(/-/g, '');
}

function generateId(source, store) {
  const date = dateStr();
  const existing = store.candidates.filter(c => c.id.startsWith(`tc-${date}-${source}`));
  const seq = String(existing.length + 1).padStart(3, '0');
  return `tc-${date}-${source}-${seq}`;
}

function defaultScores() {
  return { trendScore: 0, fitScore: 0, overallScore: 0 };
}

// ─── 存储读写 ──────────────────────────────────────────

function ensureDir() {
  if (!fs.existsSync(TOPICS_DIR)) {
    fs.mkdirSync(TOPICS_DIR, { recursive: true });
  }
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }
}

function load() {
  ensureDir();
  if (!fs.existsSync(TOPICS_FILE)) {
    const initial = {
      version: 'v0.5.1',
      updatedAt: now(),
      candidates: [],
    };
    fs.writeFileSync(TOPICS_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(TOPICS_FILE, 'utf-8'));
  } catch (err) {
    return null;
  }
}

function save(store) {
  store.updatedAt = now();
  try {
    fs.writeFileSync(TOPICS_FILE, JSON.stringify(store, null, 2), 'utf-8');
    return null;
  } catch (err) {
    return { warning: true, code: 'TOPIC_STATE_WRITE_FAILED', message: `candidates.json 写入失败: ${err.message}` };
  }
}

function find(store, topicId) {
  return store.candidates.find(c => c.id === topicId) || null;
}

// ─── 公开 API ──────────────────────────────────────────

/**
 * 创建新 topic（CANDIDATE）
 *
 * @param {object} opts
 * @param {string} opts.title - 必填
 * @param {string} [opts.source='manual']
 * @param {string} [opts.rawSignal='']
 * @param {string} [opts.trendReason='']
 * @param {string} [opts.accountFitReason='']
 * @param {string} [opts.contentAngle='']
 * @param {object} [opts.scores]
 * @param {object} [opts.sourceMeta]
 * @returns {object} { success, data?, error? }
 */
function add(opts) {
  if (!opts.title || !opts.title.trim()) {
    return { success: false, error: { code: 'TOPIC_TITLE_REQUIRED', message: '标题不能为空' } };
  }

  const source = opts.source || 'manual';
  if (!VALID_SOURCES.includes(source)) {
    return { success: false, error: { code: 'TOPIC_INVALID_SOURCE', message: `无效来源: ${source}。有效值: ${VALID_SOURCES.join(', ')}` } };
  }

  const store = load();
  if (!store) {
    return { success: false, error: { code: 'TOPIC_STORE_INVALID', message: 'candidates.json 解析失败' } };
  }

  const candidate = {
    id: generateId(source, store),
    title: opts.title.trim(),
    source,
    sourceMeta: opts.sourceMeta || null,
    rawSignal: opts.rawSignal || '',
    trendReason: opts.trendReason || '',
    accountFitReason: opts.accountFitReason || '',
    contentAngle: opts.contentAngle || '',
    scores: opts.scores || defaultScores(),
    status: 'CANDIDATE',
    createdAt: now(),
    approvedAt: null,
    exportedAt: null,
    note: opts.note || null,
  };

  store.candidates.push(candidate);
  const warning = save(store);

  const result = { success: true, data: candidate };
  if (warning) result.warning = warning;
  return result;
}

/**
 * 列出 topic
 *
 * @param {object} [opts]
 * @param {string} [opts.status] - 按状态筛选
 * @param {boolean} [opts.hideRejected=true] - 是否隐藏 REJECTED
 * @param {boolean} [opts.hideExported=true] - 是否隐藏 EXPORTED
 * @returns {object} { success, data }
 */
function list(opts) {
  const store = load();
  if (!store) {
    return { success: false, error: { code: 'TOPIC_STORE_INVALID', message: 'candidates.json 解析失败' } };
  }

  let candidates = store.candidates;

  // 按状态筛选
  if (opts && opts.status) {
    candidates = candidates.filter(c => c.status === opts.status);
  }

  // 默认隐藏 REJECTED
  if (!opts || opts.hideRejected !== false) {
    candidates = candidates.filter(c => c.status !== 'REJECTED');
  }

  // 默认隐藏 EXPORTED
  if (!opts || opts.hideExported !== false) {
    candidates = candidates.filter(c => c.status !== 'EXPORTED');
  }

  // 按创建时间倒序
  candidates.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    success: true,
    data: {
      total: store.candidates.length,
      filtered: candidates.length,
      candidates,
    },
  };
}

/**
 * 查看单个 topic
 */
function show(topicId) {
  const store = load();
  if (!store) {
    return { success: false, error: { code: 'TOPIC_STORE_INVALID', message: 'candidates.json 解析失败' } };
  }

  const candidate = find(store, topicId);
  if (!candidate) {
    return { success: false, error: { code: 'TOPIC_NOT_FOUND', message: `Topic 不存在: ${topicId}` } };
  }

  return { success: true, data: candidate };
}

/**
 * 变更 topic 状态
 *
 * @param {string} topicId
 * @param {string} newStatus - 目标状态
 * @param {object} [extra] - 附加字段（如 note）
 * @returns {object}
 */
function transitionTo(topicId, newStatus, extra) {
  const store = load();
  if (!store) {
    return { success: false, error: { code: 'TOPIC_STORE_INVALID', message: 'candidates.json 解析失败' } };
  }

  const candidate = find(store, topicId);
  if (!candidate) {
    return { success: false, error: { code: 'TOPIC_NOT_FOUND', message: `Topic 不存在: ${topicId}` } };
  }

  if (!isValidTransition(candidate.status, newStatus)) {
    return {
      success: false,
      error: {
        code: 'TOPIC_INVALID_STATUS',
        message: `不允许的状态流转: ${candidate.status} → ${newStatus}`,
        detail: { current: candidate.status, requested: newStatus, allowedTransitions: TRANSITIONS[candidate.status] },
      },
    };
  }

  candidate.status = newStatus;
  candidate.updatedAt = now();

  if (newStatus === 'APPROVED') {
    candidate.approvedAt = now();
  }
  if (newStatus === 'EXPORTED') {
    candidate.exportedAt = now();
  }
  if (extra && extra.note) {
    candidate.note = extra.note;
  }

  const warning = save(store);
  const result = { success: true, data: candidate };
  if (warning) result.warning = warning;
  return result;
}

/**
 * 快捷操作
 */
function shortlist(topicId) {
  return transitionTo(topicId, 'SHORTLISTED');
}

function approve(topicId) {
  return transitionTo(topicId, 'APPROVED');
}

function reject(topicId, reason) {
  return transitionTo(topicId, 'REJECTED', { note: reason || 'Rejected without reason' });
}

/**
 * 导出 topic
 *
 * APPROVED → EXPORTED
 * 写入 topics/exported/<topicId>.json
 * 不生成帖子，不调用 xhs-planner
 */
function exportTopic(topicId) {
  const store = load();
  if (!store) {
    return { success: false, error: { code: 'TOPIC_STORE_INVALID', message: 'candidates.json 解析失败' } };
  }

  const candidate = find(store, topicId);
  if (!candidate) {
    return { success: false, error: { code: 'TOPIC_NOT_FOUND', message: `Topic 不存在: ${topicId}` } };
  }

  if (candidate.status === 'EXPORTED') {
    return { success: false, error: { code: 'TOPIC_ALREADY_EXPORTED', message: `Topic 已导出: ${topicId} at ${candidate.exportedAt}` } };
  }

  if (candidate.status !== 'APPROVED') {
    return {
      success: false,
      error: {
        code: 'TOPIC_EXPORT_NOT_APPROVED',
        message: `只有 APPROVED 的 topic 可以导出，当前状态: ${candidate.status}`,
      },
    };
  }

  // 流转为 EXPORTED
  const transitionResult = transitionTo(topicId, 'EXPORTED');
  if (!transitionResult.success) return transitionResult;

  const exported = transitionResult.data;

  // 写入导出文件
  ensureDir();
  const exportFile = path.join(EXPORT_DIR, `${topicId}.json`);
  const exportObj = {
    exportedAt: now(),
    topic: exported,
    note: '已导出选题，可供 xhs-planner 参考。不自动触发内容生成。',
  };

  try {
    fs.writeFileSync(exportFile, JSON.stringify(exportObj, null, 2), 'utf-8');
  } catch (err) {
    return { success: false, error: { code: 'TOPIC_EXPORT_FAILED', message: `导出文件写入失败: ${err.message}` } };
  }

  return {
    success: true,
    data: {
      topic: exported,
      exportPath: exportFile,
      note: '选题已导出，可复制给 xhs-planner 做完整策划',
    },
  };
}

module.exports = { add, list, show, shortlist, approve, reject, exportTopic };
