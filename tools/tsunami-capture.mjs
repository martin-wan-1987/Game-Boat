/**
 * Tsunami capture: fast-forwards the sim with game.advance() so we can see the
 * whole encounter despite the software renderer's low frame rate.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = '/tmp/gb-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1500,850', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 850 });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < 40; i++) {
  const v = await page.$eval('#barPct', (e) => e.textContent).catch(() => '0%');
  if (v === '100%') break;
  await sleep(500);
}
await sleep(1500);
await page.click('#enterBtn'); await sleep(1300);
await page.click('#toMode'); await sleep(1300);
await page.click('#startGame'); await sleep(3000);

const shot = async (name) => {
  await sleep(2600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
};

// get her under way
await page.evaluate(() => {
  const g = window.__game;
  g.input.setThrottle(1);
  g.advance(180);
  g.setCamera('chase');
});
console.log('under way:', await page.evaluate(() => JSON.stringify({
  kn: +window.__game.phys.speedKnots.toFixed(1),
  draft: +window.__game.phys.position.y.toFixed(2),
  integrity: +window.__game.damage.integrity.toFixed(1),
})));
await shot('t1-underway');

// fire a large tsunami
await page.evaluate(() => {
  const g = window.__game;
  g.fireTsunami('large');
  g.advance(20);
  g.setCamera('cinema');
});
await shot('t2-inbound');

// let it arrive
const track = [];
for (let i = 0; i < 9; i++) {
  const st = await page.evaluate(() => {
    const g = window.__game;
    g.advance(5);
    return {
      t: +g.time.toFixed(1),
      dist: Math.round(g.tsunami.distanceToCrest(g.phys.position)),
      roll: +(g.phys.attitude.roll * 57.3).toFixed(1),
      pitch: +(g.phys.attitude.pitch * 57.3).toFixed(1),
      kn: +g.phys.speedKnots.toFixed(1),
      integrity: +g.damage.integrity.toFixed(1),
      flood: +g.damage.flood.toFixed(3),
      state: g.tsunami.state,
      dmg: g.damage.state,
    };
  });
  track.push(st);
  if (i === 3) { await page.evaluate(() => window.__game.setCamera('orbit')); await shot('t3-impact'); }
  if (i === 5) await shot('t4-mid');
}
console.log(track.map((r) => JSON.stringify(r)).join('\n'));

await page.evaluate(() => {
  const g = window.__game;
  g.setCamera('orbit'); g.rig.radius = 330; g.rig.phi = 1.30; g.rig.theta = 1.3;
  g.advance(6);
});
await shot('t5-after');

const peak = await page.evaluate(() => {
  const g = window.__game;
  return JSON.stringify({
    peakRoll: +(g.tsunami.peakRoll * 57.3).toFixed(1),
    peakPitch: +(g.tsunami.peakPitch * 57.3).toFixed(1),
    integrity: +g.damage.integrity.toFixed(1),
    flood: +g.damage.flood.toFixed(3),
    dmgState: g.damage.state,
    fires: g.damage.fires.length,
    particles: g.particles.alive,
    wake: g.wake.pts.length,
  });
});
console.log('PEAK', peak);
console.log('ERRORS:', errs.length ? errs.slice(0, 8) : '(none)');
await browser.close();
