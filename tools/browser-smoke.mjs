/**
 * Browser smoke test: loads the game in real Chrome, walks the screen flow,
 * fires a tsunami and reports every console error / page error.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const URL = process.env.GB_URL || 'http://127.0.0.1:8765/index.html';
const OUT = '/tmp/gb-shots';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const logs = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--headless=new',
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--window-size=1600,900',
    '--mute-audio',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });

page.on('console', (m) => {
  const t = m.type();
  logs.push(`[${t}] ${m.text()}`);
  if (t === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`REQFAIL: ${r.url()} ${r.failure()?.errorText}`));

await page.goto(URL, { waitUntil: 'load', timeout: 60000 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- loading screen ----
await sleep(1200);
const p1 = await page.$eval('#barPct', (e) => e.textContent).catch(() => '?');
await page.screenshot({ path: `${OUT}/1-loading.png` });
console.log('loading bar after 1.2s:', p1);

// wait for the loading sequence to finish
for (let i = 0; i < 60; i++) {
  const pct = await page.$eval('#barPct', (e) => e.textContent).catch(() => '0%');
  if (pct === '100%') break;
  await sleep(500);
}
await sleep(1200);
const p2 = await page.$eval('#barPct', (e) => e.textContent).catch(() => '?');
console.log('loading bar final:', p2);
await page.screenshot({ path: `${OUT}/2-loaded.png` });

// ---- enter lobby ----
const enterOn = await page.$eval('#enterBtn', (e) => e.classList.contains('on'));
console.log('enter button enabled:', enterOn);
if (enterOn) {
  await page.click('#enterBtn');
  await sleep(900);
  await page.screenshot({ path: `${OUT}/3-lobby.png` });

  await page.click('#toMode');
  await sleep(700);
  await page.screenshot({ path: `${OUT}/4-mode.png` });

  await page.click('#startGame');
  await sleep(3500);
  await page.screenshot({ path: `${OUT}/5-game.png` });

  // check the renderer actually produced pixels
  const stats = await page.evaluate(() => {
    const g = window.__game;
    return {
      running: g?.running,
      quality: g?.quality,
      patches: g?.phys?.patches?.length,
      draft: g?.phys?.position?.y,
      cameraMode: g?.rig?.mode,
      drawCalls: g?.renderer?.info?.render?.calls,
      triangles: g?.renderer?.info?.render?.triangles,
      programs: g?.renderer?.info?.programs?.length,
    };
  });
  console.log('render stats:', JSON.stringify(stats));

  // full ahead, then fire a large tsunami
  await page.evaluate(() => { window.__game.input.setThrottle(1); });
  await sleep(6000);
  await page.evaluate(() => { window.__game.fireTsunami('large'); });
  await sleep(9000);
  await page.screenshot({ path: `${OUT}/6-tsunami-inbound.png` });

  const t1 = await page.evaluate(() => {
    const g = window.__game;
    return {
      state: g.tsunami.state, height: +g.tsunami.height.toFixed(2),
      dist: Math.round(g.tsunami.distanceToCrest(g.phys.position)),
      speed: +g.phys.speedKnots.toFixed(1),
      roll: +(g.phys.attitude.roll * 57.3).toFixed(2),
      pitch: +(g.phys.attitude.pitch * 57.3).toFixed(2),
      draft: +g.phys.position.y.toFixed(2),
    };
  });
  console.log('inbound:', JSON.stringify(t1));

  // watch the encounter
  let peak = { roll: 0, pitch: 0, speed: 0 };
  for (let i = 0; i < 26; i++) {
    await sleep(1000);
    const s = await page.evaluate(() => {
      const g = window.__game;
      return {
        roll: Math.abs(g.phys.attitude.roll * 57.3),
        pitch: Math.abs(g.phys.attitude.pitch * 57.3),
        speed: g.phys.speedKnots,
        state: g.tsunami.state,
        integrity: g.damage.integrity,
        flood: g.damage.flood,
        dmg: g.damage.state,
        fps: g._fps || 0,
      };
    });
    peak.roll = Math.max(peak.roll, s.roll);
    peak.pitch = Math.max(peak.pitch, s.pitch);
    peak.speed = Math.max(peak.speed, s.speed);
    if (i % 4 === 0) console.log(`  t+${i}s`, JSON.stringify(s));
    if (s.state === 'idle' && i > 6) break;
  }
  console.log('PEAK during encounter:', JSON.stringify(peak));
  await page.screenshot({ path: `${OUT}/7-encounter.png` });

  // orbit the camera to check the 360 view
  await page.evaluate(() => {
    const g = window.__game;
    g.setCamera('orbit');
    g.rig.radius = 260; g.rig.phi = 1.35; g.rig.theta = 1.9;
  });
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/8-orbit-close.png` });

  await page.evaluate(() => { const g = window.__game; g.setCamera('bridge'); });
  await sleep(2000);
  await page.screenshot({ path: `${OUT}/9-bridge.png` });

  await page.evaluate(() => { const g = window.__game; g.setCamera('chase'); });
  await sleep(2500);
  await page.screenshot({ path: `${OUT}/10-chase.png` });
}

console.log('\n===== CONSOLE ERRORS =====');
if (errors.length === 0) console.log('(none)');
else errors.slice(0, 40).forEach((e) => console.log(e));

console.log('\n===== LAST LOGS =====');
logs.slice(-25).forEach((l) => console.log(l));

await browser.close();
