// Live verification chunk: LIVE_SET indexes into SCREENS, LIVE_THEME sets theme.
const { chromium } = require('playwright');
const SCREENS = [
  ['/', 'board', 'text=Executive intelligence board'],
  ['/needs-ok', 'needs-ok', 'text=inspection sequence'],
  ['/case-workspace', 'case-workspace', 'text=Why this case is open'],
  ['/savings-ledger', 'savings-ledger', 'text=Financial event lifecycle'],
  ['/rand-found', 'rand-found', 'text=Savings found in the sample book'],
  ['/ai-ops', 'ai-ops', 'text=Execution queue and run history'],
  ['/reports', 'reports', 'text=Five to ten slides'],
];
(async () => {
  const idx = (process.env.LIVE_SET || '0').split(',').map(Number);
  const theme = process.env.LIVE_THEME || 'light';
  const browser = await chromium.launch();
  let bad = 0;
  for (const i of idx) {
    const [route, name, marker] = SCREENS[i];
    const ctx = await browser.newContext({ viewport: { width: 400, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((t) => { try { localStorage.setItem('nahashield-theme', t); } catch (e) {} }, theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 150)); });
    try {
      await page.goto('https://claimtrace.nahalabs.co.za' + route + '?v=' + Date.now(), { waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector(marker, { timeout: 60000 });
      await page.reload({ waitUntil: 'load', timeout: 60000 });
      await page.waitForSelector(marker, { timeout: 60000 });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `/tmp/rc-live/live-${name}-${theme}.png` });
      await page.click('button[aria-label*="mode"]', { timeout: 15000 });
      await page.waitForTimeout(500);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const expect = theme === 'light' ? 'rgb(9, 23, 20)' : 'rgb(250, 249, 245)';
      const switchOk = bg === expect;
      if (errors.length || !switchOk) { bad++; console.log(`LIVE-ISSUE ${name} ${theme}: errors=${errors.join('|') || 'none'} themeSwitch=${switchOk} bg=${bg}`); }
      else console.log(`LIVE-OK ${name} ${theme} (refresh clean, theme switches, no console errors)`);
    } catch (e) {
      bad++;
      console.log(`LIVE-FAIL ${name} ${theme}: ${String(e).slice(0, 200)}`);
    }
    await ctx.close();
  }
  await browser.close();
  console.log(bad === 0 ? 'CHUNK-OK' : `CHUNK-ISSUES: ${bad}`);
})();
