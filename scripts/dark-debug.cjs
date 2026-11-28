const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto('http://localhost:3100/intake', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Bring claims in'), { timeout: 30000 });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); });
  await new Promise(r => setTimeout(r, 300));
  const info = await page.evaluate(() => {
    const out = {};
    const h = document.querySelector('.network-page > header');
    const h2 = document.querySelector('.network-page h2');
    const h3 = document.querySelector('.network-box h3');
    const pageTitle = [...document.querySelectorAll('h1,h2')].map(e => ({tag:e.tagName, cls:e.className, text:e.textContent.slice(0,20), color:getComputedStyle(e).color}));
    out.headerBg = h ? getComputedStyle(h).background : 'none';
    out.h2color = h2 ? getComputedStyle(h2).color : 'none';
    out.h3color = h3 ? getComputedStyle(h3).color : 'none';
    out.titles = pageTitle.slice(0,4);
    return out;
  });
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
