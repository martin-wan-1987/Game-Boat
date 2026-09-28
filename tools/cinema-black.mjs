/**
 * Cinema-view black-screen probe. The cinema rig parks ahead-and-aboard of
 * the ship to watch the tsunami arrive — which means the wave passes THROUGH
 * the camera before it reaches the ship. This probe records, per frame:
 * black-pixel ratio, camera position, the wave height at the camera, and
 * camera-under-water state; screenshots are saved around the darkest frames.
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

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
await page.waitForFunction(() => document.getElementById('barPct')?.textContent === '100%', { timeout: 120000 });
await page.waitForFunction(() => document.getElementById('enterBtn')?.classList.contains('on'), { timeout: 120000 });
const hop = async (sel, cond) => {
  for (let a = 0; a < 6; a++) {
    await page.click(sel).catch(() => {});
    try { await page.waitForFunction(cond, { timeout: 8000 }); return; } catch (_) {}
  }
  throw new Error('fail ' + sel);
};
await hop('#enterBtn', () => !document.getElementById('lobby').classList.contains('hidden'));
await hop('#toMode', () => !document.getElementById('mode').classList.contains('hidden'));
await hop('#startGame', () => window.__game.running === true);
await page.evaluate(() => {
  window.__game.setCamera('cinema');
  window.__cineFrames = [];
  const src = document.querySelector('#app canvas');
  const c = document.createElement('canvas');
  c.width = 160; c.height = 90;
  const g = c.getContext('2d');
  const n = 160 * 90;
  const tick = () => {
    const gme = window.__game;
    const cam = gme.camera.position;
    const wy = gme.field.heightAt(cam.x, cam.z);
    g.drawImage(src, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let black = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (lum < 12) black++;
    }
    window.__cineFrames.push({
      t: +gme.time.toFixed(1),
      black: +(black / n).toFixed(3),
      camY: +cam.y.toFixed(1),
      waveAtCam: +wy.toFixed(1),
      under: cam.y < wy,
      distToCrest: isFinite(gme.tsunami.distanceToCrest(gme.phys.position))
        ? Math.round(gme.tsunami.distanceToCrest(gme.phys.position)) : null,
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await sleep(1500);
await page.evaluate(() => window.__game.fireTsunami('large'));
await sleep(45000);

const frames = await page.evaluate(() => window.__cineFrames);
const bad = frames.filter((f) => f.black > 0.3);
console.log(`frames: ${frames.length}, >30% black: ${bad.length}`);
if (bad.length) {
  console.log('worst 12:', JSON.stringify(
    bad.slice().sort((a, b) => b.black - a.black).slice(0, 12), null, 1));
  const underCount = bad.filter((f) => f.under).length;
  console.log(`of those, camera underwater: ${underCount}/${bad.length}`);
}
fs.mkdirSync('tools/shots', { recursive: true });
await page.screenshot({ path: 'tools/shots/cinema-end.png' });
console.log('ERRORS:', errors.length ? errors.slice(0, 5) : '(none)');
await browser.close();
