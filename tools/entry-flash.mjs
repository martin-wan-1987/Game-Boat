/**
 * Entry-flash probe: measures the near-black pixel ratio on EVERY frame from
 * the moment the game starts, for the first ~6 s. The suspected bug: at boot
 * the camera sits at the world origin (inside the hull); startGame does not
 * set the rig's one-frame snap, so the first frames lerp *through* the hull
 * and render its unlit DoubleSide interior — a black flash at entry.
 */
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const errors = [];
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-proxy-server', '--proxy-bypass-list=*',
    '--window-size=1280,720', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, t = 90000) {
  for (const t0 = Date.now();;) {
    if (await page.evaluate(fn)) return;
    if (Date.now() - t0 > t) throw new Error('timeout');
    await sleep(300);
  }
}
const tap = (id) => page.evaluate((i) => document.getElementById(i).click(), id);

await until(() => document.getElementById('barPct')?.textContent === '100%');
await until(() => document.getElementById('enterBtn')?.classList.contains('on'));
tap('enterBtn'); await sleep(800);
tap('toMode'); await sleep(800);

// install the per-frame instrument BEFORE clicking start, so the very first
// rendered frames of the game are captured (polling after would miss them)
const install = () => page.evaluate(() => {
  window.__entrySeries = [];
  const src = document.querySelector('#app canvas');
  const c = document.createElement('canvas');
  c.width = 160; c.height = 90;
  const g = c.getContext('2d');
  const n = 160 * 90;
  const t0 = performance.now();
  const tick = () => {
    g.drawImage(src, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let black = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (lum < 12) black++;
    }
    window.__entrySeries.push(+(black / n).toFixed(3));
    if (performance.now() - t0 < 6000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await install();
tap('startGame');
await until(() => window.__game?.running === true);
await sleep(6000);
const series = await page.evaluate(() => window.__entrySeries);

const bad = series.map((v, i) => [i, v]).filter(([, v]) => v > 0.15);
console.log(`frames: ${series.length}`);
console.log(`first 12: ${series.slice(0, 12).map((v) => (v * 100).toFixed(0)).join(' ')}`);
console.log(`frames >15% black: ${bad.length ? bad.map(([i, v]) => `#${i}(${(v * 100).toFixed(0)}%)`).join(' ') : 'none'}`);
console.log('ERRORS:', errors.length ? errors.slice(0, 6) : '(none)');
await browser.close();
