/**
 * xhs-content-system v0.5.2
 * seasonal-generator 模块 — 季节/节气选题生成器
 *
 * 职责：读取 seasonal-calendar.json，按条件查询节点，生成 dry-run TopicCandidate 预览
 * 不包含：写入 candidates.json、调用 topic-store、生成帖子
 *
 * 所有函数直接返回 result 对象。
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

const CALENDAR_PATH = path.join(__dirname, '..', 'seasonal-calendar.json');

const TYPE_LABELS = {
  solar_term: '节气',
  festival: '节日',
  seasonal_scene: '场景',
};

const SEASON_LABELS = {
  spring: '春季',
  summer: '夏季',
  autumn: '秋季',
  winter: '冬季',
};

// ─── 内部工具 ──────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

function loadCalendar() {
  if (!fs.existsSync(CALENDAR_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf-8'));
  } catch (err) {
    return null;
  }
}

/**
 * 解析节点的年份日期
 * 优先 yearlyDates[year]，回退 defaultDate
 */
function resolveDate(node, year) {
  const y = year || new Date().getFullYear();
  if (node.yearlyDates && node.yearlyDates[String(y)]) {
    return `${y}-${node.yearlyDates[String(y)]}`;
  }
  return `${y}-${node.defaultDate}`;
}

/**
 * 计算距离节点的天数（基于 resolvedDate）
 */
function daysUntil(node) {
  const dateStr = resolveDate(node);
  const nodeDate = new Date(dateStr);
  const today = new Date();
  // 重置时间部分
  nodeDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const diff = Math.ceil((nodeDate - today) / (1000 * 60 * 60 * 24));
  return diff;
}

/**
 * 计算 trendScore（时效性，0-100）
 */
function calcTrendScore(node) {
  const diff = daysUntil(node);
  const absDiff = Math.abs(diff);
  const isPast = diff < 0;

  // 节点类型权重
  let base = 0;
  if (isPast) {
    // 已过期的节点
    if (absDiff <= 3) base = 70;    // 刚过期还有余热
    else if (absDiff <= 7) base = 50;
    else base = 20;
  } else {
    // 未来节点
    if (absDiff <= 7) base = 90;         // 一周内 — 最佳
    else if (absDiff <= 14) base = 70;   // 两周内 — 准备期
    else if (absDiff <= 21) base = 55;   // 三周内
    else if (absDiff <= 30) base = 40;   // 一月内 — 可储备
    else base = 15;                       // 超过一月
  }

  // 节点类型权重调整
  const typeWeight = node.type === 'seasonal_scene' ? 1.2
    : node.type === 'solar_term' ? 1.0
    : 0.8;

  return Math.min(100, Math.round(base * typeWeight));
}

/**
 * 计算 fitScore（账号匹配度，0-100）
 * 基于 accountProfile 中的 topics 和 avoidTopics
 */
function calcFitScore(node, accountProfile) {
  if (!accountProfile || !accountProfile.topics || accountProfile.topics.length === 0) {
    // 无 profile 时返回默认中等匹配
    const defaultScores = {
      solar_term: 70,
      festival: 50,
      seasonal_scene: 75,
    };
    return defaultScores[node.type] || 60;
  }

  const topics = accountProfile.topics.map(t => t.toLowerCase());
  const avoids = (accountProfile.avoidTopics || []).map(t => t.toLowerCase());

  // 检查是否有 avoidTopics 中的关键词
  const nodeText = `${node.name} ${node.userNeeds} ${node.topicHints.join(' ')}`.toLowerCase();
  for (const avoid of avoids) {
    if (nodeText.includes(avoid)) return 20;
  }

  // 计算 topic 匹配数
  let matchCount = 0;
  for (const topic of topics) {
    if (nodeText.includes(topic)) matchCount++;
  }

  const matchRatio = matchCount / topics.length;

  if (matchRatio >= 0.5) return 90;
  if (matchRatio >= 0.3) return 75;
  if (matchRatio >= 0.1) return 60;

  // 没有直接匹配，按类型给默认
  const defaultScores = {
    solar_term: 65,
    festival: 45,
    seasonal_scene: 70,
  };
  return defaultScores[node.type] || 55;
}

/**
 * 读取 accountProfile，尝试从 config.local 中获取
 */
function loadAccountProfile() {
  try {
    const localConfig = require('../config.local');
    if (localConfig.accountProfile) return localConfig.accountProfile;
  } catch (_) {
    // config.local.js 不存在
  }
  return null;
}

/**
 * 生成 accountFitReason
 */
function generateFitReason(accountProfile, contentAngle) {
  if (!accountProfile || !accountProfile.accountFitTemplates || accountProfile.accountFitTemplates.length === 0) {
    return `适合当前账号定位的内容方向：${contentAngle}`;
  }

  const templates = accountProfile.accountFitTemplates;
  const idx = Math.floor(Math.random() * templates.length);
  let reason = templates[idx]
    .replace('{simple_action}', contentAngle || '该话题')
    .replace('{audience}', accountProfile.audience || '目标用户')
    .replace('{niche}', accountProfile.niche || '养生健康');

  return reason;
}

// ─── 公开 API ──────────────────────────────────────────

/**
 * 按条件查询节点
 *
 * @param {object} filters
 * @param {number} [filters.month] - 月份（1-12）
 * @param {string} [filters.season] - 季节
 * @param {string} [filters.type] - 节点类型
 * @param {string} [filters.term] - 节点名称关键词
 * @returns {object} { success, data: { nodes, filters } }
 */
function listNodes(filters) {
  const calendar = loadCalendar();
  if (!calendar) {
    return { success: false, error: { code: 'SEASONAL_CALENDAR_INVALID', message: 'seasonal-calendar.json 解析失败' } };
  }

  let nodes = calendar.nodes;

  if (filters) {
    if (filters.month) {
      const month = String(filters.month).padStart(2, '0');
      nodes = nodes.filter(n => {
        // 检查 defaultDate 和 yearlyDates 是否匹配月份
        if (n.defaultDate && n.defaultDate.startsWith(month)) return true;
        if (n.yearlyDates) {
          for (const date of Object.values(n.yearlyDates)) {
            if (date.startsWith(month)) return true;
          }
        }
        return false;
      });
    }
    if (filters.season) {
      nodes = nodes.filter(n => n.season === filters.season);
    }
    if (filters.type) {
      nodes = nodes.filter(n => n.type === filters.type);
    }
    if (filters.term) {
      nodes = nodes.filter(n => n.name.includes(filters.term) || n.id.includes(filters.term));
    }
  }

  // 为每个节点补充解析后的信息
  const enriched = nodes.map(n => {
    const resolved = resolveDate(n);
    const diff = daysUntil(n);
    const seasonLabel = SEASON_LABELS[n.season] || n.season;
    const typeLabel = TYPE_LABELS[n.type] || n.type;
    return {
      id: n.id,
      name: n.name,
      type: n.type,
      typeLabel,
      season: n.season,
      seasonLabel,
      date: resolved,
      daysUntil: diff,
      topicCount: n.topicHints.length,
    };
  });

  return {
    success: true,
    data: {
      total: calendar.nodes.length,
      filtered: enriched.length,
      filters: filters || {},
      nodes: enriched,
    },
  };
}

/**
 * 生成 dry-run TopicCandidate 预览
 *
 * @param {object} opts
 * @param {string} [opts.term] - 节点名称
 * @param {number} [opts.month] - 月份
 * @param {string} [opts.range] - 日期范围 "YYYY-MM-DD:YYYY-MM-DD"
 * @param {boolean} [opts.all] - 全部未过期节点
 * @param {boolean} [opts.dryRun] - dry-run 模式
 * @returns {object}
 */
function generatePreview(opts) {
  const calendar = loadCalendar();
  if (!calendar) {
    return { success: false, error: { code: 'SEASONAL_CALENDAR_INVALID', message: 'seasonal-calendar.json 解析失败' } };
  }

  // 确认模式检查
  if (!opts || !opts.dryRun) {
    return {
      success: false,
      error: {
        code: 'TOPIC_GENERATE_CONFIRM_REQUIRED',
        message: 'seasonal generate 需要指定操作模式：--dry-run（预览）或 --confirm-generate（写入候选池）',
      },
    };
  }

  // 收集符合条件的节点
  let nodes = calendar.nodes;
  let matchedCount = 0;

  if (opts.term) {
    nodes = nodes.filter(n => n.name.includes(opts.term) || n.id.includes(opts.term));
  } else if (opts.month) {
    const month = String(opts.month).padStart(2, '0');
    nodes = nodes.filter(n => {
      if (n.defaultDate && n.defaultDate.startsWith(month)) return true;
      if (n.yearlyDates) {
        for (const date of Object.values(n.yearlyDates)) {
          if (date.startsWith(month)) return true;
        }
      }
      return false;
    });
  } else if (opts.range) {
    const parts = opts.range.split(':');
    if (parts.length !== 2) {
      return { success: false, error: { code: 'SEASONAL_DATE_INVALID', message: 'range 格式应为 YYYY-MM-DD:YYYY-MM-DD' } };
    }
    const start = new Date(parts[0]);
    const end = new Date(parts[1]);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { success: false, error: { code: 'SEASONAL_DATE_INVALID', message: 'range 日期格式无效' } };
    }
    nodes = nodes.filter(n => {
      const d = new Date(resolveDate(n));
      return d >= start && d <= end;
    });
  } else if (opts.all) {
    // 全部未过期节点（未来 60 天内的 + 刚过期 3 天内的）
    nodes = nodes.filter(n => {
      const diff = daysUntil(n);
      return diff >= -3 && diff <= 60;
    });
  } else {
    return { success: false, error: { code: 'SEASONAL_DATE_INVALID', message: '请指定 --term, --month, --range 或 --all' } };
  }

  if (nodes.length === 0) {
    return { success: true, data: { mode: 'dry-run', candidates: [], note: '没有符合条件的节点' } };
  }

  // 读取 accountProfile（不阻断）
  const accountProfile = loadAccountProfile();
  const warnings = [];
  if (!accountProfile) {
    warnings.push({ code: 'SEASONAL_ACCOUNT_PROFILE_MISSING', message: 'config.local.js 中未配置 accountProfile，使用通用模板生成 accountFitReason' });
  }

  // 限制生成数量
  const MAX_CANDIDATES = opts.all ? 30 : 99;
  let totalGenerated = 0;

  const candidates = [];
  for (const node of nodes) {
    if (totalGenerated >= MAX_CANDIDATES) break;

    // 每个节点最多 3 条
    const hints = node.topicHints || [];
    const maxHints = Math.min(hints.length, 3);

    for (let i = 0; i < maxHints; i++) {
      if (totalGenerated >= MAX_CANDIDATES) break;

      const contentAngle = hints[i];
      const dateStr = resolveDate(node);
      const trendScore = calcTrendScore(node);
      const fitScore = calcFitScore(node, accountProfile);
      const overallScore = Math.round(trendScore * 0.4 + fitScore * 0.6);

      const candidate = {
        title: contentAngle,
        source: 'seasonal',
        sourceMeta: {
          seasonalId: node.id,
          name: node.name,
          type: node.type,
          date: dateStr,
        },
        rawSignal: `${TYPE_LABELS[node.type] || node.type}：${node.name}（${dateStr}）→ ${node.userNeeds.substring(0, 30)}…`,
        trendReason: `${node.name}前后养生类话题季节性关注上升。`,
        accountFitReason: generateFitReason(accountProfile, contentAngle),
        contentAngle,
        scores: {
          trendScore,
          fitScore,
          overallScore,
        },
        status: 'CANDIDATE',
        createdAt: now(),
        note: `由 seasonal generator 基于 ${node.name} 生成（dry-run 预览）`,
      };

      candidates.push(candidate);
      totalGenerated++;
    }
  }

  const result = {
    success: true,
    data: {
      mode: 'dry-run',
      matchedNodes: nodes.length,
      generated: candidates.length,
      note: candidates.length > 0
        ? `[DRY-RUN] 预览 ${candidates.length} 条候选选题。使用 --confirm-generate 写入候选池`
        : '没有符合条件的节点',
      candidates,
    },
  };

  if (warnings.length > 0) {
    result.warnings = warnings;
  }

  return result;
}

module.exports = { listNodes, generatePreview };
