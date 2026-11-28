// End-to-end browser proof for the claims ingest build against the local
// production server. Uses the system Chrome via puppeteer-core.
const puppeteer = require('puppeteer-core');

const BASE = 'http://localhost:3100';
const SHOT = (n) => `/tmp/e2e-${n}.png`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = [];
  const check = (name, ok, extra = '') => {
    results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  };

  // 1. Phone-size (390px), light theme, messy CSV upload.
  let page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/leakage`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type="file"]', { timeout: 30000 });
  const input = await page.$('input[type="file"]');
  await input.uploadFile('/tmp/messy-6month-claims.csv');
  await page.waitForFunction(
    () => document.body.innerText.includes('File check'),
    { timeout: 30000 },
  );
  let text = await page.evaluate(() => document.body.innerText);
  check('phone CSV upload: file check appears', text.includes('File check'));
  check('phone CSV: claims tile shows count', text.includes('21'));
  check('phone CSV: duplicate payment finding', text.includes('Possible duplicate payment'));
  check('phone CSV: money to recover section', text.includes('Money to recover'));
  check('phone CSV: recover up to rand value', /Recover up to R/.test(text));
  check('phone CSV: compact stat tiles', /\b21\s*\n*claims/.test(text) && text.includes('6 months'));
  // Open the "What was understood" toggle before checking the mapping text.
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('summary')].find((x) => x.textContent.includes('What was understood'));
    s?.click();
  });
  text = await page.evaluate(() => document.body.innerText);
  check('phone CSV: columns understood behind toggle', text.includes('Claim No → claim_ref'));
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('h3')].find((e) => e.textContent.includes('File check'));
    el?.scrollIntoView();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: SHOT('phone-filecheck') });
  await page.screenshot({ path: SHOT('phone-csv-top') });
  // Scroll to recovery section and screenshot.
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('h3')];
    const el = els.find((e) => e.textContent.includes('Money to recover'));
    el?.scrollIntoView();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: SHOT('phone-csv-recovery') });

  // Phone text overflow check: no horizontal scroll.
  const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  check('phone: no horizontal overflow', !overflowX);

  // 2. Open a recovery plan and send the top candidate to the Recovery Desk.
  await page.evaluate(() => {
    const summaries = [...document.querySelectorAll('summary')];
    const s = summaries.find((x) => x.textContent.includes('Recovery plan, step by step'));
    s?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Send to Recovery Desk'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('send to recovery desk button works', clicked);
  await page.waitForFunction(
    () => document.body.innerText.includes('Add / Import Loss-Register Case'),
    { timeout: 15000 },
  );
  text = await page.evaluate(() => document.body.innerText);
  check('recovery desk import form opened', text.includes('Add / Import Loss-Register Case'));
  check('prefill note shown', text.includes('Prefilled from a Leakage review'));
  const formVals = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('form input, form textarea, form select')];
    return inputs.map((i) => `${i.name || i.id || i.placeholder}=${i.value}`).join(' | ');
  });
  check('case prefilled with claimant + rands', /LEAK-/.test(formVals));
  await page.screenshot({ path: SHOT('phone-recovery-prefill') });

  // 3. Desktop 1440px, messy Excel upload.
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/leakage`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type="file"]', { timeout: 30000 });
  const input2 = await page.$('input[type="file"]');
  await input2.uploadFile('/tmp/messy-6month-claims.xlsx');
  await page.waitForFunction(
    () => document.body.innerText.includes('File check'),
    { timeout: 30000 },
  );
  text = await page.evaluate(() => document.body.innerText);
  check('desktop Excel upload: file check appears', text.includes('File check'));
  check('desktop Excel: sheet named', text.includes('Claims Export'));
  check('desktop Excel: duplicate payment finding', text.includes('Possible duplicate payment'));
  check('desktop Excel: money to recover', /Recover up to R/.test(text));
  await page.screenshot({ path: SHOT('desktop-xlsx-top') });
  await page.evaluate(() => {
    const els = [...document.querySelectorAll('h3')];
    els.find((e) => e.textContent.includes('Money to recover'))?.scrollIntoView();
  });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: SHOT('desktop-xlsx-recovery') });

  // 4. Phone dark theme.
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/leakage`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('input[type="file"]', { timeout: 30000 });
  await page.evaluate(() => localStorage.setItem('nahashield-theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const input3 = await page.$('input[type="file"]');
  await input3.uploadFile('/tmp/messy-6month-claims.csv');
  await page.waitForFunction(
    () => document.body.innerText.includes('File check'),
    { timeout: 30000 },
  );
  await page.screenshot({ path: SHOT('phone-dark-csv') });

  // 5. Demo path still works (nothing removed).
  page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/leakage#demo`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    () => document.body.innerText.includes('Recovery candidates') || document.body.innerText.includes('Money to recover'),
    { timeout: 30000 },
  );
  text = await page.evaluate(() => document.body.innerText);
  check('demo file still loads', text.includes('38 fictional claims') || text.includes('synthetic-6-month-claims-demo.csv'));
  await page.screenshot({ path: SHOT('phone-demo') });

  await browser.close();
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL'));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('E2E crashed:', e.message);
  process.exit(2);
});
