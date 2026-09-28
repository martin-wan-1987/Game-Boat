/**
 * tsunami.js — tsunami event manager.
 *
 * The wave always arrives **over the bow**: it is spawned ahead of the ship's
 * current heading and travels straight at her, which is also the honest
 * deep-water picture (a long, non-dispersive swell, not a breaking wall —
 * those only exist in shallow water near shore).
 *
 * Nothing here decides whether the ship survives. The wave is handed to the
 * physics, and the physics decides.
 */
import * as THREE from 'three';

export const TSUNAMI_TIERS = {
  // Periods are tuned so the *encounter* period (Te = L / (c + V cos mu)) lands
  // in dangerous company with this hull's natural periods — roll ~12.9 s,
  // pitch ~6.3 s. Because the train comes over the bow, keeping way on pushes
  // Te down and away from roll resonance, while slowing down walks her
  // straight into it. That tension is the whole game.
  //
  // `crests` now describes the size of the *wave group*: a big tsunami is not
  // one wave, it is a leading wall followed by several medium and small waves.
  small: {
    id: 'small', label: '小型海啸', hMin: 2, hMax: 3,
    period: 8.0, distance: 520, crests: 5,
    warn: '轻微涌浪，几乎无感',
  },
  medium: {
    id: 'medium', label: '中型海啸', hMin: 6, hMax: 7,
    period: 10.0, distance: 680, crests: 6,
    warn: '船体明显纵摇，注意保持航速',
  },
  large: {
    id: 'large', label: '大型海啸', hMin: 11, hMax: 15,
    period: 12.0, distance: 850, crests: 7,
    warn: '危险！可能横摇失稳甚至倾覆',
  },
};

export class TsunamiManager {
  constructor(field) {
    this.field = field;
    this.state = 'idle';      // idle | inbound | active | clearing
    this.tier = null;
    this.height = 0;
    this.dir = new THREE.Vector3(1, 0, 0);
    this.tStart = 0;
    this.peakRoll = 0;
    this.peakPitch = 0;
    this.worstUp = 1;
    this.rollHistory = [];
    this.time = 0;
  }

  get active() { return this.state === 'inbound' || this.state === 'active'; }

  /** Distance from the ship to the leading crest (m, may go negative). */
  distanceToCrest(shipPos) {
    if (!this.active) return Infinity;
    return this.field.distanceToCrest(shipPos.x, shipPos.z);
  }

  /**
   * Fire a tsunami over the bow.
   * @param {string} tierId  small | medium | large
   * @param {object} ship    {position, heading}
   */
  trigger(tierId, ship, time) {
    const tier = TSUNAMI_TIERS[tierId];
    if (!tier) return null;
    this.tier = tier;
    this.height = tier.hMin + Math.random() * (tier.hMax - tier.hMin);

    // Arrival angle off the bow. A wave dead over the bow mostly pitches you;
    // the danger is when it arrives quartering, because that is when the
    // righting arm actually gets tested. Refraction plus wherever the ship
    // happens to be pointing at the moment of arrival give a spread, weighted
    // so most waves come over the bow and the bad ones are the exception.
    const r = Math.random();
    let off;
    if (r < 0.62) off = (Math.random() - 0.5) * 0.36;            //  +-10 deg
    else if (r < 0.90) off = 0.26 + Math.random() * 0.36;        //  15-35 deg
    else off = 0.70 + Math.random() * 0.50;                      //  40-69 deg
    off *= Math.random() < 0.5 ? -1 : 1;

    const hdg = ship.heading + off;
    this.dir.set(Math.cos(hdg), 0, Math.sin(hdg));
    this.offBow = Math.abs(off);

    this.field.spawnTsunami({
      x: ship.position.x, z: ship.position.z,
      dirX: this.dir.x, dirZ: this.dir.z,
      height: this.height,
      period: tier.period * (0.92 + Math.random() * 0.18),
      distance: tier.distance,
      crests: tier.crests,
    });
    this.field.tsuLife = 0;

    this.state = 'inbound';
    this.tStart = time;
    this.peakRoll = 0; this.peakPitch = 0; this.worstUp = 1;
    this.rollHistory.length = 0;
    return tier;
  }

  /**
   * Bearing of the incoming wave relative to the bow, in degrees.
   * Negative = coming from the port bow, positive = starboard bow.
   */
  bearingFromBow(ship) {
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.quaternion);
    const stbd = new THREE.Vector3(0, 0, 1).applyQuaternion(ship.quaternion);
    const fx = -this.dir.x, fz = -this.dir.z;      // direction the wave comes FROM
    return Math.atan2(fx * stbd.x + fz * stbd.z, fx * fwd.x + fz * fwd.z)
      * 57.2958;
  }

  update(dt, time, ship, shipState) {
    this.time = time;
    if (!this.active) return;
    const dist = this.distanceToCrest(ship.position);

    if (this.state === 'inbound') {
      if (dist < 0) this.state = 'active';
    } else if (this.state === 'active') {
      // the train has run past once the front is a long way astern
      const span = this.field.tsuWidth * 2 + 700;
      if (dist < -span) {
        this.state = 'clearing';
        this.field.tsuActive = false;
        this.clearingAt = time;
      }
    } else if (this.state === 'clearing') {
      if (time - this.clearingAt > 4) this.state = 'idle';
    }

    const a = shipState.attitude;
    this.peakRoll = Math.max(this.peakRoll, Math.abs(a.roll));
    this.peakPitch = Math.max(this.peakPitch, Math.abs(a.pitch));
    this.worstUp = Math.min(this.worstUp, a.up.y);
    this.rollHistory.push(a.roll);
    if (this.rollHistory.length > 240) this.rollHistory.shift();
  }

  /** Warning level 0..1 used for HUD colour + alarms. */
  get danger() {
    if (!this.tier) return 0;
    const base = this.tier.id === 'large' ? 0.75 : this.tier.id === 'medium' ? 0.4 : 0.15;
    return base;
  }
}
