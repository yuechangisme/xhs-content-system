/**
 * xhs-content-system v0.1
 * 统一路径与全局配置
 *
 * 所有模块通过此文件获取路径，不硬编码目录字符串。
 *
 * 优先级：
 *   1. config.local.js（本机私有覆盖，不上传）
 *   2. 此文件的默认值
 */

const path = require('path');
const rootDir = __dirname;

// 默认配置
const defaults = {
  // 时区
  timezone: 'Asia/Shanghai',

  // content 根目录
  contentDir: path.join(rootDir, 'content'),

  // state 与日志
  stateJsonPath: path.join(rootDir, 'state.json'),
  errorLogPath: path.join(rootDir, 'error.log'),

  // publish 脚本
  publishScriptPath: path.join(rootDir, 'content', 'publish-xhs.js'),

  // Chrome 路径（留空 = 使用 puppeteer 自动查找）
  chromePath: '',

  // 小红书 Cookie 文件路径
  cookiePath: '',

  // QA 阈值
  qa: {
    centeringOffsetMax: 5,
    fontSizeMin: 46,
  },

  // 发布重试
  publish: {
    maxRetries: 3,
  },
};

// 尝试加载本机私有配置覆盖
let localOverrides = {};
try {
  localOverrides = require('./config.local');
} catch (_) {
  // config.local.js 不存在时静默跳过
}

module.exports = { ...defaults, ...localOverrides };
