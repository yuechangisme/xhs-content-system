/**
 * xhs-content-system v0.1
 * 统一日志记录：追加 error.log，不影响主流程
 */

const fs = require('fs');
const config = require('../config');

/**
 * 记录一条日志
 *
 * @param {string} level  - INFO / WARN / ERROR
 * @param {string} code   - 错误码（大写蛇形）
 * @param {string} module - 来源模块名
 * @param {string} message - 人类可读描述
 * @param {object} [detail] - 可选的诊断数据
 */
function log(level, code, module, message, detail) {
  const timestamp = new Date().toISOString();
  let line = `${timestamp} [${level}] [${code}] ${module}: ${message}`;
  if (detail) {
    line += `\n  detail: ${JSON.stringify(detail)}`;
  }
  line += '\n---\n';

  try {
    fs.appendFileSync(config.errorLogPath, line, 'utf-8');
  } catch (_) {
    // logger 本身不抛异常，静默失败
  }
}

function info(code, module, message, detail) {
  log('INFO', code, module, message, detail);
}

function warn(code, module, message, detail) {
  log('WARN', code, module, message, detail);
}

function error(code, module, message, detail) {
  log('ERROR', code, module, message, detail);
}

module.exports = { log, info, warn, error };
