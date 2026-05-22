/**
 * Promote and archive reconciliation helpers.
 *
 * These commands manage physical post folders around the publish boundary.
 * They never publish and never schedule.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const state = require('./state');
const logger = require('./logger');

const WAITING_PRODUCTION = '投稿内容/待制作/';
const WAITING_PUBLISH = '投稿内容/待投递/';
const ARCHIVED = '投稿内容/已投递/';

function promote(taskDir, confirmed) {
  const sourceCheck = requirePrefix(taskDir, WAITING_PRODUCTION, 'PROMOTE_SOURCE_INVALID');
  const folderName = path.basename(normalizeTaskDir(taskDir));
  const targetTaskDir = `${WAITING_PUBLISH}${folderName}`;
  const audit = auditForMove(taskDir, targetTaskDir);

  let s = null;
  let post = null;
  try {
    s = state.load();
    post = state.findPost(s, taskDir);
  } catch (err) {
    return fail('STATE_INVALID', 'state.json 格式错误', { error: err.message, audit });
  }

  const stateChecks = [
    { name: 'state_post_exists', pass: !!post },
    { name: 'post_status_qa_passed', pass: !!post && post.status === 'QA_PASSED' },
    { name: 'publish_status_pending', pass: !!post && post.publish?.status === 'PENDING' },
  ];
  const checks = [...audit.checks, ...stateChecks];

  if (!sourceCheck.pass) return fail(sourceCheck.code, sourceCheck.message, { taskDir, checks });
  if (!post) return fail('PROMOTE_QA_NOT_PASSED', 'state 中不存在该帖子，不能 promote', { taskDir, checks });
  if (post.status !== 'QA_PASSED') return fail('PROMOTE_QA_NOT_PASSED', `QA 未通过，不能 promote (status: ${post.status})`, { taskDir, checks });
  if (post.publish?.status !== 'PENDING') return fail('PROMOTE_PUBLISH_NOT_PENDING', `publish.status 不是 PENDING，不能 promote (status: ${post.publish?.status})`, { taskDir, checks });
  if (!audit.ready) return fail(audit.firstErrorCode, audit.firstErrorMessage, { taskDir, targetTaskDir, checks });

  if (!confirmed) {
    return fail('PROMOTE_CONFIRM_REQUIRED', '确认 promote 需要 --confirm-promote', {
      mode: 'dry-run',
      taskDir,
      targetTaskDir,
      checks,
      note: '[DRY-RUN] 前置条件通过。添加 --confirm-promote 后会移动到待投递并更新 state id',
    });
  }

  try {
    fs.mkdirSync(path.dirname(audit.targetPath), { recursive: true });
    fs.renameSync(audit.sourcePath, audit.targetPath);
  } catch (err) {
    return fail('PROMOTE_MOVE_FAILED', `移动到待投递失败: ${err.message}`, { taskDir, targetTaskDir, checks });
  }

  post.id = targetTaskDir;
  post.title = targetTaskDir;
  post.updatedAt = new Date().toISOString();
  const warning = state.save(s);
  logger.info('PROMOTE_SUCCEEDED', 'promote', `已进入待投递: ${targetTaskDir}`, { source: taskDir, target: targetTaskDir });

  return {
    success: true,
    data: {
      mode: 'confirm',
      taskDir,
      targetTaskDir,
      checks,
      note: '已移动到待投递，可执行 publish dry-run',
    },
    warning,
  };
}

function reconcileMove(taskDir, confirmed) {
  const sourceCheck = requirePrefix(taskDir, WAITING_PUBLISH, 'RECONCILE_SOURCE_INVALID');
  const folderName = path.basename(normalizeTaskDir(taskDir));
  const targetTaskDir = `${ARCHIVED}${folderName}`;
  const audit = auditForMove(taskDir, targetTaskDir);

  let s = null;
  let post = null;
  try {
    s = state.load();
    post = state.findPost(s, taskDir);
  } catch (err) {
    return fail('STATE_INVALID', 'state.json 格式错误', { error: err.message, audit });
  }

  const stateChecks = [
    { name: 'state_post_exists', pass: !!post },
    { name: 'post_status_published', pass: !!post && post.status === 'PUBLISHED' },
    { name: 'publish_status_published', pass: !!post && post.publish?.status === 'PUBLISHED' },
    { name: 'published_at_exists', pass: !!post?.publish?.publishedAt },
  ];
  const checks = [...audit.checks, ...stateChecks];

  if (!sourceCheck.pass) return fail(sourceCheck.code, sourceCheck.message, { taskDir, checks });
  if (!post || post.status !== 'PUBLISHED' || post.publish?.status !== 'PUBLISHED' || !post.publish?.publishedAt) {
    return fail('RECONCILE_NOT_PUBLISHED', '只允许已发布成功的帖子执行归档 reconciliation', { taskDir, checks });
  }
  if (!audit.ready) return fail(audit.firstErrorCode, audit.firstErrorMessage, { taskDir, targetTaskDir, checks });

  if (!confirmed) {
    return fail('RECONCILE_CONFIRM_REQUIRED', '确认 reconciliation 需要 --confirm-reconcile', {
      mode: 'dry-run',
      taskDir,
      targetTaskDir,
      checks,
      note: '[DRY-RUN] 前置条件通过。添加 --confirm-reconcile 后只移动归档目录，不重新发布',
    });
  }

  try {
    fs.mkdirSync(path.dirname(audit.targetPath), { recursive: true });
    fs.renameSync(audit.sourcePath, audit.targetPath);
  } catch (err) {
    return fail('RECONCILE_MOVE_FAILED', `移动到已投递失败: ${err.message}`, { taskDir, targetTaskDir, checks });
  }

  logger.info('PUBLISH_MOVE_RECONCILED', 'publisher', `发布后归档移动已修复: ${taskDir}`, { source: taskDir, target: targetTaskDir });
  return {
    success: true,
    data: {
      mode: 'confirm',
      taskDir,
      targetTaskDir,
      checks,
      note: '本地归档已移动到已投递；未重新发布，未修改 publishedAt',
    },
  };
}

function auditForMove(sourceTaskDir, targetTaskDir) {
  const sourcePath = path.join(config.contentDir, sourceTaskDir);
  const targetPath = path.join(config.contentDir, targetTaskDir);
  const outputDir = path.join(sourcePath, 'output');
  const checks = [
    { name: 'source_exists', pass: fs.existsSync(sourcePath) },
    { name: 'target_absent', pass: !fs.existsSync(targetPath) },
  ];

  if (fs.existsSync(sourcePath)) {
    checks.push({ name: 'html_exists', pass: fs.readdirSync(sourcePath).some(f => /\.html$/i.test(f)) });
    checks.push({ name: 'manifest_exists', pass: fs.existsSync(path.join(sourcePath, 'manifest.json')) });
    checks.push({ name: 'md_exists', pass: fs.readdirSync(sourcePath).some(f => /\.md$/i.test(f)) });
    checks.push({ name: 'drafts_exists', pass: fs.existsSync(path.join(sourcePath, 'drafts')) });
    checks.push({ name: 'output_exists', pass: fs.existsSync(outputDir) });
    const pngCount = fs.existsSync(outputDir) ? fs.readdirSync(outputDir).filter(f => /\.png$/i.test(f)).length : 0;
    checks.push({ name: 'png_exists', pass: pngCount > 0, detail: { pngCount } });
  } else {
    checks.push({ name: 'html_exists', pass: false });
    checks.push({ name: 'manifest_exists', pass: false });
    checks.push({ name: 'md_exists', pass: false });
    checks.push({ name: 'drafts_exists', pass: false });
    checks.push({ name: 'output_exists', pass: false });
    checks.push({ name: 'png_exists', pass: false, detail: { pngCount: 0 } });
  }

  const failed = checks.find(c => !c.pass);
  const firstErrorCode = failed?.name === 'target_absent' ? (targetTaskDir.startsWith(WAITING_PUBLISH) ? 'PROMOTE_TARGET_EXISTS' : 'RECONCILE_TARGET_EXISTS')
    : (targetTaskDir.startsWith(WAITING_PUBLISH) ? 'PROMOTE_SOURCE_INVALID' : 'RECONCILE_CONTENT_INCOMPLETE');
  const firstErrorMessage = failed?.name === 'target_absent' ? `目标目录已存在: ${targetTaskDir}` : '源目录不存在或内容不完整';

  return {
    ready: checks.every(c => c.pass),
    checks,
    sourcePath,
    targetPath,
    firstErrorCode,
    firstErrorMessage,
  };
}

function isWaitingPublishTask(taskDir) {
  return normalizeTaskDir(taskDir).startsWith(WAITING_PUBLISH);
}

function normalizeTaskDir(taskDir) {
  return String(taskDir || '').replace(/\\/g, '/');
}

function requirePrefix(taskDir, prefix, code) {
  const normalized = normalizeTaskDir(taskDir);
  const pass = normalized.startsWith(prefix) && path.basename(normalized) !== '';
  return {
    pass,
    code,
    message: code.startsWith('PROMOTE')
      ? '只能从 投稿内容/待制作/ promote 到 投稿内容/待投递/'
      : '只能对 投稿内容/待投递/ 中已发布成功但未归档的帖子执行 reconciliation',
  };
}

function fail(code, message, detail) {
  return { success: false, error: { code, message, detail } };
}

module.exports = { promote, reconcileMove, isWaitingPublishTask };
