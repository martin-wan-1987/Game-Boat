/**
 * Tsunami response study.
 *  A) head-on (the specified scenario) at cruising speed
 *  B) head-on, stopped (lost steerage way)
 *  C) beam-on, as a sanity check that the roll model is alive
 */
import { WaveField } from '../src/waves.js';
import { ShipPhysics } from '../src/physics.js';
import { buildPatches } from '../src/ship.js';

const f = (n, d = 1) => Number(n).toFixed(d);
const patches = buildPatches(22, 12);
const ship = new ShipPhysics(patches, {});
const DT = 1 / 120;

const SIZES = [
  { name: '小型 2-3 m', h: [2.0, 3.0], period: 8.0, distance: 900, crests: 3 },
  { name: '中型 6-7 m', h: [6.0, 7.0], period: 10.5, distance: 1100, crests: 4 },
  { name: '大型 11-15 m', h: [11.0, 15.0], period: 12.5, distance: 1300, crests: 5 },
];

function run(spec, { throttle, angleDeg, trials = 4, spread = 0.17 }) {
  const rows = [];
  for (let trial = 0; trial < trials; trial++) {
    const field = new WaveField();
    field.buildSea(1.2, 1, 0, 0.55, 80);
    ship.reset(0, 0, 0);
    ship.throttle = throttle;
    for (let i = 0; i < 120 * 90; i++) { field.update(DT); ship.step(DT, field); }
    const hdg = ship.heading;
    const ang = hdg + angleDeg * Math.PI / 180;
    const height = spec.h[0] + Math.random() * (spec.h[1] - spec.h[0]);
    field.spawnTsunami({
      x: ship.position.x, z: ship.position.z,
      dirX: Math.cos(ang), dirZ: Math.sin(ang),
      height, period: spec.period, distance: spec.distance,
      crests: spec.crests, spread,
    });
    let maxRoll = 0, maxPitch = 0, minUp = 1, capsized = false;
    for (let i = 0; i < 120 * 150; i++) {
      field.update(DT); ship.step(DT, field);
      const a = ship.attitude;
      maxRoll = Math.max(maxRoll, Math.abs(a.roll));
      maxPitch = Math.max(maxPitch, Math.abs(a.pitch));
      minUp = Math.min(minUp, a.up.y);
      if (ship.capsized) capsized = true;
    }
    rows.push({ h: height, roll: maxRoll * 57.3, pitch: maxPitch * 57.3, capsized });
  }
  const rolls = rows.map((r) => r.roll);
  const pitches = rows.map((r) => r.pitch);
  const caps = rows.filter((r) => r.capsized).length;
  return {
    rolls, pitches, caps,
    meanRoll: rolls.reduce((a, b) => a + b) / rolls.length,
    meanPitch: pitches.reduce((a, b) => a + b) / pitches.length,
  };
}

const CASES = [
  { key: 'A  舰艏迎浪 · 有航速', throttle: 0.4, angleDeg: 0 },
  { key: 'B  舰艏迎浪 · 停车', throttle: 0.0, angleDeg: 0 },
  { key: 'C  正横受浪 · 对照', throttle: 0.4, angleDeg: 90 },
];

for (const c of CASES) {
  console.log(`\n############ ${c.key} ############`);
  for (const spec of SIZES) {
    const r = run(spec, { throttle: c.throttle, angleDeg: c.angleDeg });
    console.log(`  ${spec.name.padEnd(12)} 横摇 ${f(Math.min(...r.rolls))}..${f(Math.max(...r.rolls))}° (均${f(r.meanRoll)})` +
      `  纵摇 ${f(Math.min(...r.pitches))}..${f(Math.max(...r.pitches))}° (均${f(r.meanPitch)})` +
      `  倾覆 ${r.caps}/4`);
  }
}
