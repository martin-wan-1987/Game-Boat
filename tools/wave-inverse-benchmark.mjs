/** Compare the production inverse against a captured pre-change module.
 * No approximation oracle: both runs evaluate identical spectra, wave
 * packets, world points and times. Timing samples alternate AB/BA order.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const output = resolve('qa/2026-10-02/realism');
const baselinePath = resolve(process.argv[2] ?? `${output}/waves-before-inverse.mjs`);
const candidatePath = resolve(process.argv[3] ?? 'src/waves.js');
const before = await import(pathToFileURL(baselinePath));
const after = await import(pathToFileURL(candidatePath));
const { SEA_STATE, TSUNAMI_TIERS, TsunamiManager } = await import('../src/tsunami.js');
const { SHIP } = await import('../src/carrier-layout.js');
const { TANKER } = await import('../src/tanker-layout.js');
const THREE = await import('three');
let seed = 0x65c0ffee;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const baseline = new before.WaveField(), candidate = new after.WaveField();
const mathRandom = Math.random;
try { Math.random = random; baseline.buildSea(SEA_STATE.hs, 1, 0, SEA_STATE.spread, SEA_STATE.peakLength, SEA_STATE.directions); }
finally { Math.random = mathRandom; }
candidate.sea = structuredClone(baseline.sea);
const manager = new TsunamiManager(baseline);
const count = 12000;
const points = Array.from({ length: count }, () => ({ x: (random() - .5) * 2400, z: (random() - .5) * 1800, time: random() * 110, agitation: .5 + random() * .5 }));
const keys = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'vx', 'vy', 'vz', 'jac', 'txx', 'txz', 'tzx', 'tzz'];
const cases = [];
const sample = (field, p, out) => { field.time = p.time; field.agitation = p.agitation; return field.sampleWorld(p.x, p.z, out); };
const timeRun = field => {
  const out = {}; let checksum = 0;
  const start = performance.now();
  for (const point of points) { sample(field, point, out); checksum += out.y + out.ny + out.vy; }
  return { ms: performance.now() - start, checksum };
};
for (const vessel of [SHIP, TANKER]) {
  const origin = new THREE.Vector3(130, 0, -74), quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -.73);
  const ship = { vessel, heading: .73, quaternion, localToWorld: (p, out) => out.copy(p).applyQuaternion(quaternion).add(origin) };
  for (const tier of ['ambient', ...Object.keys(TSUNAMI_TIERS)]) {
    baseline.time = 0; baseline.clearPackets();
    if (tier !== 'ambient') {
      try { Math.random = random; manager.trigger(tier, ship, 0); }
      finally { Math.random = mathRandom; }
    }
    candidate.packets = baseline.packets.map(p => Object.assign(Object.create(after.WavePacket.prototype), p));
    const error = Object.fromEntries(keys.map(k => [k, 0]));
    const baseError = Object.fromEntries(keys.map(k => [k, 0]));
    let inverseResidual = 0; const a = {}, b = {};
    for (const p of points) {
      sample(baseline, p, a); sample(candidate, p, b);
      for (const key of keys) error[key] = Math.max(error[key], Math.abs(a[key] - b[key]));
      inverseResidual = Math.max(inverseResidual, Math.abs(b.x - p.x) + Math.abs(b.z - p.z));
      baseline.sampleBase(p.x, p.z, a); candidate.sampleBase(p.x, p.z, b);
      for (const key of keys) baseError[key] = Math.max(baseError[key], Math.abs(a[key] - b[key]));
    }
    // Warm both implementations; the first invocation includes JIT cost.
    for (let i = 0; i < 2; i++) { timeRun(baseline); timeRun(candidate); }
    const measurements = [];
    for (let i = 0; i < 8; i++) {
      const order = i % 2 ? [candidate, baseline] : [baseline, candidate];
      const times = order.map(timeRun);
      const old = times[i % 2 ? 1 : 0], next = times[i % 2 ? 0 : 1];
      assert.equal(next.checksum, old.checksum, `${vessel.id}/${tier}: checksum differs`);
      measurements.push({ beforeMs: old.ms, afterMs: next.ms });
    }
    const median = values => values.toSorted((a, b) => a - b).slice(3, 5).reduce((a, b) => a + b) / 2;
    const beforeMs = median(measurements.map(r => r.beforeMs)), afterMs = median(measurements.map(r => r.afterMs));
    const row = { vessel: vessel.id, tier, points: count, packets: candidate.packets.length, inverseResidual, error, baseError, beforeMs, afterMs, speedup: beforeMs / afterMs, measurements };
    cases.push(row); console.log({ vessel: row.vessel, tier, packets: row.packets, inverseResidual, maxError: Math.max(...Object.values(error)), beforeMs, afterMs, speedup: row.speedup });
  }
}
const report = { date: new Date().toISOString(), node: process.version, seed: '0x65c0ffee',
  before: { path: baselinePath, sha256: createHash('sha256').update(await readFile(baselinePath)).digest('hex') },
  after: { path: candidatePath, sha256: createHash('sha256').update(await readFile(candidatePath)).digest('hex') },
  meaning: 'L1 horizontal inverse residual <1e-4 m; all returned values equal to the original algorithm at the same queries. Timings are warmed, interleaved AB/BA medians; no GPU/browser claims.', cases };
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'wave-inverse-benchmark.json'), JSON.stringify(report, null, 2));
for (const row of cases) {
  assert.ok(row.inverseResidual < .0001, `${row.vessel}/${row.tier}: inverse residual`);
  for (const [key, value] of Object.entries(row.error)) assert.equal(value, 0, `${row.vessel}/${row.tier}: inverse ${key} changed`);
  for (const [key, value] of Object.entries(row.baseError)) assert.equal(value, 0, `${row.vessel}/${row.tier}: forward ${key} changed`);
}
