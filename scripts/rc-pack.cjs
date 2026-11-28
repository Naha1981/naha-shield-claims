// Go+Sure pack: every screen x phone(390)/desktop(1280) x light/dark.
const { chromium } = require('playwright');
const BASE = process.env.RC_BASE || 'http://127.0.0.1:3111';
const OUT = process.env.RC_OUT || '/tmp/rc-pack';
const ROUTES = [
  ['/', 'board', 'text=Executive intelligence board'],
  ['/needs-ok', 'needs-ok', 'text=inspection sequence'],
  ['/claims', 'claims', 'header'],
  ['/intake', 'intake', 'header'],
  ['/investigator', 'investigator', 'header'],
  ['/case-workspace', 'case-workspace', 'text=Why this case is open'],
  ['/network', 'network', 'header'],
  ['/leakage', 'leakage', 'header'],
  ['/see-worked-case-example', 'example', 'header'],
  ['/savings-ledger', 'savings-ledger', 'text=Financial event lifecycle'],
  ['/rand-found', 'rand-found', 'text=Savings found in the sample book'],
  ['/recovery', 'recovery', 'header'],
  ['/ai-ops', 'ai-ops', 'text=Execution queue and run history'],
  ['/workforce', 'workforce', 'header'],
  ['/vault', 'vault', 'header'],
  ['/consent', 'consent', 'header'],
  ['/compliance', 'compliance', 'header'],
  ['/reports', 'reports', 'text=Five to ten slides'],
];
(async () => {
  const fs = require('fs');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let failures = 0;
  const only = process.env.PACK_SET ? process.env.PACK_SET.split(',').map(Number) : ROUTES.map((_, i) => i);
  for (const i of only) {
    const [route, name, marker] = ROUTES[i];
    for (const width of [390, 1280]) {
      for (const theme of ['light', 'dark']) {
        const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1 });
        await ctx.addInitScript((t) => { try { localStorage.setItem('nahashield-theme', t); } catch (e) {} }, theme);
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e).slice(0, 150)));
        try {
          await page.goto(BASE + route, { waitUntil: 'load', timeout: 90000 });
          await page.waitForSelector('header', { timeout: 90000 });
          if (marker !== 'header') await page.waitForSelector(marker, { timeout: 60000 });
          await page.waitForTimeout(900);
          await page.screenshot({ path: `${OUT}/${name}-${width}-${theme}.png` });
          if (errors.length) { failures++; console.log(`PACK-PAGEERROR ${name}-${width}-${theme}: ${errors.join('|')}`); }
          else console.log(`saved ${name}-${width}-${theme}.png`);
        } catch (e) {
          failures++;
          console.log(`PACK-FAIL ${name}-${width}-${theme}: ${String(e).slice(0, 150)}`);
        }
        await ctx.close();
      }
    }
  }
  await browser.close();
  console.log(failures === 0 ? 'PACK-ALL-OK' : `PACK-FAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
