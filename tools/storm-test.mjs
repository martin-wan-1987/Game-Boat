/**
 * Storm / cockpit test: fire a large tsunami, let the squall build, then grab
 * the bridge (first-person, should show wet glass + wipers) and an orbit view.
 * Usage: node tools/storm-test.mjs [tag]
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TAG = process.argv[2] || 'storm';
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
await sleep(1500);

// get under way, then bring on the big one
await page.evaluate(() => { window.__game.input.setThrottle(0.9); window.__game.advance(80); });
await page.evaluate(() => window.__game.fireTsunami('large'));
await page.evaluate(() => window.__game.advance(14));   // squall builds, wave closes
await sleep(1200);

const st = await page.evaluate(() => ({
  storm: +window.__game.storm.toFixed(2),
  tsuState: window.__game.tsunami.state,
  dist: Math.round(window.__game.tsunami.distanceToCrest(window.__game.phys.position)),
}));
console.log('state:', JSON.stringify(st));

// first-person bridge: should show wet glass + wipers
await page.evaluate(() => window.__game.setCamera('bridge'));
await sleep(2500);
await page.screenshot({ path: `${OUT}/${TAG}-bridge-a.png` });
await page.evaluate(() => window.__game.advance(1.6));
await sleep(2000);
await page.screenshot({ path: `${OUT}/${TAG}-bridge-b.png` });

// watch the wave arrive from outside
await page.evaluate(() => {
  const g = window.__game;
  g.setCamera('orbit');
  g.rig.radius = 300; g.rig.phi = 1.30; g.rig.theta = 0.15;
});
await sleep(2500);
await page.screenshot({ path: `${OUT}/${TAG}-orbit-wave.png` });

const st2 = await page.evaluate(() => ({
  storm: +window.__game.storm.toFixed(2),
  roll: +(window.__game.phys.attitude.roll * 57.3).toFixed(1),
  draft: +window.__game.phys.position.y.toFixed(2),
  rainVisible: window.__game.rain.mesh.visible,
}));
console.log('after:', JSON.stringify(st2));
console.log('ERRORS:', errors.length ? errors.slice(0, 8) : '(none)');
await browser.close();
