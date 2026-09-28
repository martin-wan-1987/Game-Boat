/** Minimal boot check: load the page, report errors and loading progress. */
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-proxy-server', '--proxy-bypass-list=*',
    '--window-size=900,520', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 520, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('requestfailed', (r) => errs.push(`REQFAIL ${r.url()} ${r.failure()?.errorText}`));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load', timeout: 90000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 10; i++) {
  await sleep(4000);
  const s = await page.evaluate(() => ({
    pct: document.getElementById('barPct')?.textContent,
    msg: document.getElementById('barMsg')?.textContent,
    game: !!window.__game,
    q: window.__game?.quality,
  }));
  console.log(`t+${(i + 1) * 4}s`, JSON.stringify(s));
  if (s.pct === '100%') break;
}
console.log('ERRORS:', errs.length ? errs.slice(0, 12) : '(none)');
await browser.close();
