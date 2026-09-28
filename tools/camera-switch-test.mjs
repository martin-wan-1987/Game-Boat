/**
 * Camera-switch test.
 *
 * Reproduces the "black things flash when I change view" bug: it switches to
 * each rig and captures a burst of frames right after the switch, then reports
 * the fraction of near-black pixels in each. A view that is momentarily inside
 * the hull shows up as a spike in `dark`.
 *
 * Usage: node tools/camera-switch-test.mjs [tag]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TAG = process.argv[2] || 'cam';
const OUT = '/tmp/gb-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-proxy-server', '--proxy-bypass-list=*',
    '--window-size=1280,720', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load', timeout: 90000 });

async function until(fn, label, timeout = 120000) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timeout: ${label}`);
    await sleep(300);
  }
}

await until(() => document.getElementById('barPct')?.textContent === '100%', 'loading');
await until(() => document.getElementById('enterBtn')?.classList.contains('on'), 'enter');
const tap = (id) => page.evaluate((i) => document.getElementById(i).click(), id);
await tap('enterBtn');
await until(() => !document.getElementById('lobby').classList.contains('hidden'), 'lobby');
await tap('toMode');
await until(() => !document.getElementById('mode').classList.contains('hidden'), 'mode');
await tap('startGame');
await until(() => window.__game?.running === true, 'running');
await sleep(2000);

// make way so the wake/foam are active, and give the renderer a warm-up
await page.evaluate(() => { window.__game.input.setThrottle(0.85); window.__game.advance(90); });
await sleep(1500);

/**
 * Switch to `mode` and capture N frames as fast as puppeteer will go, returning
 * the dark-pixel fraction of each. Dark = all channels < 26 (the hull interior
 * and unlit backfaces read as near-black).
 */
async function probe(mode, frames = 6) {
  await page.evaluate((m) => window.__game.setCamera(m), mode);
  const darks = [];
  for (let i = 0; i < frames; i++) {
    const d = await page.evaluate(() => new Promise((res) => {
      requestAnimationFrame(() => {
        const src = document.querySelector('canvas');
        const tmp = document.createElement('canvas');
        tmp.width = 256; tmp.height = 144;
        const ctx = tmp.getContext('2d');
        ctx.drawImage(src, 0, 0, 256, 144);
        let dark = 0;
        try {
          const px = ctx.getImageData(0, 0, 256, 144).data;
          for (let k = 0; k < px.length; k += 4) {
            if (px[k] < 26 && px[k + 1] < 26 && px[k + 2] < 26) dark++;
          }
        } catch (_) { return res(-1); }        // tainted / empty buffer
        res(dark / (256 * 144));
      });
    }));
    darks.push(d);
    await page.screenshot({ path: `${OUT}/${TAG}-${mode}-${i}.png` });
  }
  return darks;
}

const modes = ['orbit', 'bridge', 'deck', 'chase'];
const report = {};
for (const m of modes) {
  const d = await probe(m, 3);
  report[m] = d.map((x) => +(x * 100).toFixed(1));
  console.log(`${m.padEnd(8)} dark% per frame:`, report[m].join('  '));
  await sleep(600);
}

console.log('\nERRORS:', errors.length ? errors.slice(0, 10) : '(none)');
await browser.close();
