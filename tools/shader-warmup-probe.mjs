/** Current-candidate browser gates. Import in the existing Ego Node runtime:
 *   const task=await taskSpace(5);
 *   const {verifyShaders}=await import("/absolute/repo/tools/shader-warmup-probe.mjs");
 *   await verifyShaders(task);
 * Individual exported trials let the caller resume between bounded rounds.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUTPUT = fileURLToPath(new URL('../qa/2026-10-02/realism/', import.meta.url));
const MODES = ['orbit', 'bridge', 'deck', 'chase', 'cinema'];
// Acceptance requirements from HANDOFF.md, independent of production values.
const CLEARANCE = { orbit: 6, chase: 12, cinema: 22, bridge: 1.2, deck: 1.2 };
const DARK_RATIO = .20;

export async function preparePage(page) {
  await page.cdp('Page.bringToFront');
  await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
}

export async function installTrace(page) {
  return page.evaluate(() => {
    const g = __game, gl = g.renderer.getContext();
    const originalRender = g.render;
    const originals = Object.fromEntries(['compileShader', 'linkProgram'].map(k => [k, gl[k]]));
    const trace = { calls: [], frames: [], errors: [], phase: 'selection', originalRender, originals };
    trace.programs = () => g.renderer.info.programs.map(p => ({ id: p.id, name: p.name, key: p.cacheKey })).sort((a, b) => a.id - b.id);
    trace.error = event => trace.errors.push({ phase: trace.phase, message: event.message });
    window.addEventListener('error', trace.error);
    trace.shaderError = g.renderer.debug.onShaderError;
    g.renderer.debug.onShaderError = (context, program, vertex, fragment) => {
      trace.errors.push({ phase: trace.phase, program: context.getProgramInfoLog(program), vertex: context.getShaderInfoLog(vertex), fragment: context.getShaderInfoLog(fragment) });
      trace.shaderError?.(context, program, vertex, fragment);
    };
    for (const [method, original] of Object.entries(originals)) gl[method] = function (...args) {
      trace.calls.push({ method, phase: trace.phase, time: performance.now() });
      return original.apply(this, args);
    };
    g.render = function () {
      const start = performance.now();
      originalRender.call(this);
      trace.frames.push({ phase: trace.phase, time: this.time, ms: performance.now() - start, programs: this.renderer.info.programs.length });
    };
    trace.restore = () => {
      g.render = originalRender;
      for (const [method, original] of Object.entries(originals)) gl[method] = original;
      g.renderer.debug.onShaderError = trace.shaderError;
      window.removeEventListener('error', trace.error);
      delete window.__shaderProbe;
    };
    window.__shaderProbe = trace;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { programs: trace.programs(), quality: g.quality, pixelRatio: g.renderer.getPixelRatio(),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  });
}

/** Every (vessel,key) starts from a fresh document and the real loading
 * prewarm. Selection and the first real keyboard summon are independently
 * measured. A failed gate still saves its evidence before throwing.
 */
export async function verifyShaderTrial(page, { vessel, key, output = DEFAULT_OUTPUT, url = 'http://127.0.0.1:8765/index.html?play=1' }) {
  await mkdir(output, { recursive: true });
  await preparePage(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__game?.running && document.getElementById('enterBtn')?.classList.contains('on'), undefined, { timeout: 120000 });
  const expected = await page.evaluate(async ({ vessel, key }) => {
    const { TSUNAMI_TIERS } = await import('/src/tsunami.js');
    if (!__game.vessels[vessel]) throw new Error(`Missing vessel ${vessel}`);
    const tier = Object.values(TSUNAMI_TIERS).find(t => t.key === key);
    if (!tier) throw new Error(`Missing wave key ${key}`);
    const g = __game;
    g._govDone = true; g.paused = false; g.showHelp = false;
    // Freeze wall-clock advancement while keeping the real input surface
    // interactive. The pause screen intentionally rejects wave hotkeys.
    g.clock.stop();g.clock.autoStart=false;g.hud.update(.16,g.hudState());
    document.activeElement?.blur();
    return tier.id;
  }, { vessel, key });
  const before = await installTrace(page);
  let trial;
  try {
    const selection = await page.evaluate(vessel => {
      const g = __game, trace = __shaderProbe;
      g.selectVessel(vessel);
      g.rig.update(0, g.shipMesh, g.field, g.tsunami.dir);
      g.render();
      const result = { vessel: g.vesselId, programs: trace.programs(), calls: trace.calls.slice(), errors: trace.errors.slice() };
      trace.phase = 'summon';
      return result;
    }, vessel);
    await page.keyboard.press(key);
    const actual = await page.evaluate(() => ({ tier: __game.tsunami.tier?.id, state: __game.tsunami.state, packets: __game.field.packets.length }));
    // Bounded page calls: a wave encounter cannot monopolize evaluate().
    // Freeze the RAF simulation, then exercise the real step/render path.
    for (let i = 0; i < 12; i++) await page.evaluate(() => { __game.advance(.8); __game.render(); });
    const after = await page.evaluate(() => ({ programs: __shaderProbe.programs(), calls: __shaderProbe.calls,
      frames: __shaderProbe.frames, errors: __shaderProbe.errors, tier: __game.tsunami.tier?.id, vessel: __game.vesselId }));
    trial = { date: new Date().toISOString(), vessel, key, expected, actual, before, selection, after };
    await writeFile(resolve(output, `shader-${vessel}-${expected}.json`), JSON.stringify(trial, null, 2));
  } finally { await page.evaluate(() => window.__shaderProbe?.restore()); }
  assert.equal(trial.selection.vessel, vessel);
  assert.equal(trial.actual.tier, expected, `${vessel}/${key}: keyboard did not summon expected tier`);
  assert.equal(trial.actual.state, 'inbound', `${vessel}/${key}: first key did not start an event`);
  assert.ok(trial.actual.packets > 0);
  assert.deepEqual(trial.selection.programs, trial.before.programs, `${vessel}/${key}: selection changed program cache`);
  assert.deepEqual(trial.after.programs, trial.before.programs, `${vessel}/${key}: first summon changed program cache`);
  assert.equal(trial.after.calls.length, 0, `${vessel}/${key}: compile/link during selection or play`);
  assert.deepEqual(trial.after.errors, [], `${vessel}/${key}: runtime/shader errors`);
  console.log({ vessel, key, tier: expected, before: trial.before.programs.length, after: trial.after.programs.length, compileOrLinkCalls: trial.after.calls.length });
  return trial;
}

/** Pixel evidence must be captured immediately after the production renderer
 * returns, before Chromium clears its non-preserved WebGL drawing buffer.
 * Five cameras share >=131 frames per vessel/event; each appears throughout
 * the encounter in three-frame runs, including damped follow frames. The
 * static-hull travel estimate sets sampling density only. Completion follows
 * the moving vessel until the real event is idle and recovery is observed.
 */
export async function verifyBlackHuntCase(page, { vessel, tier, height=60, night=false, output = DEFAULT_OUTPUT, frameCount = 135, batchSize = 3, recoverySeconds = 8, maxSeconds = 600 }) {
  assert.ok(Number.isInteger(frameCount) && frameCount >= 131, 'Black-hunt requires at least 131 rendered frames per vessel/event');
  assert.ok(recoverySeconds >= 5 && maxSeconds > recoverySeconds, 'Require recovery and a finite encounter test budget');
  assert.ok(Number.isFinite(recoverySeconds) && Number.isFinite(maxSeconds), 'Encounter test budget must be finite');
  assert.ok(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 3, 'Keep browser evaluations bounded to 1–3 renders');
  assert.ok(['large', 'broad','meteor'].includes(tier), 'Black-hunt requires large, broad or meteor');
  const caseName=tier==='meteor'?`meteor-${height}-${night?'night':'day'}`:tier+(night?'-night':'');
  await mkdir(output, { recursive: true });
  await preparePage(page);
  const plan = await page.evaluate(async ({ vessel, tier, height, night, frameCount, modes, clearances, threshold, recoverySeconds, maxSeconds }) => {
    const { hullExtent } = await import('/src/tsunami.js');
    const THREE=await import('three'),{meteorWave}=await import('/src/meteors.js');
    const g = __game;
    g._govDone = true; g.running = true; g.paused = false; g.showHelp = false;g.clock.stop();g.clock.autoStart=false;
    g.mode='free';g.manualNight=night;g.selectVessel(vessel);g.skySys.setStorm(.42,Number(night));g.input.setThrottle(.75);
    if(tier==='meteor'){
      const wave=meteorWave(height),distance=wave.thickness*1.35+hullExtent(g.phys,1,0)+100;
      g.tsunami.triggerSpec(wave,g.phys,g.time,{height,epicentre:new THREE.Vector3(g.phys.position.x+distance,0,g.phys.position.z)});
    }else g.fireTsunami(tier);
    g.setCamera('orbit'); g.rig.update(0, g.shipMesh, g.field, g.tsunami.dir);
    const origin = g.shipMesh.position;
    const duration = Math.max(...g.field.packets.map(p =>
      (p.distanceToCrest(origin.x, origin.z, g.field.time) + p.trailingExtent + hullExtent(g.phys, p.dx, p.dz)) / p.speed)) + 12;
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const hunt = { vessel, tier, frameCount, modes, clearances, threshold, duration, step: duration / (frameCount - 1),
      recoverySeconds, maxSeconds, startedAt: g.time, idleAt: null, recoveryModes: new Set(), complete: false, exhausted: false,
      transitions: [{ time: g.time, event: g.tsunami.state }], frames: [], errors: [], firstDark: null };
    hunt.error = event => hunt.errors.push(event.message); window.addEventListener('error', hunt.error);
    hunt.sample = () => {
      const index = hunt.frames.length;
      const mode = hunt.modes[Math.floor(index / 3) % hunt.modes.length];
      if (g.rig.mode !== mode) g.setCamera(mode);
      if (index) g.advance(hunt.step);
      else g.rig.update(0, g.shipMesh, g.field, g.tsunami.dir);
      g.render(); context.drawImage(g.renderer.domElement, 0, 0, 160, 90);
      const pixels = context.getImageData(0, 0, 160, 90).data;
      let dark = 0;
      for (let i = 0; i < pixels.length; i += 4) if (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2] < 12) dark++;
      const cam = g.camera.position, water = g.field.heightAt(cam.x, cam.z), clearance = cam.y - water;
      const row = { index, mode: g.rig.mode, time: g.time, darkRatio: dark / 14400,
        camera: cam.toArray(), waterY: water, clearance, requiredClearance: hunt.clearances[mode],
        under: clearance < 0, clearanceViolation: clearance + 1e-6 < hunt.clearances[mode],
        position: g.phys.position.toArray(), velocity: g.phys.velocity.toArray(),
        roll: g.phys.attitude.roll, pitch: g.phys.attitude.pitch,
        event: g.tsunami.state, damage: g.damage.state, flood: g.damage.flood };
      if (hunt.transitions.at(-1).event !== row.event) hunt.transitions.push({ time: row.time, event: row.event });
      if (row.event === 'idle') {
        if (hunt.idleAt === null) hunt.idleAt = row.time;
        hunt.recoveryModes.add(mode);
      } else { hunt.idleAt = null; hunt.recoveryModes.clear(); }
      hunt.frames.push(row);
      hunt.complete = hunt.frames.length >= hunt.frameCount && hunt.idleAt !== null
        && row.time - hunt.idleAt >= hunt.recoverySeconds && hunt.recoveryModes.size === hunt.modes.length;
      // A finite test budget bounds a missing completion signal. This is a
      // failing test outcome, never a substitute event-completion condition.
      hunt.exhausted = row.time - hunt.startedAt > hunt.maxSeconds
        || (row.time - hunt.startedAt >= hunt.maxSeconds && !hunt.complete);
      if (row.darkRatio > hunt.threshold && !hunt.firstDark) hunt.firstDark = g.renderer.domElement.toDataURL('image/png');
      return row;
    };
    window.__blackHuntProbe = hunt;
    return { staticHullTravelEstimate: duration, step: hunt.step, minimumFrames: frameCount, recoverySeconds, maxSeconds,
      packets: g.field.packets.length, initialHeight: g.tsunami.height, significantSeaHeight: g.field.significantSeaHeight };
  }, { vessel, tier, height, night, frameCount, modes: MODES, clearances: CLEARANCE, threshold: DARK_RATIO, recoverySeconds, maxSeconds });
  let report;
  try {
    let progress = { complete: false, exhausted: false };
    while (!progress.complete && !progress.exhausted) {
      progress = await page.evaluate(count => {
        const h = __blackHuntProbe;
        for (let j = 0; j < count && !h.complete && !h.exhausted; j++) h.sample();
        return { frames: h.frames.length, time: __game.time, event: __game.tsunami.state, complete: h.complete, exhausted: h.exhausted };
      }, batchSize);
    }
    report = await page.evaluate(() => {
      const h = __blackHuntProbe;
      return { date: new Date().toISOString(), vessel: h.vessel, tier: h.tier, frames: h.frames,
        completion: { complete: h.complete, exhausted: h.exhausted, idleAt: h.idleAt,
          finalTime: h.frames.at(-1).time, recoveryDuration: h.idleAt === null ? 0 : h.frames.at(-1).time - h.idleAt,
          recoveryModes: [...h.recoveryModes], transitions: h.transitions },
        dark: h.frames.filter(f => f.darkRatio > h.threshold), underwater: h.frames.filter(f => f.under),
        clearanceViolations: h.frames.filter(f => f.clearanceViolation), errors: h.errors, firstDark: h.firstDark };
    });
    report.plan = plan;
    report.night=night;report.height=height;
    if (report.firstDark) await writeFile(resolve(output, `black-hunt-${vessel}-${caseName}-first-dark.png`), Buffer.from(report.firstDark.split(',')[1], 'base64'));
    delete report.firstDark;
    await writeFile(resolve(output, `black-hunt-${vessel}-${caseName}.json`), JSON.stringify(report, null, 2));
    await page.screenshot({ path: resolve(output, `black-hunt-${vessel}-${caseName}-end.png`) });
  } finally {
    await page.evaluate(() => {
      if (window.__blackHuntProbe) window.removeEventListener('error', __blackHuntProbe.error);
      delete window.__blackHuntProbe;
    });
  }
  assert.ok(report.frames.length >= frameCount);
  assert.equal(report.completion.exhausted, false, `${vessel}/${tier}: event/recovery exceeded ${maxSeconds}s test budget`);
  assert.equal(report.completion.complete, true, `${vessel}/${tier}: complete encounter and recovery were not observed`);
  assert.equal(report.frames.at(-1).event, 'idle', `${vessel}/${tier}: final event still active`);
  for (const event of ['inbound', 'active', 'clearing', 'idle']) assert.ok(report.completion.transitions.some(t => t.event === event), `${vessel}/${tier}: ${event} phase not observed`);
  assert.ok(report.completion.recoveryDuration >= recoverySeconds, `${vessel}/${tier}: recovery too short`);
  assert.deepEqual([...report.completion.recoveryModes].sort(), [...MODES].sort(), `${vessel}/${tier}: recovery missing a camera`);
  for (const mode of MODES) assert.ok(report.frames.some(f => f.mode === mode), `${vessel}/${tier}: missing ${mode}`);
  assert.deepEqual(report.errors, []);
  assert.equal(report.dark.length, 0, `${vessel}/${tier}: ${report.dark.length} frames exceed unchanged darkRatio > ${DARK_RATIO}`);
  assert.equal(report.underwater.length, 0, `${vessel}/${tier}: underwater camera`);
  assert.equal(report.clearanceViolations.length, 0, `${vessel}/${tier}: insufficient camera clearance`);
  assert.ok(report.frames.every(f => [...f.camera, ...f.position, ...f.velocity, f.darkRatio, f.roll, f.pitch].every(Number.isFinite)), `${vessel}/${tier}: non-finite simulation`);
  console.log({ vessel, tier, frames: report.frames.length, dark: report.dark.length, underwater: report.underwater.length, clearanceViolations: report.clearanceViolations.length, finalEvent: report.frames.at(-1).event, elapsed: report.completion.finalTime, recovery: report.completion.recoveryDuration });
  return report;
}

export async function verifyShaders(task, { pageLabel = 'p1', output = DEFAULT_OUTPUT, frameCount = 135, batchSize = 3, recoverySeconds = 8, maxSeconds = 600 } = {}) {
  const page = task.page(pageLabel);
  const trials = [];
  for (const vessel of ['carrier', 'tanker']) for (const key of ['1', '2', '3']) trials.push(await verifyShaderTrial(page, { vessel, key, output }));
  await writeFile(resolve(output, 'shader-fixed.json'), JSON.stringify(trials, null, 2));
  const hunts = [];
  for (const vessel of ['carrier', 'tanker']) for (const tier of ['large', 'broad']) {
    const result = await verifyBlackHuntCase(page, { vessel, tier, output, frameCount, batchSize, recoverySeconds, maxSeconds });
    hunts.push({ vessel, tier, frames: result.frames.length, dark: result.dark.length, underwater: result.underwater.length, clearanceViolations: result.clearanceViolations.length, completion: result.completion });
  }
  await writeFile(resolve(output, 'black-hunt-summary.json'), JSON.stringify(hunts, null, 2));
  return { trials: trials.length, hunts };
}
