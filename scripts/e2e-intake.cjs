// Phone-size visual + functional check of the /intake screen.
const puppeteer = require('puppeteer-core');
const BASE = 'http://localhost:3100';
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const results = [];
  const check = (n, ok, extra='') => results.push(`${ok?'PASS':'FAIL'} ${n}${extra?' — '+extra:''}`);
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/intake`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body.innerText.includes('Bring claims in'), { timeout: 30000 });
  let text = await page.evaluate(() => document.body.innerText);
  check('intake: header', text.includes('Bring claims in'));
  check('intake: sign-in OFF warning text', text.includes('Sign-in is OFF') && text.includes('only go in once sign-in is ON and Thabiso agrees'));
  check('intake: connector cards listed', text.includes('Liberty') && text.includes('Momentum') && text.includes('Any insurer'));
  check('intake: mock-proven badges', (text.match(/Proven on mock feed/g)||[]).length >= 3);
  // Test connection on Liberty (mock endpoint prefilled).
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Test connection');
    btns[0].click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Nothing was stored'), { timeout: 30000 });
  text = await page.evaluate(() => document.body.innerText);
  check('intake: liberty test-connection plain answer', text.includes('Connected. First page holds 16 claim rows'));
  // Pull claims from generic mock.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Pull claims');
    btns[2].click();
  });
  await page.waitForFunction(() => document.body.innerText.includes('Open findings in Leakage check'), { timeout: 30000 });
  text = await page.evaluate(() => document.body.innerText);
  check('intake: pull results stats', text.includes('11') && text.includes('findings'));
  check('intake: File check card reuses', text.includes('File check'));
  await page.screenshot({ path: '/tmp/e2e-phone-intake.png' });
  // no horizontal scroll
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('intake: no horizontal scroll on phone', overflow <= 1, `overflow=${overflow}px`);
  // "Open findings in Leakage check" handoff
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Open findings in Leakage check')); b.click(); });
  await page.waitForFunction(() => document.body.innerText.includes('From Intake'), { timeout: 30000 });
  text = await page.evaluate(() => document.body.innerText);
  check('intake: handoff to Leakage check works', text.includes('From Intake'));
  await page.screenshot({ path: '/tmp/e2e-phone-intake-handoff.png' });
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(()=>{});
  // dark mode (real toggle: localStorage + reload)
  await page.evaluate(() => localStorage.setItem('nahashield-theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Bring claims in'), { timeout: 30000 });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: '/tmp/e2e-phone-intake-dark.png' });
  const darkBg = await page.evaluate(() => getComputedStyle(document.querySelector('.network-box')).backgroundColor);
  check('intake: dark theme box is dark', darkBg === 'rgb(19, 44, 41)', darkBg);
  await page.evaluate(() => localStorage.setItem('nahashield-theme', 'light'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Bring claims in'), { timeout: 30000 });
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => { console.error('E2E ERROR', e.message); process.exit(1); });
