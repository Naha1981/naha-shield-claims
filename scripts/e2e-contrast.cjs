// WCAG AA contrast audit, both themes, phone viewport, against the local
// production server. Walks every visible text-bearing element on each key
// screen and asserts its computed foreground/background contrast meets AA
// (4.5:1 normal text, 3:1 large text). Fails the run on any violation.
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3100';

const AUDIT = `(() => {
  const oklabToSrgb = (L, a, b, alpha) => {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ ** 3, m = m_ ** 3, q = s_ ** 3;
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * q,
    ];
    const gam = (c) => { c = Math.min(1, Math.max(0, c)); return (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255; };
    return [Math.round(gam(lin[0])), Math.round(gam(lin[1])), Math.round(gam(lin[2])), alpha];
  };
  const parse = (s) => {
    if (!s) return null;
    const direct = s.match(/rgba?\\(([^)]+)\\)/);
    if (direct) return direct[1].split(',').map(Number);
    const ok = s.match(/oklch\\(([0-9.]+)%?\\s+([0-9.]+)\\s+([0-9.]+)(?:\\s*\\/\\s*([0-9.]+%?))?\\)/);
    if (ok) {
      const L = parseFloat(ok[1]); const C = parseFloat(ok[2]); const H = (parseFloat(ok[3]) * Math.PI) / 180;
      const alpha = ok[4] === undefined ? 1 : (ok[4].endsWith('%') ? parseFloat(ok[4]) / 100 : parseFloat(ok[4]));
      return oklabToSrgb(L, C * Math.cos(H), C * Math.sin(H), alpha);
    }
    const ol = s.match(/oklab\\(([0-9.]+)%?\\s+(-?[0-9.]+)\\s+(-?[0-9.]+)(?:\\s*\\/\\s*([0-9.]+%?))?\\)/);
    if (ol) {
      const alpha = ol[4] === undefined ? 1 : (ol[4].endsWith('%') ? parseFloat(ol[4]) / 100 : parseFloat(ol[4]));
      return oklabToSrgb(parseFloat(ol[1]), parseFloat(ol[2]), parseFloat(ol[3]), alpha);
    }
    const cs = s.match(/color\\(srgb\\s+([0-9.]+)\\s+([0-9.]+)\\s+([0-9.]+)(?:\\s*\\/\\s*([0-9.]+%?))?\\)/);
    if (cs) {
      const alpha = cs[4] === undefined ? 1 : (cs[4].endsWith('%') ? parseFloat(cs[4]) / 100 : parseFloat(cs[4]));
      return [Math.round(parseFloat(cs[1]) * 255), Math.round(parseFloat(cs[2]) * 255), Math.round(parseFloat(cs[3]) * 255), alpha];
    }
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillStyle = s;
    const v = ctx.fillStyle;
    const m = v.match(/rgba?\\(([^)]+)\\)/);
    if (m) return m[1].split(',').map(Number);
    const h = v.match(/^#([0-9a-f]{6})$/i);
    if (h) return [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16)];
    return null;
  };
  const chan = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (p) => 0.2126 * chan(p[0]) + 0.7152 * chan(p[1]) + 0.0722 * chan(p[2]);
  const bgOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const p = parse(getComputedStyle(node).backgroundColor);
      if (p && (p.length === 3 || p[3] > 0.9)) return p.slice(0, 3);
      node = node.parentElement;
    }
    const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
    return bodyBg ? bodyBg.slice(0, 3) : [11, 17, 32];
  };
  const pathOf = (el) => {
    const bits = [];
    let node = el;
    while (node && node !== document.body && bits.length < 4) {
      let b = node.tagName.toLowerCase();
      if (node.getAttribute && node.getAttribute('aria-label')) b += '[aria-label="' + node.getAttribute('aria-label').slice(0, 24) + '"]';
      bits.unshift(b);
      node = node.parentElement;
    }
    return bits.join('>');
  };
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = walker.nextNode())) {
    const el = n;
    const text = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').trim();
    if (!text) continue;
    if (!/[A-Za-z0-9]/.test(text)) continue; // pure punctuation is decorative, not text under WCAG 1.4.3
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (parseFloat(cs.opacity) < 1) continue; // disabled / decorative states are exempt
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const ratio = (Math.max(lum(fg.slice(0, 3)), lum(bg)) + 0.05) / (Math.min(lum(fg.slice(0, 3)), lum(bg)) + 0.05);
    const fs = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = fs >= 24 || (fs >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need - 0.02) out.push({ text: text.slice(0, 40), fg: cs.color, bg: 'rgb(' + bg.join(',') + ')', ratio: +ratio.toFixed(2), need, path: pathOf(el) });
  }
  return out;
})()`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });

  const navTo = async (label) => {
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => /toggle navigation menu/i.test(b.getAttribute('aria-label') || ''))?.click();
    });
    await page.waitForFunction(
      (l) => [...document.querySelectorAll('nav button')].some((b) => b.textContent.trim() === l),
      { timeout: 10000 }, label,
    );
    await page.evaluate((l) => {
      [...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === l)?.click();
    }, label);
    await new Promise((r) => setTimeout(r, 900));
  };
  const clickButtonWithText = async (re) => {
    await page.evaluate((src) => {
      const rx = new RegExp(src, 'i');
      [...document.querySelectorAll('button')].find((b) => rx.test(b.textContent))?.click();
    }, re.source);
    await new Promise((r) => setTimeout(r, 900));
  };

  let failures = 0;
  const audit = async (screen) => {
    const violations = await page.evaluate(AUDIT);
    const ok = violations.length === 0;
    if (!ok) failures += violations.length;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${screen}${ok ? '' : ' — ' + violations.length + ' violation(s)'}`);
    for (const v of violations.slice(0, 12)) {
      console.log(`   ${v.ratio}:1 (needs ${v.need}) "${v.text}" fg=${v.fg} bg=${v.bg} @ ${v.path}`);
    }
  };

  for (const theme of ['dark', 'light']) {
    console.log(`=== theme: ${theme} ===`);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate((t) => localStorage.setItem('nahashield-theme', t), theme);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));

    await audit(`${theme}: savings landing`);

    await page.goto(`${BASE}/leakage`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    await audit(`${theme}: leakage check`);

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    await navTo('Intake');
    await audit(`${theme}: insurer intake`);

    await navTo('Example');
    await audit(`${theme}: worked-example landing`);

    await clickButtonWithText(/CLEAN CLAIM/);
    await audit(`${theme}: worked case 1 (clean claim)`);

    await navTo('Example');
    await clickButtonWithText(/FRAUD PATTERN/);
    await audit(`${theme}: worked case 2 (fraud pattern)`);

    await navTo('Example');
    await clickButtonWithText(/Load these cases into the live workspace/);
    await navTo('Investigate');
    await audit(`${theme}: investigator queue (seeded)`);

    await clickButtonWithText(/clock/);
    await audit(`${theme}: investigator case detail`);
  }

  await browser.close();
  console.log(failures === 0 ? 'CONTRAST AUDIT: all screens pass WCAG AA in both themes' : `CONTRAST AUDIT: ${failures} violation(s)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('E2E crashed:', e.message); process.exit(1); });
