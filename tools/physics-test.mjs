/**
 * Headless verification of the hydrostatic solver.
 * Run:  node tools/physics-test.mjs
 *
 * Checks: equilibrium draft, stability, roll period, capsizing behaviour in a
 * large tsunami train, and turn performance.
 */
import { WaveField } from '../src/waves.js';
import { ShipPhysics } from '../src/physics.js';
import { buildPatches } from '../src/ship.js';

const log = (...a) => console.log(...a);
const f = (n, d = 2) => n.toFixed(d);

const patches = buildPatches(26, 14);
log(`patches: ${patches.length}`);

const ship = new ShipPhysics(patches, {});
log(`areaScale: ${f(ship.areaScale, 4)}`);

/* ---------------- 1. calm-water equilibrium ---------------- */
const field = new WaveField();
field.buildSea(0.05, 1, 0, 0.2, 90);

ship.reset(0, 0, 0);
const dt = 1 / 120;
for (let i = 0; i < 120 * 60; i++) {
  field.update(dt);
  ship.step(dt, field);
}
let att = ship.attitude;
log('\n--- calm water, 60 s ---');
log(`draft (y):      ${f(ship.position.y)} m   (origin sits at design waterline -> ~0)`);
log(`roll:           ${f(att.roll * 57.2958)} deg`);
log(`pitch:          ${f(att.pitch * 57.2958)} deg`);
log(`vertical vel:   ${f(ship.velocity.y, 4)} m/s`);
log(`angular vel:    ${f(ship.omega.length(), 4)} rad/s`);

/* ---------------- 2. roll period ---------------- */
ship.reset(0, 0, 0);
for (let i = 0; i < 120 * 20; i++) { field.update(dt); ship.step(dt, field); }
ship.omega.x = 0.25;                      // kick her over
let last = 0, crossings = [], t = 0;
for (let i = 0; i < 120 * 90; i++) {
  field.update(dt); ship.step(dt, field);
  t += dt;
  const r = ship.attitude.roll;
  if (last < 0 && r >= 0) crossings.push(t);
  last = r;
}
const periods = [];
for (let i = 1; i < crossings.length; i++) periods.push(crossings[i] - crossings[i - 1]);
const mean = periods.length ? periods.reduce((a, b) => a + b, 0) / periods.length : 0;
log('\n--- roll period ---');
log(`natural roll period: ${f(mean)} s  (real CVN: ~12-20 s)`);
const decay = periods.length > 2
  ? Math.log(Math.abs(1)) : 0;
log(`rolls observed: ${periods.length}`);

/* ---------------- 3. acceleration / top speed ---------------- */
ship.reset(0, 0, 0);
ship.throttle = 1;
const t0 = Date.now();
for (let i = 0; i < 120 * 300; i++) { field.update(dt); ship.step(dt, field); }
log('\n--- propulsion (5 min at full power) ---');
log(`speed: ${f(ship.speedKnots)} kn   (real CVN: 30+ kn)`);
log(`sim wall time: ${Date.now() - t0} ms for 300 s of sim`);

/* ---------------- 4. turn performance ---------------- */
ship.reset(0, 0, 0);
ship.throttle = 1;
for (let i = 0; i < 120 * 180; i++) { field.update(dt); ship.step(dt, field); }
const vBefore = ship.speedKnots;
ship.rudder = 1;
const h0 = ship.heading;
let turnTime = 0;
for (let i = 0; i < 120 * 600; i++) {
  field.update(dt); ship.step(dt, field);
  turnTime += dt;
  let d = ship.heading - h0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  if (Math.abs(d) > Math.PI / 2) break;
}
log('\n--- turning ---');
log(`entry speed: ${f(vBefore)} kn`);
log(`time to turn 90 deg at full rudder: ${f(turnTime)} s  (real: 60-120 s)`);
log(`steady turn rate: ${f(90 / turnTime, 3)} deg/s`);

/* ---------------- 5. tsunami response ---------------- */
for (const spec of [
  { name: 'small  (2-3 m)', height: 2.6, period: 8.0, distance: 900 },
  { name: 'medium (6-7 m)', height: 6.6, period: 10.0, distance: 1100 },
  { name: 'large  (11-15 m)', height: 13.0, period: 12.0, distance: 1300 },
]) {
  const results = [];
  for (let trial = 0; trial < 8; trial++) {
    const wf = new WaveField();
    wf.buildSea(1.3, 1, 0, 0.55, 90);
    ship.reset(0, 0, 0);
    ship.throttle = 0.35;
    // let her settle and get underway
    for (let i = 0; i < 120 * 60; i++) { wf.update(dt); ship.step(dt, wf); }
    const heading0 = ship.heading;
    const dirX = Math.cos(heading0), dirZ = Math.sin(heading0);
    wf.spawnTsunami({
      x: ship.position.x, z: ship.position.z,
      dirX, dirZ,
      height: spec.height * (0.92 + Math.random() * 0.16),
      period: spec.period, distance: spec.distance,
      crests: 4,
    });
    let maxRoll = 0, maxPitch = 0, capsize = false, maxSlope = 0;
    for (let i = 0; i < 120 * 180; i++) {
      wf.update(dt);
      ship.step(dt, wf);
      const a = ship.attitude;
      maxRoll = Math.max(maxRoll, Math.abs(a.roll));
      maxPitch = Math.max(maxPitch, Math.abs(a.pitch));
      if (ship.capsized) capsize = true;
    }
    results.push({ roll: maxRoll * 57.2958, pitch: maxPitch * 57.2958, capsize });
  }
  const rolls = results.map((r) => r.roll);
  const pitches = results.map((r) => r.pitch);
  const caps = results.filter((r) => r.capsize).length;
  log(`\n--- tsunami ${spec.name} ---`);
  log(`max roll:  ${f(Math.min(...rolls))} .. ${f(Math.max(...rolls))} deg  (mean ${f(rolls.reduce((a, b) => a + b) / rolls.length)})`);
  log(`max pitch: ${f(Math.min(...pitches))} .. ${f(Math.max(...pitches))} deg`);
  log(`capsized:  ${caps}/8 trials`);
}
