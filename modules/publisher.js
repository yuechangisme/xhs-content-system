/**
 * xhs-content-system v0.2
 * publisher 模块 — 真实发布接入
 *
 * 职责：验证前置条件 → 调用 publish-xhs.js → 捕获结果 → 更新状态
 * 不包含：调度逻辑、定时器、多账号
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');

const PUBLISH_SCRIPT_TIMEOUT = 120_000; // 2 分钟
const SUCCESS_MARKER = '✅ 已点击发布笔记';

/**
 * 执行真实发布
 *
 * @param {string} taskDir - 相对于 content/ 的目录路径
 * @returns {Promise<object>} { success, data?, error? }
 */
async function publish(taskDir) {
  const fullPath = path.join(config.contentDir, taskDir);

  // ─── 前置条件验证 ─────────────────────────────────
  const prechecks = [
    { name: 'dir_exists', pass: fs.existsSync(fullPath), msg: `目录不存在: ${fullPath}` },
    { name: 'chrome_path', pass: !!config.chromePath, msg: 'config.chromePath 未配置' },
    { name: 'cookie_path', pass: !!config.cookiePath, msg: 'config.cookiePath 未配置' },
    { name: 'cookie_file', pass: config.cookiePath ? fs.existsSync(config.cookiePath) : false, msg: `cookie 文件不存在: ${config.cookiePath}` },
    { name: 'manifest_exists', pass: fs.existsSync(path.join(fullPath, 'manifest.json')), msg: 'manifest.json 不存在' },
    { name: 'output_exists', pass: fs.existsSync(path.join(fullPath, 'output')), msg: 'output/ 不存在' },
  ];

  for (const c of prechecks) {
    if (!c.pass) {
      return { success: false, error: { code: 'PUBLISH_PRECHECK_FAILED', message: c.msg, detail: prechecks } };
    }
  }

  const pngFiles = fs.readdirSync(path.join(fullPath, 'output')).filter(f => /\.png$/i.test(f));
  if (pngFiles.length === 0) {
    return { success: false, error: { code: 'PUBLISH_IMAGES_NOT_FOUND', message: 'output/ 中没有 PNG 文件' } };
  }

  // ─── 调用 publish-xhs.js ──────────────────────────
  const scriptPath = config.publishScriptPath;
  if (!fs.existsSync(scriptPath)) {
    return { success: false, error: { code: 'PUBLISH_SCRIPT_NOT_FOUND', message: `publish 脚本不存在: ${scriptPath}` } };
  }

  try {
    const result = await runPublishScript(scriptPath, taskDir);

    if (!result.success) {
      return {
        success: false,
        error: {
          code: 'PUBLISH_SCRIPT_FAILED',
          message: result.stderr || result.stdout || '发布脚本异常退出',
          detail: { exitCode: result.exitCode, stdout: truncate(result.stdout, 500), stderr: truncate(result.stderr, 500) },
        },
      };
    }

    // ─── 发布成功 ───────────────────────────────────
    const imageCount = pngFiles.length;
    return {
      success: true,
      data: {
        taskDir,
        publishedAt: new Date().toISOString(),
        imageCount,
        stdout: result.stdout,
      },
    };

  } catch (err) {
    return {
      success: false,
      error: {
        code: 'PUBLISH_RUNTIME_ERROR',
        message: err.message,
        detail: { stack: err.stack },
      },
    };
  }
}

/**
 * 执行 publish-xhs.js 子进程
 */
function runPublishScript(scriptPath, taskDir) {
  return new Promise((resolve) => {
    const proc = spawn('node', [scriptPath, taskDir], {
      cwd: path.dirname(scriptPath),
      timeout: PUBLISH_SCRIPT_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_OPTIONS: '' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (exitCode) => {
      const success = exitCode === 0 && stdout.includes(SUCCESS_MARKER);
      resolve({ success, exitCode, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ success: false, exitCode: -1, stdout, stderr: err.message });
    });

    // 超时保护
    setTimeout(() => {
      proc.kill();
      resolve({ success: false, exitCode: -1, stdout, stderr: `Timeout after ${PUBLISH_SCRIPT_TIMEOUT}ms` });
    }, PUBLISH_SCRIPT_TIMEOUT);
  });
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

module.exports = { publish };
