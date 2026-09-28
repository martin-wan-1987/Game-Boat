/** Perf probe: boot, start the game, measure frame-time distribution and
 *  renderer stats during free running + a large tsunami + camera switches.
 *
 *  Headless Chrome renders with SwiftShader (software GL), so absolute fps is
 *  NOT comparable to a real GPU — but draw calls, triangle counts, JS-side
 *  long frames and before/after ratios are.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--no-proxy-server', '--proxy-bypass-list=*',
    '--window-size=1280,720', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load', timeout: 90000 });

// wait for the loading bar AND the enter button to actually be enabled —
// the bar reads 100% one step before the button unlocks, and the synchronous
// shader compile after that can block for seconds. A click that lands once
// the button is on is queued by the browser and runs when the thread frees.
await page.waitForFunction(
  () => document.getElementById('barPct')?.textContent === '100%', { timeout: 120000 });
await page.waitForFunction(
  () => document.getElementById('enterBtn')?.classList.contains('on'), { timeout: 120000 });

// click through by waiting for each screen to actually appear — fixed sleeps
// race the shader compile on slow (software) renderers, and an input event
// dispatched while the main thread is inside that compile is occasionally
// dropped, so each hop retries until the UI state flips.
const clickAndWait = async (sel, cond) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.click(sel).catch(() => {});
    try {
      await page.waitForFunction(cond, { timeout: 8000 });
      return;
    } catch (_) { /* state didn't flip — click again */ }
  }
  throw new Error(`click-through failed: ${sel}`);
};
await clickAndWait('#enterBtn',
  () => !document.getElementById('lobby').classList.contains('hidden'));
await clickAndWait('#toMode',
  () => !document.getElementById('mode').classList.contains('hidden'));
await clickAndWait('#startGame', () => window.__game.running === true);
await new Promise((r) => setTimeout(r, 2500));

// draw-call accounting: let several frames accumulate without auto-reset
const calls = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  g.renderer.info.autoReset = false;
  g.renderer.info.reset();
  let n = 0;
  const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 800) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  await sleep(900);
  const { calls, triangles } = g.renderer.info.render;
  g.renderer.info.autoReset = true;
  return { perFrame: +(calls / Math.max(1, n)).toFixed(1),
           trisPerFrame: +(triangles / Math.max(1, n)).toFixed(0) };
});

const report = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // instrument the frame loop
  const frames = [];
  let last = performance.now();
  const t0 = last;
  const tick = () => {
    const now = performance.now();
    frames.push(now - last);
    last = now;
    if (now - t0 < 12000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // 4 s free running, then large tsunami, then camera cycling
  await sleep(4000);
  g.fireTsunami('large');
  await sleep(4000);
  for (const m of ['chase', 'bridge', 'orbit', 'cinema', 'deck']) {
    g.setCamera(m); await sleep(700);
  }
  await sleep(2500);

  const sorted = frames.slice().sort((a, b) => a - b);
  return {
    quality: g.quality,
    pixelRatioNow: g.renderer.getPixelRatio(),
    oceanSegNow: g.ocean.seg,
    govLogs: g.hud.logs.filter((l) => l.msg.includes('性能保护')).length,
    frames: frames.length,
    medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
    p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
    maxMs: +sorted[sorted.length - 1].toFixed(1),
    over100ms: frames.filter((f) => f > 100).length,
    geometries: g.renderer.info.memory.geometries,
    textures: g.renderer.info.memory.textures,
  };
});
console.log(JSON.stringify({ ...calls, ...report }, null, 2));
mkdirSync('tools/shots', { recursive: true });
await page.screenshot({ path: 'tools/shots/perf-after.png' });
console.log('ERRORS:', errs.length ? errs.slice(0, 10) : '(none)');
await browser.close();
