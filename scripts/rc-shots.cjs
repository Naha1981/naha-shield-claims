// RC preview screenshot harness (local, audit-rc branch). Not shipped.
const { chromium } = require('playwright');

const BASE = process.env.RC_BASE || 'http://127.0.0.1:3110';
const OUT = process.env.RC_OUT || '/tmp/rc-shots';

(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const widths = (process.env.RC_WIDTHS || '390').split(',').map(Number);
  for (const theme of ['light', 'dark']) {
   for (const width of widths) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((t) => { try { localStorage.setItem('nahashield-theme', t); } catch (e) {} }, theme);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
    await page.goto(BASE + (process.env.RC_ROUTE || '/'), { waitUntil: 'load', timeout: 90000 });
    await page.waitForSelector('header', { timeout: 90000 });
    if (process.env.RC_ONLY === 'needsok-decide') {
      await page.waitForSelector('h1:text-is("Needs Your OK")', { timeout: 90000 });
      await page.waitForTimeout(1000);
      const boxes = page.locator('[aria-label="Decision panel"] input[type=checkbox]');
      const n = await boxes.count();
      for (let i = 0; i < n; i++) await boxes.nth(i).check();
      await page.fill('[aria-label="Reasoned decision"]', 'Sample walkthrough: evidence checked, innocent explanation weighed, no payout implied.');
      await page.click('text=Record: keep investigating');
      await page.waitForSelector('text=Decision recorded', { timeout: 20000 });
      console.log('DECIDE-FLOW-OK');
      await page.locator('[aria-label="Decision panel"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/rc-needsok-receipt-${theme}.png` });
      console.log(`saved rc-needsok-receipt-${theme}.png`);
      await ctx.close();
      continue;
    }
    if (process.env.RC_ONLY === 'case' || process.env.RC_ONLY === 'case-tabs') {
      await page.waitForSelector('text=Case workspace · Human decision required', { timeout: 90000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/rc-case-overview-${theme}.png` });
      console.log(`saved rc-case-overview-${theme}.png`);
      await page.click('button[role="tab"]:text-is("Identity & death")');
      await page.waitForTimeout(800);
      await page.locator('td:text-is("DHA death record")').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/rc-case-identity-${theme}.png` });
      console.log(`saved rc-case-identity-${theme}.png`);
      if (process.env.RC_ONLY === 'case-tabs') {
        await page.click('button[role="tab"]:text-is("SIM / RICA / bank")');
        await page.waitForTimeout(600);
        await page.click('button[aria-label^="Inspect evidence"] >> nth=0');
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/rc-case-inspector-${theme}.png` });
        console.log(`saved rc-case-inspector-${theme}.png`);
        console.log('INSPECTOR-OK');
      }
      await ctx.close();
      continue;
    }
    if (process.env.RC_ONLY === 'savings') {
      await page.waitForSelector('text=Financial event lifecycle', { timeout: 90000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/rc-savings-states-${theme}.png` });
      console.log(`saved rc-savings-states-${theme}.png`);
      await page.locator('text=Transaction ledger').scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/rc-savings-ledger-${theme}.png` });
      console.log(`saved rc-savings-ledger-${theme}.png`);
      await ctx.close();
      continue;
    }
    if (process.env.RC_ONLY === 'randfound') {
      await page.waitForSelector('text=Savings found in the sample book', { timeout: 90000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/rc-randfound-${theme}.png` });
      console.log(`saved rc-randfound-${theme}.png`);
      await ctx.close();
      continue;
    }
    if (process.env.RC_ONLY === 'needsok') {
      await page.waitForSelector('h1:text-is("Needs Your OK")', { timeout: 90000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${OUT}/rc-needsok-queue-${theme}.png` });
      console.log(`saved rc-needsok-queue-${theme}.png`);
      await page.locator('[aria-label="Decision panel"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/rc-needsok-decision-${theme}.png` });
      console.log(`saved rc-needsok-decision-${theme}.png`);
      await ctx.close();
      continue;
    }
    await page.waitForSelector('text=Executive intelligence board', { timeout: 90000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/rc-board-${theme}${width === 390 ? '' : '-' + width}.png` });
    console.log(`saved rc-board-${theme}${width === 390 ? '' : '-' + width}.png`);
    if (process.env.RC_ONLY !== 'board') {
      await page.click('button[aria-label="Toggle navigation menu"]', { timeout: 15000 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/rc-nav-${theme}.png` });
      console.log(`saved rc-nav-${theme}.png`);
    }
    await ctx.close();
   }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
