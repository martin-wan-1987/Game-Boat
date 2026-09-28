/**
 * Visual check: load, start, park the camera at several angles, screenshot.
 * Usage: node tools/visual-check.mjs [tag]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TAG = process.argv[2] || 'v';
const OUT = '/tmp/gb-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1600,900', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });

await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for a condition inside the page (robust against a starved CPU). */
async function until(fn, label, timeout = 120000) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(300);
  }
}

await until(() => document.getElementById('barPct')?.textContent === '100%', 'loading');
await until(() => document.getElementById('enterBtn')?.classList.contains('on'), 'enter button');
await sleep(400);
const tap = (id) => page.evaluate((i) => document.getElementById(i).click(), id);
await tap('enterBtn');
await until(() => !document.getElementById('lobby').classList.contains('hidden'), 'lobby');
await sleep(700);
await tap('toMode');
await until(() => !document.getElementById('mode').classList.contains('hidden'), 'mode');
await sleep(700);
await tap('startGame');
await until(() => window.__game?.running === true, 'game running');
await sleep(2500);

// hide the HUD for clean beauty shots
const shot = async (name, cam, extra = {}) => {
  await page.evaluate((c, e) => {
    const g = window.__game;
    g.setCamera(c);
    Object.assign(g.rig, e);
  }, cam, extra);
  await sleep(2600);
  await page.screenshot({ path: `${OUT}/${TAG}-${name}.png` });
};

await page.evaluate(() => {
  const g = window.__game;
  g.input.setThrottle(0.6);
  g.advance(150);          // fast-forward so she is making way
});
await sleep(2500);

await shot('orbit-side', 'orbit', { radius: 520, phi: 1.24, theta: 1.55 });
await shot('orbit-bow', 'orbit', { radius: 430, phi: 1.30, theta: 0.05 });
await shot('orbit-high', 'orbit', { radius: 780, phi: 0.85, theta: 2.5 });
await shot('chase', 'chase');
await shot('deck', 'deck');
await shot('bridge', 'bridge');

// close-up on the deck markings, no HUD
await page.evaluate(() => { document.getElementById('hud').style.opacity = '0'; });
await shot('deck-detail', 'orbit', { radius: 190, phi: 1.05, theta: 2.2 });
await shot('waterline', 'orbit', { radius: 200, phi: 1.5, theta: 3.05 });
await page.evaluate(() => { document.getElementById('hud').style.opacity = '1'; });

const st = await page.evaluate(() => {
  const g = window.__game;
  return {
    speed: +g.phys.speedKnots.toFixed(1),
    draft: +g.phys.position.y.toFixed(2),
    integrity: +g.damage.integrity.toFixed(1),
    flood: +g.damage.flood.toFixed(3),
    dmgState: g.damage.state,
    seaAmps: Array.from({ length: 8 }, (_, i) => +g.ocean.uniforms.uSeaA.value[i].z.toFixed(2)),
    seaLens: Array.from({ length: 8 }, (_, i) => +(2 * Math.PI / g.ocean.uniforms.uSeaB.value[i].x).toFixed(0)),
  };
});
console.log(JSON.stringify(st));
console.log('ERRORS:', errors.length ? errors.slice(0, 12) : '(none)');
await browser.close();
