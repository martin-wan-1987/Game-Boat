/**
 * Danger envelope: how the ship answers the large tsunami as a function of the
 * angle at which the train arrives relative to the bow.
 *
 *   0 deg  = dead over the bow (pure pitching + slamming)
 *   90 deg = beam-on (worst case for roll)
 */
import { WaveField } from '../src/waves.js';
import { ShipPhysics } from '../src/physics.js';
import { buildPatches } from '../src/ship.js';
import { TSUNAMI_TIERS } from '../src/tsunami.js';
import { DamageModel } from '../src/damage.js';

/** Headless stand-in for the particle system — the damage model emits into it. */
const nullParticles = { spawn() {}, update() {}, alive: 0 };

const f = (n, d = 1) => Number(n).toFixed(d);
const DT = 1 / 60;
const tier = TSUNAMI_TIERS.large;
const TRIALS = 3;
const SETTLE = 35;      // seconds of calm water before the wave arrives

console.log(`大型海啸 ${tier.hMin}-${tier.hMax} m, T=${tier.period}s, 每方向 ${TRIALS} 次试验\n`);
console.log('到达角   马力   横摇(均/max)     纵摇(均/max)     倾覆   沉没   最终进水量');

for (const angleDeg of [0, 30, 45, 90]) {
  for (const thr of [0.0, 0.5]) {
    const rolls = [], pitches = [], caps = [], integ = [], sinks = [];
    for (let trial = 0; trial < TRIALS; trial++) {
      const field = new WaveField();
      field.buildSea(1.6, 1, 0, 0.45, 62);
      const ship = new ShipPhysics(buildPatches(18, 10), {});
      const dmg = new DamageModel();
      ship.reset(0, 0, 0);
      ship.throttle = thr;
      let t = 0;
      for (let i = 0; i < 70 * SETTLE; i++) { field.update(DT); ship.step(DT, field); t += DT; }
      const hdg = ship.heading + angleDeg * Math.PI / 180;
      const height = tier.hMin + Math.random() * (tier.hMax - tier.hMin);
      field.spawnTsunami({
        x: ship.position.x, z: ship.position.z,
        dirX: Math.cos(hdg), dirZ: Math.sin(hdg),
        height, period: tier.period * (0.92 + Math.random() * 0.18),
        distance: tier.distance, crests: tier.crests,
      });
      let mr = 0, mp = 0, cap = false;
      for (let i = 0; i < 60 * 110; i++) {
        field.update(DT);
        ship.step(DT, field);
        t += DT;
        // mirror the game loop: damage feeds flooding back into the physics
        dmg.update(DT, ship, field, nullParticles, t);
        const a = ship.attitude;
        mr = Math.max(mr, Math.abs(a.roll));
        mp = Math.max(mp, Math.abs(a.pitch));
        if (ship.capsized) cap = true;
      }
      rolls.push(mr * 57.3); pitches.push(mp * 57.3);
      caps.push(cap ? 1 : 0); integ.push(ship.flood);
      sinks.push(dmg.state === 'lost' ? 1 : 0);
    }
    const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    console.log(
      `${String(angleDeg).padStart(3)}°  ${String(Math.round(thr * 100)).padStart(4)}%  ` +
      `${f(avg(rolls)).padStart(5)} / ${f(Math.max(...rolls)).padStart(5)}   ` +
      `${f(avg(pitches)).padStart(5)} / ${f(Math.max(...pitches)).padStart(5)}   ` +
      `${caps.reduce((a, b) => a + b, 0)}/${TRIALS}   ` +
      `${sinks.reduce((a, b) => a + b, 0)}/${TRIALS}   ` +
      `${f(avg(integ), 2)}`);
  }
}
