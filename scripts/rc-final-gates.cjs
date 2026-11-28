// RC final gates: route refresh + theme switch regression, and a text contrast sweep.
const { chromium } = require('playwright');

const BASE = process.env.RC_BASE || 'http://127.0.0.1:3111';
const ROUTES = ['/', '/needs-ok', '/case-workspace', '/savings-ledger', '/rand-found', '/ai-ops', '/reports'];

function luminance(r, g, b) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fg, bg) {
  const l1 = luminance(...fg), l2 = luminance(...bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

(async () => {
  const browser = await chromium.launch();
  let failures = 0;

  // 1. Refresh + theme-switch regression on every route, both initial themes.
  for (const route of ROUTES) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript((t) => { try { localStorage.setItem('nahashield-theme', t); } catch (e) {} }, theme);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
      await page.goto(BASE + route, { waitUntil: 'load', timeout: 90000 });
      await page.waitForSelector('header', { timeout: 90000 });
      await page.reload({ waitUntil: 'load', timeout: 90000 });
      await page.waitForSelector('header', { timeout: 90000 });
      const bgBefore = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await page.click('button[aria-label*="mode"]', { timeout: 15000 });
      await page.waitForTimeout(600);
      const bgAfter = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const ok = errors.length === 0 && bgBefore !== bgAfter;
      if (!ok) { failures++; console.log(`REGRESSION-FAIL ${route} ${theme} errors=${errors.join('|')} bg ${bgBefore} -> ${bgAfter}`); }
      else console.log(`REGRESSION-OK ${route} ${theme} (refresh clean, theme switches ${bgBefore} -> ${bgAfter})`);
      await ctx.close();
    }
  }

  // 2. Contrast sweep: every visible text element, both themes, min ratio 4.5 (3.0 for large text).
  for (const route of ROUTES) {
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript((t) => { try { localStorage.setItem('nahashield-theme', t); } catch (e) {} }, theme);
      const page = await ctx.newPage();
      await page.goto(BASE + route, { waitUntil: 'load', timeout: 90000 });
      await page.waitForSelector('header', { timeout: 90000 });
      await page.waitForTimeout(800);
      const samples = await page.evaluate(() => {
        const out = [];
        const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
        const els = document.querySelectorAll('p, h1, h2, h3, h4, span, li, td, th, dd, dt, button, a, label, summary');
        for (const el of els) {
          const text = (el.textContent || '').trim();
          if (!text || text.length < 2) continue;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          let bg = null, node = el;
          while (node && node !== document.documentElement) {
            const c = parse(getComputedStyle(node).backgroundColor);
            if (c && c[3] > 0.9) { bg = c; break; }
            node = node.parentElement;
          }
          if (!bg) bg = parse(getComputedStyle(document.body).backgroundColor);
          const fg = parse(cs.color);
          if (!fg || !bg) continue;
          out.push({ text: text.slice(0, 40), fg, bg, size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400 });
        }
        return out;
      });
      const seen = new Set();
      let bad = 0;
      for (const s of samples) {
        const key = `${s.fg}|${s.bg}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const r = ratio(s.fg.slice(0, 3), s.bg.slice(0, 3));
        const large = s.size >= 18 || (s.size >= 14 && s.weight >= 700);
        const min = large ? 3.0 : 4.5;
        if (r < min) { bad++; failures++; console.log(`CONTRAST-FAIL ${route} ${theme} ratio=${r.toFixed(2)} min=${min} "${s.text}" fg=${s.fg} bg=${s.bg}`); }
      }
      console.log(bad === 0 ? `CONTRAST-OK ${route} ${theme} (${seen.size} unique colour pairs)` : `CONTRAST-DONE ${route} ${theme} ${bad} failing pairs`);
      await ctx.close();
    }
  }

  await browser.close();
  console.log(failures === 0 ? 'ALL-FINAL-GATES-OK' : `FINAL-GATES-FAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})();
