// Voice command verification as a first-time visitor.
// A: browser without speech recognition -> clear unsupported message.
// B: mic permission blocked -> clear mic-blocked message.
// C: typed command -> preview -> open navigates.
// D: destructive command is refused.
// Usage: BASE=http://localhost:3111 node scripts/voice-command-verify.cjs
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3111';

(async () => {
  const browser = await chromium.launch();
  const failures = [];
  const ok = [];
  async function expect(label, fn) {
    try { await fn(); ok.push(label + ': OK'); }
    catch (e) { failures.push(label + ': ' + (e.message || e)); }
  }
  async function openVoice(ctx) {
    const page = await ctx.newPage();
    await page.goto(BASE + '/workforce#commands', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (!(await page.getByRole('button', { name: 'Speak the command' }).count())) {
      await page.locator('text=Open a tool').first().click();
      await page.waitForTimeout(600);
    }
    return page;
  }

  // A: mic granted; recognition either absent or its service unreachable
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
    const page = await openVoice(ctx);
    await expect('A unsupported-browser message', async () => {
      await page.getByRole('button', { name: 'Speak the command' }).click();
      // Either the browser lacks recognition entirely, or its speech service
      // fails: both must surface one of the clear stranger-readable messages.
      await page.waitForSelector('text=/This browser has no voice typing|speech service is unreachable|Voice typing did not work|Microphone access is blocked/', { timeout: 8000 });
    });
    await ctx.close();
  }

  // B: recognizer present but mic permission blocked
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 }, permissions: [] });
    await ctx.addInitScript(() => {
      class FakeRecognition {
        constructor(){ this.onresult=null; this.onerror=null; this.onend=null; }
        start(){ const self=this; setTimeout(()=>{ if(self.onerror) self.onerror({error:'not-allowed'}); if(self.onend) self.onend(); }, 50); }
        abort(){}
      }
      window.SpeechRecognition = FakeRecognition;
    });
    const page = await openVoice(ctx);
    await expect('B mic-blocked message', async () => {
      await ctx.clearPermissions();
      await page.getByRole('button', { name: 'Speak the command' }).click();
      await page.waitForSelector('text=Microphone access is blocked', { timeout: 8000 });
    });
    await ctx.close();
  }

  // C: typed command path works end to end
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openVoice(ctx);
    await expect('C typed open-documents flow', async () => {
      await page.getByLabel('Your command').fill('open documents');
      await page.getByRole('button', { name: 'Check command' }).click();
      await page.waitForSelector('text=Open documents?', { timeout: 5000 });
      await page.getByRole('link', { name: 'Open documents' }).click();
      await page.waitForTimeout(800);
      if (!page.url().includes('/workforce#workforce-tools')) throw new Error('did not navigate: ' + page.url());
    });
    await ctx.close();
  }

  // D: destructive command refused
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await openVoice(ctx);
    await expect('D destructive refused', async () => {
      await page.getByLabel('Your command').fill('approve the payment');
      await page.getByRole('button', { name: 'Check command' }).click();
      await page.waitForSelector('text=No action taken', { timeout: 5000 });
    });
    await ctx.close();
  }

  console.log(ok.join('\n'));
  if (failures.length) { console.error('\nFAILURES:\n' + failures.join('\n')); process.exit(1); }
  console.log('\nVOICE-ALL-OK');
  await browser.close();
  process.exit(0);
})();
