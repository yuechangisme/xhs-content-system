/**
 * xhs-content-system v0.1
 * state 管理：读取 / 初始化 / 查找 / 更新
 */

const fs = require('fs');
const config = require('../config');

const STATE_VERSION = 'v0.1';

/**
 * 读取 state.json，不存在时初始化默认结构
 */
function load() {
  if (!fs.existsSync(config.stateJsonPath)) {
    const initial = {
      version: STATE_VERSION,
      updatedAt: now(),
      posts: [],
      schedule: {
        lastPublishedAt: null,
        nextRecommendedAt: null,
      },
    };
    fs.writeFileSync(config.stateJsonPath, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(config.stateJsonPath, 'utf-8'));
  } catch (err) {
    throw Object.assign(new Error('state.json 格式错误'), { code: 'STATE_INVALID' });
  }
}

/**
 * 写入 state.json
 * 写入失败时不阻断主流程，返回 warning
 */
function save(state) {
  state.updatedAt = now();
  try {
    fs.writeFileSync(config.stateJsonPath, JSON.stringify(state, null, 2), 'utf-8');
    return null; // no warning
  } catch (err) {
    return {
      warning: true,
      code: 'STATE_WRITE_FAILED',
      message: 'state.json 写入失败，请手动同步',
      detail: { path: config.stateJsonPath, error: err.message },
    };
  }
}

/**
 * 按 postId 查找帖子，不存在返回 null
 */
function findPost(state, postId) {
  return state.posts.find(p => p.id === postId) || null;
}

/**
 * 查找或创建 post 记录
 */
function findOrCreatePost(state, postId, title) {
  let post = findPost(state, postId);
  if (post) return post;

  post = {
    id: postId,
    title: title || postId,
    status: 'CREATED',
    taskDir: null,
    createdAt: now(),
    updatedAt: now(),
    qa: { status: 'PENDING', checkedAt: null, checks: [], error: null },
    publish: { status: 'PENDING', attempts: 0, maxRetries: config.publish.maxRetries, lastAttemptAt: null, publishedAt: null, error: null },
    schedule: { recommendedDate: null, recommendedTime: null },
  };
  state.posts.push(post);
  return post;
}

/**
 * 更新 post 状态
 */
function updatePostStatus(state, postId, status) {
  const post = findPost(state, postId);
  if (!post) return;
  post.status = status;
  post.updatedAt = now();
}

/**
 * 更新 post.qa 字段
 */
function updateQaResult(state, postId, qaData) {
  const post = findPost(state, postId);
  if (!post) return;
  post.qa = { ...post.qa, ...qaData, checkedAt: now() };
  post.updatedAt = now();
}

/**
 * 更新 post.publish 字段
 */
function updatePublishResult(state, postId, publishData) {
  const post = findPost(state, postId);
  if (!post) return;
  post.publish = { ...post.publish, ...publishData, lastAttemptAt: now() };
  post.updatedAt = now();
}

function now() {
  return new Date().toISOString();
}

module.exports = {
  load,
  save,
  findPost,
  findOrCreatePost,
  updatePostStatus,
  updateQaResult,
  updatePublishResult,
};
