const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

// 用法: node render.js <html文件路径> [前缀]
// 示例: node render.js "2026-05-15-高考饮食/懒人养生手册-高考饮食.html" "高考饮食"
// 输出到 html 文件所在目录的 output/ 文件夹，文件名: 前缀-01.png
const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error('用法: node render.js <html文件路径>');
  process.exit(1);
}

const absHtmlPath = path.resolve(htmlPath);
const taskDir = path.dirname(absHtmlPath);
const prefix = process.argv[3] || 'slide';
const outputDir = path.join(taskDir, 'output');
const config = require('../config');
const chromePath = config.chromePath;

(async () => {
  console.log('HTML: ' + absHtmlPath);
  console.log('输出: ' + outputDir);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  // 3x 缩放，匹配 html2canvas 的 SCALE=3，输出 1620x2160
  await page.setViewport({ width: 540, height: 720, deviceScaleFactor: 3 });

  const fileUrl = 'file:///' + absHtmlPath.replace(/\\/g, '/');
  await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.slide', { timeout: 10000 });
  await page.evaluate(() => new Promise(r => setTimeout(r, 2000)));

  const slides = await page.$$('.slide');
  console.log('找到 ' + slides.length + ' 张卡片');

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  for (let i = 0; i < slides.length; i++) {
    const filename = prefix + '-' + String(i + 1).padStart(2, '0') + '.png';
    const filepath = path.join(outputDir, filename);
    console.log('渲染 ' + (i + 1) + '/' + slides.length + ' → ' + filename);
    await slides[i].screenshot({ path: filepath, type: 'png' });
  }

  await browser.close();
  console.log('\n✅ 完成！' + slides.length + ' 张图片已保存');
})().catch(err => { console.error('❌', err.message); process.exit(1); });
