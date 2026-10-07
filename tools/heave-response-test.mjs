import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import * as THREE from 'three';
import { WaveField } from '../src/waves.js';
import { ShipPhysics } from '../src/physics.js';
import { buildPatches } from '../src/ship.js';
import { TsunamiManager } from '../src/tsunami.js';

// Compare identical encounters, including the first rebound after summoning.
// Hydrostatic support is an independent root of the same pressure integral,
// rather than the water height at one point on a 342 m ship.
const output = process.argv[2];
const dampingIndex = process.argv.indexOf('--damping');
const opts = dampingIndex < 0 ? {} : { heaveDampingRatio: Number(process.argv[dampingIndex + 1]) };
const seeds = process.argv.includes('--quick') ? [65] : [65, 6501, 651030];
const dt = 1 / 120;
const report = { hashes: {}, trials: [] };
for (const file of ['src/physics.js', 'src/waves.js', 'src/tsunami.js']) {
  report.hashes[file] = createHash('sha256').update(readFileSync(file)).digest('hex');
}
function supportHeight(ship, field) {
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const rows = ship.patches.filter(patch => patch.kind !== 'deck').map(patch => {
    p.copy(patch.pos).sub(ship.cg).applyQuaternion(ship.quaternion);
    n.copy(patch.nrm).applyQuaternion(ship.quaternion);
    return { y: field.heightAt(ship.position.x + p.x, ship.position.z + p.z) - p.y,
      weight: -n.y * patch.area };
  });
  const mass = ship.mass * (1 + ship.flood * .55 + ship.flood ** 2 * 1.3);
  let lo = Math.min(...rows.map(r => r.y)) - 38, hi = Math.max(...rows.map(r => r.y));
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const displacement = rows.reduce((v, r) => v + Math.min(38, Math.max(0, r.y - mid)) * r.weight, 0);
    if (displacement > mass / 1025) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
for (const trialSeed of seeds) for (const throttle of [0, 1]) {
  let seed = trialSeed;
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const field = new WaveField().buildSea(2.6, -.8, .6, .45, 90);
  const ship = new ShipPhysics(buildPatches(26, 14), opts);
  const dampingRatio = ship.heaveDampingRatio;
  // Match the saved baseline's state at summon time. Calm-water regression
  // separately checks the configured damping throughout ordinary sailing.
  ship.heaveDampingRatio = 0;
  const manager = new TsunamiManager(field);
  ship.throttle = throttle;
  for (let i = 0; i < 120 * 60; i++) { field.update(dt); ship.step(dt, field); }
  const before = ship.position.y;
  ship.heaveDampingRatio = dampingRatio;
  manager.trigger('large', ship, field.time);
  const start = field.time, rows = [];
  let maxSpeed = 0, maxOmega = 0, capsized = false;
  for (let i = 0; i < 120 * 75; i++) {
    field.update(dt); ship.step(dt, field);
    maxSpeed = Math.max(maxSpeed, ship.velocity.length());
    maxOmega = Math.max(maxOmega, ship.omega.length());
    capsized ||= ship.capsized;
    if (i % 12 === 0) {
      const support = supportHeight(ship, field), a = ship.attitude;
      rows.push({ t: field.time - start, y: ship.position.y, vy: ship.velocity.y,
        support, rebound: ship.position.y - support, buoy: ship.lastForces.buoy,
        roll: a.roll * 180 / Math.PI, pitch: a.pitch * 180 / Math.PI });
    }
  }
  const peak = rows.reduce((a, b) => a.y > b.y ? a : b);
  const rebound = rows.reduce((a, b) => a.rebound > b.rebound ? a : b);
  const trial = { seed: trialSeed, throttle, height: manager.height, offBow: manager.offBow,
    dampingRatio: ship.heaveDampingRatio,
    before, peak, peakRise: peak.y-before, rebound, initialPeak: Math.max(...rows.filter(r => r.t < 12).map(r => r.y)),
    maxSpeed, maxOmega, capsized, rows };
  assert.ok(rows.every(r => Object.values(r).every(Number.isFinite)));
  assert.equal(capsized, false); assert.ok(maxSpeed <= 60 && maxOmega <= 1.1);
  report.trials.push(trial);
  console.log(JSON.stringify({ ...trial, rows: undefined }));
}
const baselineIndex = process.argv.indexOf('--baseline');
if(baselineIndex>=0) {
  const baseline=JSON.parse(readFileSync(process.argv[baselineIndex+1]));
  report.comparison=report.trials.map(after=>{
    const before=baseline.trials.find(r=>r.seed===after.seed&&r.throttle===after.throttle);
    const originalRise=before.peak.y-before.before;
    return {seed:after.seed,throttle:after.throttle,originalRise,rise:after.peakRise,ratio:after.peakRise/originalRise};
  });
  const mean=report.comparison.reduce((s,r)=>s+r.ratio,0)/report.comparison.length;
  report.meanRiseRatio=mean;
  console.log({meanRiseRatio:mean,comparison:report.comparison});
  assert.ok(mean>.4&&mean<.6,'mean bounce height is approximately halved');
  assert.ok(report.comparison.every(r=>r.ratio>.25&&r.ratio<.8),'every matched encounter retains a smaller bounce');
}
if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2)); }
