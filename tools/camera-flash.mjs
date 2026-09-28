/**
 * Camera-flash probe.
 *
 * Switches camera modes and captures a burst of frames immediately after each
 * switch, because the black-flash bug is transient: it lives in the two or
 * three frames while the rig interpolates between views. Screenshots are
 * written to /tmp/gb-shots/flash-*.png and the in-page black-pixel ratio is
 * reported per frame.
 *
 * Usage: node tools/camera-flash.mjs [tag]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TAG = process.argv[2] || 'f';
const OUT = '/tmp/gb-shots';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, label, t = 90000) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return;
    if (Date.now() - t0 > t) throw new Error('timeout ' + label);
    await sleep(300);
  }
}
const tap = (id) => page.evaluate((i) => document.getElementById(i).click(), id);

await until(() => document.getElementById('barPct')?.textContent === '100%', 'load');
await until(() => document.getElementById('enterBtn')?.classList.contains('on'), 'enter');
await tap('enterBtn'); await sleep(600);
await tap('toMode'); await sleep(600);
await tap('startGame');
await until(() => window.__game?.running === true, 'running');
await sleep(2500);

async function blackRatio() {
  return page.evaluate(() => new Promise((res) => {
    requestAnimationFrame(() => {
      const src = document.querySelector('#app canvas');
      const c = document.createElement('canvas');
      c.width = 320; c.height = 180;
      const g = c.getContext('2d');
      g.drawImage(src, 0, 0, 320, 180);
      const d = g.getImageData(0, 0, 320, 180).data;
      let black = 0; const n = 320 * 180;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (lum < 12) black++;
      }
      res(+(black / n).toFixed(4));
    });
  }));
}

const modes = ['bridge', 'deck', 'chase', 'cinema', 'orbit', 'bridge', 'orbit'];
for (const m of modes) {
  await page.evaluate((mm) => window.__game.setCamera(mm), m);
  const row = [];
  for (let i = 0; i < 5; i++) {
    row.push(await blackRatio());
    await page.screenshot({ path: `${OUT}/flash-${TAG}-${m}-${i}.png` });
  }
  console.log(`${m.padEnd(8)} black%: ${row.map((v) => (v * 100).toFixed(1)).join(' ')}`);
}

console.log('ERRORS:', errors.length ? errors.slice(0, 8) : '(none)');
await browser.close();
