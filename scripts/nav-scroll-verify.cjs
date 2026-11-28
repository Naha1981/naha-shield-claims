// Nav route-change scroll/focus verification.
// For every primary-nav item: scroll down, click, assert scrollTop 0 and the
// page heading focused + in view. Covers desktop expanded, desktop collapsed,
// and mobile. Usage: BASE=http://localhost:3111 node scripts/nav-scroll-verify.cjs
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3111';

async function assertTop(page, label) {
  await page.waitForTimeout(350);
  const res = await page.evaluate(() => {
    const main = document.querySelector('main.ns-main');
    const h1 = (main || document).querySelector('h1');
    const r = h1 ? h1.getBoundingClientRect() : null;
    return {
      scrollY: window.scrollY,
      mainTop: main ? main.scrollTop : 0,
      h1InView: !!r && r.top >= 0 && r.top < window.innerHeight,
      h1Focused: document.activeElement === h1,
    };
  });
  const ok = res.scrollY === 0 && res.mainTop === 0 && res.h1InView && res.h1Focused;
  if (!ok) throw new Error(`${label}: FAIL ${JSON.stringify(res)}`);
  return label;
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const failures = [];

  async function run(label, width, { collapsed = false, mobile = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 850 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => failures.push(`${label} pageerror: ${e}`));
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (collapsed) {
      await page.click('button[aria-label="Collapse navigation"]');
      await page.waitForTimeout(300);
    }
    const navSel = mobile
      ? 'aside nav[aria-label="Primary modules"] button'
      : 'nav[aria-label="Primary modules"] button';
    const count = await page.locator(navSel).count();
    if (!count) throw new Error(`${label}: no nav buttons found`);
    for (let i = 0; i < count; i++) {
      if (mobile) {
        await page.click('button[aria-label="Toggle navigation menu"]');
        await page.waitForTimeout(400);
      }
      // scroll down first, then click nav item i
      await page.evaluate(() => window.scrollTo(0, 900));
      await page.waitForTimeout(150);
      const btn = page.locator(navSel).nth(i);
      const name = (await btn.getAttribute('aria-label')) || `item-${i}`;
      await btn.click();
      try {
        await assertTop(page, `${label} -> ${name}`);
        results.push(`${label} -> ${name}: OK`);
      } catch (e) {
        failures.push(String(e.message || e));
      }
    }
    await ctx.close();
  }

  await run('desktop-expanded', 1280);
  await run('desktop-collapsed', 1280, { collapsed: true });
  await run('mobile', 390, { mobile: true });

  console.log(results.join('\n'));
  if (failures.length) {
    console.error('\nFAILURES:\n' + failures.join('\n'));
    process.exit(1);
  }
  console.log(`\nNAV-SCROLL-ALL-OK (${results.length} checks)`);
  await browser.close();
  process.exit(0);
})();
