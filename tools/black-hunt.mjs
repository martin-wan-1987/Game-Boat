/**
 * Black-flash hunter: sails the ship (waves + slams), parks in each camera
 * rig, watches EVERY frame, and the instant a frame goes dark, captures a
 * full-resolution screenshot + context so the black thing can be identified
 * instead of guessed at.
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
page.on('pageerror', (e) => errors.push(e.message));
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
fs.mkdirSync('tools/shots', { recursive: true });

// per-frame watcher: flags dark frames and snapshots context
await page.evaluate(() => {
  window.__hunt = { frames: 0, dark: [], shotsTaken: 0 };
  const src = document.querySelector('#app canvas');
  const c = document.createElement('canvas');
  c.width = 160; c.height = 90;
  const g = c.getContext('2d');
  const tick = () => {
    const gme = window.__game;
    if (gme && gme.running) {
      window.__hunt.frames++;
      g.drawImage(src, 0, 0, 160, 90);
      const d = g.getImageData(0, 0, 160, 90).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
        if (lum < 12) dark++;
      }
      const r = dark / (160 * 90);
      if (r > 0.20 && window.__hunt.shotsTaken < 6) {
        window.__hunt.shotsTaken++;
        const cam = gme.camera.position;
        const wy = gme.field.heightAt(cam.x, cam.z);
        window.__hunt.dark.push({
          t: +gme.time.toFixed(1), mode: gme.rig.mode, r: +r.toFixed(2),
          camY: +cam.y.toFixed(1), waveAtCam: +wy.toFixed(1),
          under: cam.y < wy, shake: +gme.rig.shake.toFixed(2),
          slam: +gme.phys.slam.toFixed(2), sprayAlive: gme.particles.alive,
          uwOpacity: document.getElementById('underwater').style.opacity || '0',
        });
        window.__hunt['shot' + window.__hunt.shotsTaken] = true;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

// sail into the sea at speed so she works (spray, slams, shake)
await page.evaluate(() => {
  const g = window.__game;
  g.phys.throttle = 0.75; g.input.setThrottle(0.75);
});

const modes = ['orbit', 'bridge', 'deck', 'chase', 'cinema'];
let shotIdx = 0;
for (const m of modes) {
  await page.evaluate((mm) => {
    const g = window.__game;
    g.setCamera(mm);
    if (mm === 'orbit') { g.rig.radius = 90; g.rig.phi = 1.05; }
    g.advance(10);            // let waves develop around her
  }, m);
  // capture during real rendering; screenshots on dark frames
  for (let s = 0; s < 7; s++) {
    const flagged = await page.evaluate(() => {
      const before = window.__hunt.shotsTaken;
      // expose a flag to outside via evaluate return
      return new Promise((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          res({ before, after: window.__hunt.shotsTaken });
        }));
      });
    });
    await sleep(3000);
    const after = await page.evaluate(() => window.__hunt.shotsTaken);
    if (after > flagged.before) {
      shotIdx++;
      await page.screenshot({ path: `tools/shots/blackflash-${shotIdx}.png` });
      console.log(`captured blackflash-${shotIdx} (${m})`);
    }
  }
}
const hunt = await page.evaluate(() => window.__hunt);
console.log(JSON.stringify({ frames: hunt.frames, darkCount: hunt.dark.length,
  dark: hunt.dark }, null, 1));
console.log('ERRORS:', errors.length ? errors.slice(0, 4) : '(none)');
await browser.close();
