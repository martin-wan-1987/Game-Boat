/**
 * damage.js — progressive damage, fire, smoke and sinking.
 *
 * Damage is not scripted: it accumulates from things the physics actually
 * measures — slamming loads when the bow buries, deck-edge immersion at big
 * angles of heel, and capsize.
 *
 * When a ship is lost she does not vanish: she floods, settles, takes a list,
 * burns, and goes down over about a minute.
 */
import * as THREE from 'three';

export class DamageModel {
  constructor() {
    this.integrity = 100;      // 0..100
    this.flood = 0;            // 0..1
    this.listBias = 0;
    this.fires = [];           // {local:Vector3, intensity, kind}
    this.state = 'ok';         // ok | damaged | flooding | sinking | lost
    this.lostAt = 0;
    this.deckAwashTime = 0;
    this.slamAccum = 0;
    this.rollAccum = 0;
    this.smokeAcc = 0;
    this.emberAcc = 0;
    this.events = [];          // human-readable log
    this._v = new THREE.Vector3();
    this._lastFireSpawn = 0;
  }

  reset() {
    this.integrity = 100; this.flood = 0; this.listBias = 0;
    this.fires.length = 0; this.state = 'ok';
    this.deckAwashTime = 0; this.slamAccum = 0; this.rollAccum = 0;
    this.events.length = 0;
  }

  log(msg, t) {
    this.events.push({ msg, t });
    if (this.events.length > 40) this.events.shift();
  }

  /**
   * @param {number} dt
   * @param {object} ship   physics body
   * @param {object} waveField
   * @param {object} particles
   * @param {number} time
   */
  update(dt, ship, waveField, particles, time) {
    const att = ship.attitude;
    const rollDeg = Math.abs(att.roll) * 57.2958;
    const pitchDeg = Math.abs(att.pitch) * 57.2958;

    // ---- slamming damage -----------------------------------------
    // thresholded: a 1.5 m sea must do exactly nothing
    if (ship.slam > 0.10) {
      const dmg = (ship.slam - 0.10) * dt * 5.0;
      this.integrity -= dmg;
      this.slamAccum += dmg;
      if (ship.slam > 0.55 && time - this._lastFireSpawn > 8) {
        this._lastFireSpawn = time;
        this.log('艏部拍击！甲板受损', time);
        if (Math.random() < 0.45) this.igniteDeck();
      }
    }

    // ---- damage from extreme roll ---------------------------------
    if (rollDeg > 24) {
      const dmg = (rollDeg - 24) * dt * 0.14;
      this.integrity -= dmg;
      this.rollAccum += dmg;
    }
    if (pitchDeg > 12) {
      this.integrity -= (pitchDeg - 12) * dt * 0.06;
    }
    // structural failure if roll exceeds 38° (beyond design limit)
    if (rollDeg > 38) {
      this.integrity -= (rollDeg - 38) * dt * 0.45;
      this.flood = Math.min(1, this.flood + dt * 0.035);
    }

    // ---- deck edge immersion -> progressive flooding --------------
    // flight deck is 20 m up and 39 m out: she ships water past ~27 deg
    const deckEdgeAngle = Math.atan2(20, 39) * 57.2958;   // ~27.1 deg
    const awashThreshold = deckEdgeAngle * 0.85;            // ~23.0 deg
    if (rollDeg > awashThreshold) {
      this.deckAwashTime += dt;
      // rate grows with how far past the edge we are
      const rate = (rollDeg - awashThreshold) / 32;
      this.flood = Math.min(1, this.flood + rate * dt * 0.14);
      if (this.flood > 0.06 && this.state === 'ok') {
        this.state = 'flooding';
        this.log('甲板边缘进水，开始横倾', time);
      }
      // sustained extreme heel -> catastrophic down-flooding
      if (this.deckAwashTime > 14 && rollDeg > 25) {
        this.flood = Math.min(1, this.flood + dt * 0.022);
        if (Math.random() < dt * 0.10) {
          this.integrity -= dt * 3.0;
          if (Math.random() < 0.30) this.igniteDeck(0.65);
        }
      }
    } else {
      this.deckAwashTime = Math.max(0, this.deckAwashTime - dt * 0.35);
      // some of it drains back out
      this.flood = Math.max(0, this.flood - dt * 0.010);
    }

    // ---- capsize ---------------------------------------------------
    if (ship.capsized && this.state !== 'lost') {
      this.state = 'sinking';
      this.flood = Math.min(1, this.flood + 0.45);
      this.log('倾覆！弃船！', time);
      this.igniteDeck();
      this.igniteDeck();
    }

    // ---- flooding -> settling -------------------------------------
    if (this.flood > 0.18 && this.state !== 'sinking' && this.state !== 'lost') {
      this.state = 'sinking';
      this.log('大量进水，正在下沉', time);
    }
    if (this.state === 'sinking' || this.state === 'lost') {
      this.flood = Math.min(1, this.flood + dt * 0.012);
      this.listBias = Math.min(0.5, this.listBias + dt * 0.005);
    }

    ship.flood = this.flood;
    ship.list = this.listBias;

    // ---- loss condition: flight deck under water ------------------
    if (this.state !== 'lost') {
      const deckWorld = new THREE.Vector3(0, 20, 0)
        .applyQuaternion(ship.quaternion).add(ship.position);
      const sea = waveField.heightAt(deckWorld.x, deckWorld.z);
      if (deckWorld.y < sea + 1.0) {
        this.state = 'lost';
        this.lostAt = time;
        this.log('舰体沉没', time);
      }
      if (this.integrity <= 0 && this.state === 'ok') {
        this.state = 'flooding';
        this.log('舰体结构受损严重', time);
      }
    }

    this.integrity = Math.max(0, this.integrity);

    // ---- fires -----------------------------------------------------
    for (const f of this.fires) {
      f.intensity = Math.min(1, f.intensity + dt * 0.05);
    }
    // spontaneous small fires when badly hurt
    if (this.integrity < 65 && this.fires.length < 5 && Math.random() < dt * 0.06) {
      this.igniteDeck(0.35);
    }

    this.emitSmoke(dt, ship, waveField, particles, time);
  }

  igniteDeck(intensity = 0.55) {
    if (this.fires.length > 8) return;
    const local = new THREE.Vector3(
      THREE.MathUtils.randFloat(-150, 150),
      20.6,
      THREE.MathUtils.randFloat(-36, 36),
    );
    this.fires.push({ local, intensity, kind: 'deck' });
    // and something below decks, which vents through the hull
    if (Math.random() < 0.6) {
      this.fires.push({
        local: new THREE.Vector3(
          THREE.MathUtils.randFloat(-120, 60), 24,
          THREE.MathUtils.randFloat(26, 37)),
        intensity: intensity * 0.8, kind: 'interior',
      });
    }
  }

  emitSmoke(dt, ship, waveField, particles, time) {
    const q = ship.quaternion;
    const p = this._v;
    for (const f of this.fires) {
      const rate = 14 * f.intensity;
      this.smokeAcc += rate * dt;
      const n = Math.floor(this.smokeAcc);
      this.smokeAcc -= n;
      for (let i = 0; i < n; i++) {
        p.copy(f.local).applyQuaternion(q).add(ship.position);
        const jitter = f.kind === 'deck' ? 7 : 3;
        particles.spawn(
          p.x + (Math.random() - 0.5) * jitter,
          p.y + Math.random() * 2,
          p.z + (Math.random() - 0.5) * jitter,
          (Math.random() - 0.5) * 2.5, 1.5 + Math.random() * 3,
          (Math.random() - 0.5) * 2.5,
          6 + Math.random() * 8,
          9 + Math.random() * 10,
          1,
        );
      }
      // embers for deck fires
      if (f.kind === 'deck') {
        this.emberAcc += 4 * f.intensity * dt;
        const m = Math.floor(this.emberAcc);
        this.emberAcc -= m;
        for (let i = 0; i < m; i++) {
          p.copy(f.local).applyQuaternion(q).add(ship.position);
          particles.spawn(
            p.x + (Math.random() - 0.5) * 6, p.y + 1, p.z + (Math.random() - 0.5) * 6,
            (Math.random() - 0.5) * 7, 4 + Math.random() * 7, (Math.random() - 0.5) * 7,
            1.6 + Math.random() * 2.2, 1.6 + Math.random() * 2.4, 2,
          );
        }
      }
    }
  }

  /** Water pouring over the bow when she buries — a huge visual. */
  emitGreenWater(dt, ship, waveField, particles, time, slam) {
    if (slam < 0.25) return;
    const q = ship.quaternion;
    const acc = slam * 220 * dt;
    this._gwAcc = (this._gwAcc || 0) + acc;
    const n = Math.floor(this._gwAcc);
    this._gwAcc -= n;
    for (let i = 0; i < n; i++) {
      const local = new THREE.Vector3(
        168 - Math.random() * 60,
        21 + Math.random() * 2,
        (Math.random() - 0.5) * 70,
      );
      const p = local.applyQuaternion(q).add(ship.position);
      particles.spawn(
        p.x, p.y, p.z,
        (Math.random() - 0.5) * 5,
        2 + Math.random() * 6,
        (Math.random() - 0.5) * 5,
        1.2 + Math.random() * 1.6,
        6 + Math.random() * 8,
        0,
      );
    }
  }
}
