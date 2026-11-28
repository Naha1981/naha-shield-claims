// RC preview screenshot harness (local, audit-rc branch). Not shipped.
const { chromium } = require('playwright');

const BASE = process.env.RC_BASE || 'http://127.0.0.1:3110';
const OUT = process.env.RC_OUT || '/tmp/rc-shots';

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((t) => { try { localStorage.setItem('nahashield-theme', t); } catch (e) {} }, theme);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 90000 });
    await page.waitForSelector('header', { timeout: 90000 });
    await page.waitForSelector('text=Executive intelligence board', { timeout: 90000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/rc-board-${theme}.png` });
    console.log(`saved rc-board-${theme}.png`);
    await page.click('button[aria-label="Toggle navigation menu"]', { timeout: 15000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/rc-nav-${theme}.png` });
    console.log(`saved rc-nav-${theme}.png`);
    await ctx.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
