import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function verifyGameplay(task, {pageLabel='p1',output=fileURLToPath(new URL('../qa/2026-10-01/', import.meta.url))}={}) {
  const page = task.page(pageLabel);
  const root = output;
  await page.cdp('Page.bringToFront');
  await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await page.goto('http://127.0.0.1:8765/index.html?play=1');
  await page.waitForFunction(() => __game.running && document.getElementById('enterBtn').classList.contains('on'), undefined, { timeout: 120000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.screen')).every(e => getComputedStyle(e).opacity === '0'));
  await page.evaluate(() => { __game._govDone = true; });
  const tiers = await page.evaluate(async () => Object.keys((await import('/src/tsunami.js')).TSUNAMI_TIERS));
  assert.deepEqual(tiers, ['small', 'medium', 'large', 'broad']);
  await page.click('#anchorBtn');
  await page.waitForFunction(() => __game.phys.anchor.phase === 'lowering' && document.getElementById('anchorBtn').disabled);
  const lowering = await page.evaluate(() => ({ phase: __game.phys.anchor.phase, elapsed: __game.phys.anchor.elapsed, status: document.getElementById('anchorStatus').textContent }));
  await page.keyboard.press('p');
  await page.waitForFunction(() => __game.paused);
  const pausedAt = await page.evaluate(() => __game.phys.anchor.elapsed);
  await page.waitForTimeout(500); // deliberately measure an unchanging paused clock
  const pausedAfter = await page.evaluate(() => __game.phys.anchor.elapsed);
  assert.equal(pausedAt, pausedAfter);
  await page.keyboard.press('p');
  await page.waitForFunction(() => document.getElementById('anchorStatus').textContent === '锚链已经到底');
  const set = await page.evaluate(() => ({ phase: __game.phys.anchor.phase, elapsed: __game.phys.anchor.elapsed, chain: __game.phys.anchor.chainLength, status: document.getElementById('anchorStatus').textContent, button: document.getElementById('anchorBtn').textContent }));
  assert.equal(set.elapsed, 3); assert.equal(set.phase, 'set'); assert.equal(set.button, '起锚');
  await page.screenshot({ path: root + 'anchor-set.png' });
  await page.click('#anchorBtn');
  await page.waitForFunction(() => __game.phys.anchor.phase === 'stowed');
  await page.click('#anchorBtn');
  await page.keyboard.press('r');
  assert.equal(await page.evaluate(() => __game.phys.anchor.phase), 'stowed');
  await page.keyboard.press('3');
  await page.waitForFunction(() => __game.tsunami.tier?.id === 'large');
  await page.keyboard.press('4');
  await page.waitForFunction(() => __game.tsunami.tier?.id === 'broad');

  const sailing = await page.evaluate(() => {
    const g = __game; g.running = false; g.paused = false; g.resetScenario(); g.input.setThrottle(1);
    const start = g.phys.position.clone(); g.advance(30);
    const sample = g.waterFX.history[Math.floor(g.waterFX.history.length / 2)];
    const retained = { x: sample.x, z: sample.z };
    g.advance(1);
    const attributes = Object.values(g.waterFX.geometry.attributes);
    return { time: g.time, metres: Math.hypot(g.phys.position.x - start.x, g.phys.position.z - start.z),
      knots: g.phys.speedKnots, samples: g.waterFX.history.length, droplets: g.waterFX.alive,
      worldTrailUnmoved: g.waterFX.history.includes(sample) && sample.x === retained.x && sample.z === retained.z,
      finite: attributes.every(a => a.array.every(Number.isFinite)),
      agesValid: g.waterFX.geometry.attributes.aAge.array.every(age => age >= 0 && age <= 1),
      removedMeshes: !g.hullFoam && !g.wake && !g.spray && !g.propWash };
  });
  assert.ok(sailing.metres > 80); assert.ok(sailing.samples > 100); assert.ok(sailing.droplets > 0);
  assert.ok(sailing.worldTrailUnmoved && sailing.finite && sailing.agesValid && sailing.removedMeshes);
  await page.evaluate(() => { const g = __game; g.hud.show(false); g.cockpit.show(false); g.rig._snap = true; g.rig.update(0, g.shipMesh, g.field, g.tsunami.dir); g.render(); });
  await page.waitForFunction(() => getComputedStyle(document.getElementById('hud')).opacity === '0');
  await page.screenshot({ path: root + 'enterprise-underway.png' });
  const errors = (await page.events()).filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params?.exceptionDetails?.text);
  assert.deepEqual(errors, []);
  const report = { tiers, anchor: { lowering, pausedAt, pausedAfter, set, reset: 'stowed' }, sailing, errors, entry: 'index.html?play=1' };
  await writeFile(root + 'gameplay.json', JSON.stringify(report, null, 2));
  console.log(report);
}
