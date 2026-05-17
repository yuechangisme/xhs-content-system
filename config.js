/**
 * xhs-content-system v0.1
 * 统一路径与全局配置
 *
 * 所有模块通过此文件获取路径，不硬编码目录字符串。
 */

const path = require('path');
const rootDir = __dirname;

module.exports = {
  // 时区
  timezone: 'Asia/Shanghai',

  // content 根目录（帖子文件夹所在位置）
  contentDir: path.join(rootDir, 'content'),

  // state 与日志
  stateJsonPath: path.join(rootDir, 'state.json'),
  errorLogPath: path.join(rootDir, 'error.log'),

  // publish 脚本
  publishScriptPath: path.join(rootDir, 'content', 'publish-xhs.js'),

  // QA 阈值
  qa: {
    centeringOffsetMax: 5,   // 居中偏移最大容忍 px
    fontSizeMin: 46,          // 正文最小字号 px
  },

  // 发布重试
  publish: {
    maxRetries: 3,
  },
};
