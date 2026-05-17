const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const CHROME = config.chromePath;
const COOKIES_PATH = config.cookiePath;
const COOKIES = COOKIES_PATH ? JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8')) : {};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

// 用法: node publish-xhs.js <任务目录>
// 从任务目录的 manifest.json 读取标题和正文
const taskDir = process.argv[2];
if (!taskDir) { console.error('用法: node publish-xhs.js <任务目录>'); process.exit(1); }

const taskPath = path.resolve(__dirname, taskDir);
const manifestPath = path.join(taskPath, 'manifest.json');
const imagesDir = path.join(taskPath, 'output');

if (!fs.existsSync(manifestPath)) {
  console.error('❌ 找不到 manifest.json，请先创建');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const xhsData = manifest.outputs?.xiaohongshu;
if (!xhsData) { console.error('❌ manifest.json 中缺少 xiaohongshu 配置'); process.exit(1); }

const title = xhsData.copy.title;
const body = xhsData.copy.body;

async function mouseClick(page, x, y) {
  const cdp = await page.target().createCDPSession();
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 50));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

(async () => {
  const b = await puppeteer.launch({
    headless: false,
    executablePath: CHROME,
    args: ['--no-sandbox', `--user-agent=${UA}`]
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });

  await p.setCookie(...Object.entries(COOKIES).map(([n, v]) => ({ name: n, value: v, domain: '.xiaohongshu.com', path: '/' })));
  await p.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'load', timeout: 30000 });
  await new Promise(r => setTimeout(r, 5000));
  console.log('✅ 页面已打开');

  // 切换到上传图文
  const tabPos = await p.evaluate(() => {
    const tabs = [...document.querySelectorAll('div[class*="tab"]')];
    const t = tabs.find(el => el.textContent.includes('上传图文'));
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (tabPos) {
    await mouseClick(p, tabPos.x, tabPos.y);
    console.log('✅ 已切换到「上传图文」');
    await new Promise(r => setTimeout(r, 3000));
  }

  // 上传图片
  if (fs.existsSync(imagesDir)) {
    const images = fs.readdirSync(imagesDir).filter(f => /\.png$/i.test(f)).sort().map(f => path.join(imagesDir, f));
    if (images.length > 0) {
      const cdp = await p.target().createCDPSession();
      const { root } = await cdp.send('DOM.getDocument');
      const inp = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type="file"]' });
      if (inp.nodeId) {
        await cdp.send('DOM.setFileInputFiles', { nodeId: inp.nodeId, files: images });
        console.log(`✅ 图片上传中 (${images.length} 张)...`);
        await new Promise(r => setTimeout(r, 6000));
      }
    }
  }

  // 填写标题
  await p.evaluate((t) => {
    const el = document.querySelector('input[placeholder*="标题"]');
    if (el) { el.focus(); el.value = t; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, title.slice(0, 20));
  console.log('✅ 标题');

  // 填写正文——保留空行结构
  const lines = body.split('\n');
  await p.evaluate(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    if (editor) { editor.focus(); editor.innerHTML = ''; }
  });
  await new Promise(r => setTimeout(r, 300));
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '') {
      // 空行 → 按两次回车产生空行
      await p.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 50));
      await p.keyboard.press('Enter');
    } else {
      await p.keyboard.type(lines[i], { delay: 15 });
    }
    await new Promise(r => setTimeout(r, 60));
    // 非最后一行且非空行后接回车
    if (i < lines.length - 1 && lines[i] !== '') {
      await p.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 60));
    }
  }
  console.log('✅ 正文');

  // 正文结束后空一行，输入标签（在正文编辑器内打 #标签 + 回车）
  const tags = xhsData.copy.tags || [];
  if (tags.length > 0) {
    await p.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 100));
    await p.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 100));
    for (let ti = 0; ti < tags.length; ti++) {
      await p.keyboard.type('#' + tags[ti], { delay: 30 });
      await new Promise(r => setTimeout(r, 800));
      await p.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 800));
    }
    console.log(`✅ 标签 (${tags.length} 个)`);
  }

  // 等待一下让编辑器完成处理
  await new Promise(r => setTimeout(r, 2000));

  // 穿透 Shadow DOM 找到发布按钮
  const pubPos = await p.evaluate(() => {
    const host = document.querySelector('xhs-publish-btn');
    if (!host) return null;
    // 尝试访问 closed shadow root（在浏览器中可通过某些方式访问）
    // 或者直接通过 host 元素的位置计算
    const hostRect = host.getBoundingClientRect();
    // host 是底部固定栏，高 90px，内部两个按钮居中排列
    // 暂存(120px) + gap(24px) + 发布(120px) = 264px 总宽
    // 发布按钮是第二个，在右侧
    const centerY = hostRect.y + hostRect.height / 2;
    const totalBtnWidth = 264;
    const startX = hostRect.x + (hostRect.width - totalBtnWidth) / 2;
    const publishX = startX + 120 + 24 + 60; // 暂存宽120 + gap24 + 发布半宽60
    return { x: Math.round(publishX), y: Math.round(centerY) };
  });

  if (pubPos) {
    console.log(`找到发布按钮位置: (${Math.round(pubPos.x)}, ${Math.round(pubPos.y)})`);
    const cdp = await p.target().createCDPSession();
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pubPos.x, y: pubPos.y, button: 'left', clickCount: 1 });
    await new Promise(r => setTimeout(r, 80));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pubPos.x, y: pubPos.y, button: 'left', clickCount: 1 });
    console.log('✅ 已点击发布笔记');
    await new Promise(r => setTimeout(r, 8000));
  } else {
    console.log('⚠️ 未找到发布按钮，请手动点击');
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  全流程完成！请检查小红书确认是否发布成功');
  console.log('═══════════════════════════════════════');
})();