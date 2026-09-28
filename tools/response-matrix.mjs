/**
 * Response matrix: how the ship answers the tsunami at different engine
 * orders. Fast (uses a reduced patch set) so it can be run often.
 */
import { WaveField } from '../src/waves.js';
import { ShipPhysics } from '../src/physics.js';
import { buildPatches } from '../src/ship.js';
import { TSUNAMI_TIERS } from '../src/tsunami.js';

const f = (n, d = 1) => Number(n).toFixed(d);
const patches = buildPatches(20, 11);
const DT = 1 / 80;

const TIERS = ['small', 'medium', 'large'];
const THROTTLES = [0, 0.3, 0.6, 1.0];
const TRIALS = 3;
const SEA_SECONDS = 130;

for (const tierId of TIERS) {
  const tier = TSUNAMI_TIERS[tierId];
  console.log(`\n########## ${tier.label}  (${tier.hMin}-${tier.hMax} m, T=${tier.period}s) ##########`);
  for (const thr of THROTTLES) {
    const rolls = [], pitches = [], caps = [];
    for (let trial = 0; trial < TRIALS; trial++) {
      const field = new WaveField();
      field.buildSea(1.6, 1, 0, 0.45, 62);
      const ship = new ShipPhysics(buildPatches(20, 11), {});
      ship.reset(0, 0, 0);
      ship.throttle = thr;
      for (let i = 0; i < 80 * 150; i++) { field.update(DT); ship.step(DT, field); }
      const hdg = ship.heading;
      const jitter = (Math.random() - 0.5) * 0.28;
      const height = tier.hMin + Math.random() * (tier.hMax - tier.hMin);
      field.spawnTsunami({
        x: ship.position.x, z: ship.position.z,
        dirX: Math.cos(hdg + jitter), dirZ: Math.sin(hdg + jitter),
        height, period: tier.period * (0.92 + Math.random() * 0.18),
        distance: tier.distance, crests: tier.crests,
      });
      let mr = 0, mp = 0, cap = false;
      for (let i = 0; i < 80 * SEA_SECONDS; i++) {
        field.update(DT); ship.step(DT, field);
        const a = ship.attitude;
        mr = Math.max(mr, Math.abs(a.roll));
        mp = Math.max(mp, Math.abs(a.pitch));
        if (ship.capsized) cap = true;
      }
      rolls.push(mr * 57.3); pitches.push(mp * 57.3); caps.push(cap ? 1 : 0);
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    console.log(`  马力 ${String(Math.round(thr * 100)).padStart(3)}%  ` +
      `横摇 ${f(Math.min(...rolls))}..${f(Math.max(...rolls))}° (均${f(avg(rolls))})  ` +
      `纵摇 ${f(Math.min(...pitches))}..${f(Math.max(...pitches))}° (均${f(avg(pitches))})  ` +
      `倾覆 ${caps.reduce((a, b) => a + b, 0)}/${TRIALS}`);
  }
}
