/**
 * xhs-content-system v0.1
 * QA 模块 — 静态规则检测
 *
 * 职责：对单个帖子执行所有 P0 静态检查项
 * 不包含：Puppeteer 居中检测（后续版本）
 *
 * 用法：
 *   const qa = require('./modules/qa');
 *   const result = await qa.run(taskDir);
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const qaProfiles = require('./qa-profiles');

// 常见 emoji 图标列表（用于 warning 检测）
const EMOJI_PATTERN = /[\u{1F300}-\u{1F9FF}]/u;

// 重点关注的食物/物品类 emoji
const FOOD_EMOJI = /🥣|🍵|🥦|🍎|🍳|🥚|🥗|🫘|🥛|🧊|🫐|🥑|🧄|🧅|🍋|🍊|🥕|🌽|🥜|🌰|🍄|🫒|🥝|🍑|🍒|🍓|🍇|🍉|🍌|🍍|🥭|🍈|🫐|🥥|🥨|🧀|🥩|🥓|🧇|🥞|🧆|🥙|🥪|🌮|🌯|🫓|🥗|🫕|🍲|🍛|🍣|🍤|🥟|🍜|🍝|🍠|🍢|🍡|🍧|🍨|🍦|🥧|🧁|🍰|🎂|🍮|🍭|🍬|🍫|🍿|🍩|🍪|🌰|🥜|🍯|🧉|🧃|🥤|🍶|🍺|🍻|🥂|🍷|🥃|🍸|🍹|🍾|🧊|🥄|🍴|🥢|🍽️|🔪|🫙|🫖|🧂|🫗|🧊|🥛|☕|🧋/u;

/**
 * 对指定帖子执行全部静态 QA 检查
 *
 * @param {string} taskDir - 相对于 content/ 的目录路径
 * @returns {object} { success, data: { status, checkedAt, checks }, warnings }
 */
function run(taskDir) {
  const fullPath = path.join(config.contentDir, taskDir);
  const checks = [];
  const warnings = [];
  let allPassed = true;

  // ─── 1. 任务目录存在 ─────────────────────────────────
  if (!fs.existsSync(fullPath)) {
    checks.push({ name: 'directory_exists', pass: false, detail: `目录不存在: ${fullPath}` });
    return buildResult('FAILED', checks, warnings);
  }
  checks.push({ name: 'directory_exists', pass: true, detail: null });

  // ─── 2. manifest.json 存在 ────────────────────────────
  const manifestPath = path.join(fullPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    checks.push({ name: 'manifest_exists', pass: false, detail: `manifest.json 不存在: ${manifestPath}` });
    return buildResult('FAILED', checks, warnings);
  }
  checks.push({ name: 'manifest_exists', pass: true, detail: null });

  // ─── 3. manifest.json 格式 + 内容 ────────────────────
  let manifest;
  let qaProfile = qaProfiles.resolveProfile(null);
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    checks.push({ name: 'manifest_valid', pass: true, detail: null });
  } catch (e) {
    checks.push({ name: 'manifest_valid', pass: false, detail: `JSON 解析失败: ${e.message}` });
    allPassed = false;
  }

  if (manifest) {
    qaProfile = qaProfiles.resolveProfile(manifest.styleVersion);
    if (!qaProfile) {
      checks.push({ name: 'qa_profile', pass: false, detail: `unsupported styleVersion: ${manifest.styleVersion}` });
      allPassed = false;
      qaProfile = qaProfiles.resolveProfile(null);
    } else {
      checks.push({ name: 'qa_profile', pass: true, detail: manifest.styleVersion || 'legacy' });
    }

    const title = manifest?.outputs?.xiaohongshu?.copy?.title || '';
    const tags = manifest?.outputs?.xiaohongshu?.copy?.tags || [];

    if (title.length > 20) {
      checks.push({ name: 'title_length', pass: false, detail: `标题 ${title.length} 字，超过 20 字上限` });
      allPassed = false;
    } else {
      checks.push({ name: 'title_length', pass: true, detail: null });
    }

    if (tags.length > 10) {
      checks.push({ name: 'tags_count', pass: false, detail: `标签 ${tags.length} 个，超过 10 个上限` });
      allPassed = false;
    } else {
      checks.push({ name: 'tags_count', pass: true, detail: null });
    }
  }

  // ─── 4. output/ 存在且有 PNG ──────────────────────────
  const outputDir = path.join(fullPath, 'output');
  if (!fs.existsSync(outputDir)) {
    checks.push({ name: 'output_exists', pass: false, detail: 'output/ 目录不存在' });
    allPassed = false;
  } else {
    const pngFiles = fs.readdirSync(outputDir).filter(f => /\.png$/i.test(f));
    if (pngFiles.length === 0) {
      checks.push({ name: 'output_exists', pass: false, detail: 'output/ 中没有 PNG 文件' });
      allPassed = false;
    } else {
      checks.push({ name: 'output_exists', pass: true, detail: null });
    }
  }

  // ─── 5. HTML 静态检测 ─────────────────────────────────
  const htmlFiles = fs.readdirSync(fullPath).filter(f => /\.html$/i.test(f));

  if (htmlFiles.length === 0) {
    checks.push({ name: 'html_exists', pass: false, detail: '任务目录中无 HTML 文件' });
    allPassed = false;
  } else {
    checks.push({ name: 'html_exists', pass: true, detail: null });

    for (const htmlFile of htmlFiles) {
      const htmlPath = path.join(fullPath, htmlFile);
      const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

      // 5a. border-radius 在 .slide CSS 中
      const hasBorderRadius = detectInSlideCSS(htmlContent, 'border-radius');
      if (hasBorderRadius) {
        checks.push({ name: 'border_radius', pass: false, detail: `${htmlFile}: .slide CSS 中包含 border-radius` });
        allPassed = false;
      }

      // 5b. box-shadow 在 .slide CSS 中
      const hasBoxShadow = detectInSlideCSS(htmlContent, 'box-shadow');
      if (hasBoxShadow) {
        checks.push({ name: 'box_shadow', pass: false, detail: `${htmlFile}: .slide CSS 中包含 box-shadow` });
        allPassed = false;
      }

      // 5c. 正文字号检测
      const fontSizeIssues = detectFontSize(htmlContent, qaProfile);
      if (fontSizeIssues.length > 0) {
        checks.push({
          name: 'font_size',
          pass: false,
          detail: `${htmlFile}: ${fontSizeIssues.join('; ')}`,
        });
        allPassed = false;
      } else {
        checks.push({
          name: 'font_size',
          pass: true,
          detail: qaProfile.name,
        });
      }

      // 5d. emoji 图标检测（warning，不阻断）
      const emojiIssues = detectEmojiIcons(htmlContent);
      if (emojiIssues.length > 0) {
        warnings.push({
          code: 'QA_EMOJI_ICON_FOUND',
          message: `${htmlFile}: 发现 emoji 图标 — ${emojiIssues.join(', ')}`,
          detail: { file: htmlFile, emojis: emojiIssues },
        });
      }

      const customIssues = detectCustomProfileIssues(htmlContent, manifest, fullPath, qaProfile);
      if (customIssues.length > 0) {
        checks.push({
          name: 'style_profile_rules',
          pass: false,
          detail: `${htmlFile}: ${customIssues.join('; ')}`,
        });
        allPassed = false;
      } else if (qaProfile.customChecks?.length) {
        checks.push({
          name: 'style_profile_rules',
          pass: true,
          detail: qaProfile.name,
        });
      }

      // 只检测第一个 HTML 文件（避免重复报告）
      break;
    }
  }

  // ─── 填充未执行的 check 项（标记为跳过） ─────────────
  const allCheckNames = [
    'directory_exists', 'manifest_exists', 'manifest_valid',
    'qa_profile', 'title_length', 'tags_count', 'output_exists',
    'html_exists', 'border_radius', 'box_shadow', 'font_size',
    'style_profile_rules',
  ];

  for (const name of allCheckNames) {
    if (!checks.find(c => c.name === name)) {
      checks.push({ name, pass: true, detail: 'skipped' });
    }
  }

  return buildResult(allPassed ? 'PASSED' : 'FAILED', checks, warnings);
}

// ─── 内部工具 ──────────────────────────────────────────

/**
 * 在 .slide CSS 块中检测禁止属性
 * 匹配: .slide { ... border-radius ... } 或 .slide { ... box-shadow ... }
 */
function detectInSlideCSS(html, property) {
  // 匹配 .slide { 包含 property 的情况，处理多行和单行
  const slideBlockRegex = /\.slide\s*\{[^}]*\}/gs;
  const match = html.match(slideBlockRegex);
  if (!match) return false;

  for (const block of match) {
    // 提取属性名（忽略 vendor prefix 和值）
    const propRegex = new RegExp(`(?:^|[;\\s])${property}\\s*:`, 'i');
    if (propRegex.test(block)) return true;
  }
  return false;
}

/**
 * 检测正文字号是否低于阈值
 * MVP 版：正则扫描 CSS 中的 font-size 定义
 */
function detectFontSize(html, profile) {
  const issues = [];

  for (const rule of profile.typography) {
    const sizeText = findFontSizeForSelector(html, rule.selector);
    if (!sizeText) continue;

    const size = parseInt(sizeText, 10);
    if (size < rule.min) {
      issues.push(`${rule.selector} font-size: ${size}px (< ${rule.min}px, ${rule.tier})`);
    }
  }

  return issues;
}

function detectCustomProfileIssues(html, manifest, fullPath, profile) {
  const checks = profile.customChecks || [];
  const issues = [];

  if (checks.includes('lazy_health_v7')) {
    issues.push(...detectLazyHealthV7Issues(html, manifest, fullPath));
  }

  return issues;
}

function detectLazyHealthV7Issues(html, manifest, fullPath) {
  const issues = [];

  if (manifest?.pageCount !== 5) {
    issues.push(`manifest.pageCount must be 5 (actual: ${manifest?.pageCount})`);
  }

  const slideCount = (html.match(/<section\s+class="slide"/g) || []).length;
  if (slideCount !== 5) {
    issues.push(`slide count must be 5 (actual: ${slideCount})`);
  }

  const outputDir = path.join(fullPath, 'output');
  const pngCount = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir).filter(f => /\.png$/i.test(f)).length
    : 0;
  if (pngCount !== 5) {
    issues.push(`output PNG count must be 5 (actual: ${pngCount})`);
  }

  const nums = [...html.matchAll(/<div\s+class="num">\s*(\d+)\s*<\/div>/g)].map(m => Number(m[1]));
  if (nums.length > 8 || Math.max(...nums, 0) > 8) {
    issues.push(`numbered content must not exceed 8 (actual count: ${nums.length}, max: ${Math.max(...nums, 0)})`);
  }

  const coverImageMatch = html.match(/<div\s+class="cover-illus"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i);
  const coverImageSrc = coverImageMatch?.[1] || '';
  if (!coverImageSrc) {
    issues.push('cover illustration image is required');
  } else if (!/\.(png|jpe?g)$/i.test(coverImageSrc)) {
    issues.push(`cover illustration must be PNG/JPG, not ${path.extname(coverImageSrc) || 'unknown'}`);
  } else {
    const imagePath = path.join(fullPath, coverImageSrc.replace(/\//g, path.sep));
    const dimensions = readImageDimensions(imagePath);
    if (!dimensions) {
      issues.push(`cover illustration dimensions unreadable: ${coverImageSrc}`);
    } else {
      const ratio = dimensions.width / dimensions.height;
      const target = 37 / 30;
      if (Math.abs(ratio - target) > 0.08) {
        issues.push(`cover illustration ratio must be close to 37:30 (actual: ${ratio.toFixed(3)})`);
      }
    }
  }

  const coverBlock = findCssBlock(html, '.cover-illus');
  const requiredCss = [
    ['left', '96px'],
    ['right', '96px'],
    ['bottom', '176px'],
    ['height', '720px'],
  ];
  for (const [prop, value] of requiredCss) {
    if (!new RegExp(`${prop}\\s*:\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(coverBlock)) {
      issues.push(`.cover-illus must set ${prop}: ${value}`);
    }
  }

  const forbiddenV61Classes = [
    'food-grid', 'food-card', 'principle-card', 'note-card',
    'solution-card', 'menu-card', 'cta-card', 'food-tag',
    'cover-offer', 'topbar',
  ];
  for (const className of forbiddenV61Classes) {
    if (new RegExp(`class=["'][^"']*\\b${className}\\b`, 'i').test(html)) {
      issues.push(`V7 must not use V6.1 card/grid class: .${className}`);
    }
  }

  return issues;
}

function findCssBlock(html, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, 'is'));
  return match ? match[0] : '';
}

function readImageDimensions(imagePath) {
  if (!fs.existsSync(imagePath)) return null;
  const buffer = fs.readFileSync(imagePath);

  if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer.length >= 4 && buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xFF) return null;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xC0 && marker <= 0xC3) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }

  return null;
}

function findFontSizeForSelector(html, selector) {
  const selectorPattern = selector.trim()
    .split(/\s+/)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const regex = new RegExp(`${selectorPattern}\\s*\\{[^}]*font-size\\s*:\\s*(\\d+)\\s*px`, 'i');
  const match = html.match(regex);
  return match ? match[1] : null;
}

/**
 * 检测核心图标位置是否使用 emoji
 * MVP 版：扫描 HTML 中特定食物/物品 emoji
 */
function detectEmojiIcons(html) {
  const found = [];
  let match;
  const regex = /🥣|🍵|🥦|🍎|🍳|🥚|🥗|🫘|🥛|🧊|🥑|🧄|🧅|🍋|🍊|🥕|🌽|🥜|🌰|🍄|🫒|🥝|🍑|🍒|🍓|🍇|🍉|🍌|🍍|🥭|🍈|🥥|🥨|🧀|🥩|🥓|🧇|🥞|🧆|🥙|🥪|🌮|🌯|🫓|🧁|🍰|🎂|🍮|🍭|🍬|🍫|🍿|🍩|🍪|🧉|🧃|🥤|🍶|🧂|🫗|🧋/gu;

  while ((match = regex.exec(html)) !== null) {
    if (!found.includes(match[0])) {
      found.push(match[0]);
    }
  }

  return found;
}

function buildResult(status, checks, warnings) {
  return {
    success: status === 'PASSED',
    data: {
      status,
      checkedAt: new Date().toISOString(),
      checks,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

module.exports = { run };
