/**
 * Wash test: get the ship under way and photograph the stern (prop wash) and
 * the bow (pushed water) from close range.
 * Usage: node tools/wash-test.mjs [tag]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TAG = process.argv[2] || 'wash';
const OUT = '/tmp/gb-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-proxy-server', '--proxy-bypass-list=*',
    '--window-size=1100,620', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 620, deviceScaleFactor: 1 });
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
await sleep(1200);

await page.evaluate(() => { window.__game.input.setThrottle(1); window.__game.advance(45); });
await sleep(1200);

// astern, low: the prop wash and wake trail
// (orbit offset is (sin t, ., cos t) * r, ship forward is +x, so theta = -pi/2
//  puts the camera directly astern)
await page.evaluate(() => {
  const g = window.__game;
  g.setCamera('orbit');
  g.rig.radius = 260; g.rig.phi = 1.46; g.rig.theta = -Math.PI / 2;
});
await sleep(2200);
await page.screenshot({ path: `${OUT}/${TAG}-stern.png` });

// off the bow: the pushed water / shoulder wave
await page.evaluate(() => {
  const g = window.__game;
  g.rig.radius = 210; g.rig.phi = 1.44; g.rig.theta = Math.PI / 2;
});
await sleep(2200);
await page.screenshot({ path: `${OUT}/${TAG}-bow.png` });

const st = await page.evaluate(() => ({
  speed: +window.__game.phys.speedKnots.toFixed(1),
  throttle: +window.__game.phys.throttle.toFixed(2),
  washThrottle: +window.__game.propWash.uniforms.uThrottle.value.toFixed(2),
}));
console.log('state:', JSON.stringify(st));
console.log('ERRORS:', errors.length ? errors.slice(0, 8) : '(none)');
await browser.close();
