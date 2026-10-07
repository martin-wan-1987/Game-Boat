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
import { SHIP } from './carrier-layout.js';
const STRUCTURAL_LIMITS={rollElastic:24,rollFailure:38,pitchElastic:12};

export class DamageModel {
  constructor(vessel=SHIP) {
    this.vessel=vessel;
    this.limits={...STRUCTURAL_LIMITS,...vessel.structural};
    this.integrity = 100;      // 0..100
    this.flood = 0;            // 0..1
    this.listBias = 0;
    this.fires = [];           // {local:Vector3, intensity, kind}
    this.state = 'ok';         // ok | damaged | flooding | sinking | lost
    this.lostAt = 0;
    this.underT = 0;
    this.deckAwashTime = 0;
    this.slamAccum = 0;
    this.rollAccum = 0;
    this.smokeAcc = 0;
    this.emberAcc = 0;
    this.events = [];          // human-readable log
    this._v = new THREE.Vector3();
    this._lossPoint = new THREE.Vector3(...vessel.lossPoint);
    this._lastFireSpawn = 0;
  }

  reset() {
    this.integrity = 100; this.flood = 0; this.listBias = 0;
    this.fires.length = 0; this.state = 'ok';
    this.deckAwashTime = 0; this.slamAccum = 0; this.rollAccum = 0;
    this.events.length = 0;
    this.underT = 0;
    this.lostAt = 0;
    this._lastFireSpawn = 0;
    this.smokeAcc = 0;
    this.emberAcc = 0;
  }

  log(msg, t) {
    this.events.push({ msg, t });
    if (this.events.length > 40) this.events.shift();
  }

  impact(energy,local,time,mass){
    const loss=100*-Math.expm1(-energy/(mass*80));
    this.integrity=Math.max(0,this.integrity-loss);
    if(this.state==='ok')this.state='damaged';
    if(this.integrity<35)this.flood=Math.min(1,this.flood+(35-this.integrity)/35*.07);
    this.fires.push({local:local.clone(),intensity:Math.min(.7,loss/30),kind:'deck'});
    this.log(`陨石碎块命中 · 完整度 -${loss.toFixed(1)}`,time);
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
    if (rollDeg > this.limits.rollElastic) {
      const dmg = (rollDeg - this.limits.rollElastic) * dt * 0.14;
      this.integrity -= dmg;
      this.rollAccum += dmg;
    }
    if (pitchDeg > this.limits.pitchElastic) {
      this.integrity -= (pitchDeg - this.limits.pitchElastic) * dt * 0.06;
    }
    // structural failure if roll exceeds 38° (beyond design limit)
    if (rollDeg > this.limits.rollFailure) {
      this.integrity -= (rollDeg - this.limits.rollFailure) * dt * 0.45;
      this.flood = Math.min(1, this.flood + dt * 0.035);
    }

    // ---- deck edge immersion -> progressive flooding --------------
    // flight deck is 20 m up and 39 m out: she ships water past ~27 deg
    const deckEdgeAngle = Math.atan2(this.vessel.downflood.height, this.vessel.downflood.halfBeam) * 57.2958;   // ~27.1 deg
    const awashThreshold = deckEdgeAngle * 0.85;            // ~23.0 deg
    if (!this.vessel.downflood.sealed && rollDeg > awashThreshold) {
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
      this.flood = Math.max(0, this.flood - dt * 0.010);
    }

    // ---- capsize ---------------------------------------------------
    if (!this.vessel.downflood.sealed && ship.capsized && this.state !== 'sinking' && this.state !== 'lost') {
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
    // Sustained: the mega-wall buries the whole ship for seconds while she
    // climbs/descends the face — that is surviving, not sinking. She only
    // counts as lost once she has stayed under for six continuous seconds
    // AND is no longer fighting her way back up.
    if (this.state !== 'lost') {
      const deckWorld = ship.localToWorld(this._lossPoint, this._v);
      const sea = waveField.heightAt(deckWorld.x, deckWorld.z);
      const downflooding=!this.vessel.downflood.sealed||this.flood>.18;
      if (downflooding && deckWorld.y < sea + 1.0 && ship.velocity.y < 2.0) {
        this.underT += dt;
        if (this.underT > 6) {
          this.state = 'lost';
          this.lostAt = time;
          this.log('舰体沉没', time);
        }
      } else {
        this.underT = 0;
      }
      // A hull that is essentially full of water is lost, full stop — the
      // bobbing rule above would otherwise keep a dead ship "alive" forever
      // whenever the sea lifts her rail clear every few seconds.
      if (this.flood >= 0.995) {
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
    const x = THREE.MathUtils.randFloat(-this.vessel.length*.43, this.vessel.length*.43);
    const local = new THREE.Vector3(
      x,
      this.vessel.deckY+.6,
      THREE.MathUtils.randFloat(-this.vessel.deckHalfWidthAt(x,-1)*.84, this.vessel.deckHalfWidthAt(x,1)*.84),
    );
    this.fires.push({ local, intensity, kind: 'deck' });
    // and something below decks, which vents through the hull
    if (Math.random() < 0.6) {
      this.fires.push({
        local: new THREE.Vector3(
          this.vessel.superstructure.x, this.vessel.superstructure.topY,
          this.vessel.superstructure.z),
        intensity: intensity * 0.8, kind: 'interior',
      });
    }
  }

  emitSmoke(dt, ship, waveField, particles, time) {
    const p = this._v;
    for (const f of this.fires) {
      const rate = 14 * f.intensity;
      this.smokeAcc += rate * dt;
      const n = Math.floor(this.smokeAcc);
      this.smokeAcc -= n;
      for (let i = 0; i < n; i++) {
        ship.localToWorld(f.local, p);
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
          ship.localToWorld(f.local, p);
          particles.spawn(
            p.x + (Math.random() - 0.5) * 6, p.y + 1, p.z + (Math.random() - 0.5) * 6,
            (Math.random() - 0.5) * 7, 4 + Math.random() * 7, (Math.random() - 0.5) * 7,
            1.6 + Math.random() * 2.2, 1.6 + Math.random() * 2.4, 2,
          );
        }
      }
    }
  }

}
