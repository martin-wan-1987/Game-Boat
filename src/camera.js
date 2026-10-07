/**
 * camera.js — several camera rigs.
 *
 *   orbit     free 360 deg look around the ship (the "watch her roll" view)
 *   chase     follows astern, lagged and damped
 *   bridge    locked to the island — you feel every degree of roll
 *   deck      standing on the flight deck
 *   cinema    parked in front of the tsunami, watching the ship take it
 *   walk      FIRST PERSON on the flight deck: WASD to walk, Shift to run,
 *             drag to look — air-walled to the deck outline (see walkStep)
 *
 * In orbit mode the horizon stays level, which is exactly what you want when
 * judging how far over she is going.
 */
import * as THREE from 'three';
import { SHIP } from './carrier-layout.js';
import { createDeckWalk } from './deck-walk.js';
import {deckHeightAt} from './deck-surface.js';
import {cameraModes} from './vessel-capabilities.js';

const UP = new THREE.Vector3(0, 1, 0);
// scratch for the "keep the lens out of the hull" test (orbit mode)
const _qInv = new THREE.Quaternion();
const _loc = new THREE.Vector3();

// Project the final camera position after interpolation and impact shake.
const CLEARANCE = { orbit: 6, chase: 12, cinema: 22, bridge: 1.2, deck: 1.2, walk: 1.2 };
export const HOME_ORBIT = Object.freeze({ radius: 440, theta: 0.72, phi: 1.12 });

export class CameraRig {
  constructor(camera, vessel=SHIP) {
    this.setVessel(vessel);
    this.camera = camera;
    this.mode = 'orbit';

    Object.assign(this, this.home);
    this.maxRadius = 2600;
    this.minPhi = 0.18;
    this.maxPhi = 1.62;

    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.chasePos = new THREE.Vector3();
    this.chaseLook = new THREE.Vector3();
    this.previousShipPosition=new THREE.Vector3();
    this.translation=new THREE.Vector3();
    this.fov = 48;
    this.shake = 0;
    this._snap = false;       // set true by setMode; consumed by the next update
    // walk-mode state (ship-local): position on deck, facing, head bob
    [this.walkX,this.walkZ] = vessel.walkStart;
    this.walkYaw = 0;         // 0 = facing the bow (+x)
    this.walkPitch = 0;
    this.walkPhase = 0;
    this.walkRun = false;     // E toggles run mode (sticky, not held)
    this.walkVX = 0;          // smoothed ship-local velocity
    this.walkVZ = 0;
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._tmp = new THREE.Vector3();
  }

  setVessel(vessel) {
    this.vessel=vessel;this.walkSurface=createDeckWalk(vessel);
    if(this.mode&&!cameraModes(vessel).includes(this.mode))this.mode='orbit';
    this.home={...HOME_ORBIT,radius:HOME_ORBIT.radius*vessel.length/SHIP.length};
    this.minRadius=40*vessel.length/SHIP.length;
    [this.walkX,this.walkZ]=vessel.walkStart;Object.assign(this,this.home);this._snap=true;
  }

  orbitBy(dx, dy) {
    this.theta -= dx;
    this.phi = THREE.MathUtils.clamp(this.phi - dy, this.minPhi, this.maxPhi);
  }

  /** Mouse-look for the walk rig (drag = turn head). */
  walkLook(dx, dy) {
    this.walkYaw -= dx;
    this.walkPitch = THREE.MathUtils.clamp(this.walkPitch - dy, -1.15, 1.15);
  }

  /**
   * Walk-rig frame: WASD/Shift movement in ship-local space, air-walled to
   * the deck outline (inset ~0.9 m — the rail) and pushed out of the island
   * and weapon mounts. The camera rides the deck (she heels, you heel) and
   * the lens obeys the never-underwater rule like every other rig.
   */
  walkStep(dt, keys, shipObj, field) {
    // speed eases in and out (~0.25 s ramp): instant start/stop is what
    // made the first version of the walker feel like a sliding cursor
    const sp = this.walkRun ? 35 : 9.6;
    let f = 0, s = 0;
    if (keys.has('w')) f += 1;
    if (keys.has('s')) f -= 1;
    if (keys.has('a')) s -= 1;
    if (keys.has('d')) s += 1;
    let tvx = 0, tvz = 0;              // target velocity, ship-local
    if (f || s) {
      const l = Math.hypot(f, s);
      const fx = Math.cos(this.walkYaw), fz = -Math.sin(this.walkYaw);
      const sx = -fz, sz = fx;
      tvx = (f * fx + s * sx) * (sp / l);
      tvz = (f * fz + s * sz) * (sp / l);
    }
    const k = 1 - Math.exp(-dt * 9);
    this.walkVX += (tvx - this.walkVX) * k;
    this.walkVZ += (tvz - this.walkVZ) * k;
    if (Math.abs(this.walkVX) < 0.01) this.walkVX = 0;
    if (Math.abs(this.walkVZ) < 0.01) this.walkVZ = 0;
    // One projection preserves BOTH the deck rail and all obstacle margins.
    [this.walkX, this.walkZ] = this.walkSurface.projectDeckWalk(
      this.walkX + this.walkVX * dt, this.walkZ + this.walkVZ * dt);

    // ---- camera ------------------------------------------------------
    const cam = this.camera;
    // bob amplitude scales with the SMOOTHED speed (no pop on keypress);
    // frequency with speed too. A slight lateral sway sells the stride.
    const spd = Math.hypot(this.walkVX, this.walkVZ);
    const gait = Math.min(1, spd / 7);
    this.walkPhase += dt * (1.6 + spd * 1.35);
    const bob = Math.sin(this.walkPhase * 2) * 0.055 * gait
              + Math.sin(this.walkPhase * 0.5) * 0.008;
    const sway = Math.sin(this.walkPhase) * 0.02 * gait;
    const eye = this._v.set(this.walkX, deckHeightAt(this.vessel,this.walkX) + 1.72 + bob, this.walkZ)
      .applyQuaternion(shipObj.quaternion).add(shipObj.position);
    // never under water — same rule as every rig
    const wy = field.heightAt(eye.x, eye.z) + CLEARANCE.walk;
    if (eye.y < wy) eye.y = wy;
    cam.position.copy(eye);
    // attitude: ship's heel/pitch carried into the head, then yaw/pitch
    this._e.set(this.walkPitch, this.walkYaw, sway, 'YXZ');
    cam.quaternion.setFromEuler(this._e).premultiply(shipObj.quaternion);
    // a touch of FOV stretch at full run — speed you can feel
    const wantFov = this.fov + gait * gait * 6;
    if (Math.abs(cam.fov - wantFov) > 0.02) {
      cam.fov += (wantFov - cam.fov) * (1 - Math.exp(-dt * 4));
      cam.updateProjectionMatrix();
    }
  }

  zoomBy(d) {
    this.radius = THREE.MathUtils.clamp(
      this.radius * Math.pow(1.0016, d), this.minRadius, this.maxRadius);
  }

  setMode(m) {
    if(!cameraModes(this.vessel).includes(m))return false;
    this.mode = m;
    // Every mode must SNAP on the first frame after a switch. Without this the
    // rig lerps from wherever the previous camera was — e.g. orbit at 600 m
    // straight through the hull into the bridge — and for several frames you
    // fly through the ship's interior. With DoubleSide materials those interior
    // faces flash black across the screen. Snapping kills that entirely.
    this._snap = true;
    if (m === 'chase') this._chaseInit = false;
    if (m === 'cinema') this._cineInit = false;
    return true;
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  update(dt, shipObj, field, tsunamiDir, speed = 0,view={}) {
    this._t = (this._t || 0) + dt;
    const cam = this.camera;
    const shipPos = shipObj.position;
    this.target.copy(shipPos);
    this.target.y += this.vessel.deckY*.4;

    // One-frame snap after a mode switch (see setMode). Consumed here so the
    // very next frame goes back to smooth damping.
    const snap = this._snap;
    this._snap = false;

    // Translation is inherited exactly; damping only smooths relative framing.
    // A world-space low-pass alone trails a small fast craft by speed / rate.
    this.translation.copy(shipPos).sub(this.previousShipPosition);
    if(!snap&&(this.mode==='orbit'||this.mode==='chase')){
      cam.position.add(this.translation);this.chasePos.add(this.translation);this.smoothTarget.add(this.translation);
    }
    this.previousShipPosition.copy(shipPos);

    // damped follow of the look-at point (snaps with the camera, otherwise the
    // new view would be looking at wherever the old one was aimed)
    const k = snap ? 1 : (1 - Math.exp(-dt * 4.5));
    this.smoothTarget.lerp(this.target, k);

    const q = shipObj.quaternion;
    const fwd = this._v.set(1, 0, 0).applyQuaternion(q);
    const stbd = this._tmp.set(0, 0, 1).applyQuaternion(q);

    switch (this.mode) {
      case 'orbit': {
        const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
        const off = new THREE.Vector3(
          sp * Math.sin(this.theta) * this.radius,
          cp * this.radius,
          sp * Math.cos(this.theta) * this.radius,
        );
        // never let the camera go under the waves
        const wanted = this.smoothTarget.clone().add(off);
        const wy = field.heightAt(wanted.x, wanted.z) + CLEARANCE.orbit;
        if (wanted.y < wy) wanted.y = wy;

        // ...and never *inside* the ship. Two exclusion volumes in ship-local
        // space: the hull+deck ellipsoid, and one around the ISLAND. The
        // island was long uncovered — orbiting high and close put the lens
        // inside the tower, and the near plane slicing its walls threw torn
        // black triangles across the view. The 1.06 push-out margin keeps
        // the lens beyond the near plane after the correction.
        _qInv.copy(q).invert();
        _loc.copy(wanted).sub(shipPos).applyQuaternion(_qInv);
        const pushOutOf = (cx, cy, cz, ex, ey, ez) => {
          const dx = (_loc.x - cx) / ex, dy = (_loc.y - cy) / ey, dz = (_loc.z - cz) / ez;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < 1.0) {
            const push = 1.06 / Math.sqrt(Math.max(d, 1e-4));
            _loc.x = cx + (_loc.x - cx) * push;
            _loc.y = cy + (_loc.y - cy) * push;
            _loc.z = cz + (_loc.z - cz) * push;
            return true;
          }
          return false;
        };
        // hull + flight deck + gallery band
        const margin=this.vessel.length*.029;
        const inHull = pushOutOf(0, this.vessel.deckY/2, 0, this.vessel.length/2+margin, (this.vessel.deckY+this.vessel.draft)/2+margin*.9, this.vessel.deckHalfWidth+margin*1.2);
        const island = this.vessel.superstructure;
        const inIsland = pushOutOf(island.x, island.centreY, island.z, island.length / 2 + margin*.7, (island.topY-this.vessel.deckY)/2+margin*.9, island.width / 2 + margin*.7);
        if (inHull || inIsland) {
          wanted.copy(_loc).applyQuaternion(q).add(shipPos);
        }

        if (snap) cam.position.copy(wanted);
        else cam.position.lerp(wanted, 1 - Math.exp(-dt * 9));
        cam.lookAt(this.smoothTarget);
        break;
      }
      case 'chase': {
        const back = this.vessel.length*.88, up = this.vessel.length*.28;
        const wanted = shipPos.clone()
          .addScaledVector(fwd, -back)
          .addScaledVector(UP, up);
        const wy = field.heightAt(wanted.x, wanted.z) + CLEARANCE.chase;
        if (wanted.y < wy) wanted.y = wy;
        // snap on the first frame after switching, otherwise the rig slides in
        // from wherever it happened to be
        if (!this._chaseInit) { this.chasePos.copy(wanted); this._chaseInit = true; }
        const kk = snap ? 1 : (1 - Math.exp(-dt * 2.4));
        this.chasePos.lerp(wanted, kk);
        cam.position.copy(this.chasePos);
        cam.lookAt(this.smoothTarget.clone().addScaledVector(fwd, this.vessel.length*.35));
        break;
      }
      case 'bridge': {
        // In the nav-bridge house: eye 2.2 m above the deck of a bridge
        // whose FRONT IS OPEN (sill + window band + mullions — see
        // buildIsland). 3.5 m behind the glass, looking down the flight
        // deck toward the bow, which sits ~10° below the view axis and so
        // lands low in frame — you watch the deck rush and the stem part
        // the sea, exactly the reference view.
        const local = new THREE.Vector3(...(view.bridgeOptic?view.bridgeEye:this.vessel.bridgeEye));
        const p = local.clone().applyQuaternion(q).add(shipPos);
        // One rule for every rig: THE LENS NEVER GOES UNDER. A mega-tsunami
        // face or the final sink can bury the bridge itself — without this
        // clamp the camera sits inside opaque water and the screen is black.
        // Clamped, the view skims the crest instead: a wash-over, not a
        // blackout.
        const wy = field.heightAt(p.x, p.z) + CLEARANCE.bridge;
        if (p.y < wy) p.y = wy;
        const look = new THREE.Vector3(this.vessel.length*1.75, this.vessel.deckY+this.vessel.length*.0117, this.vessel.bridgeEye[2]).applyQuaternion(q).add(shipPos);
        // A mounted eye inherits the ship's complete rigid transform. World
        // position damping leaves it astern by v/30 and inside fast vessels.
        cam.position.copy(p);
        cam.lookAt(look);
        break;
      }
      case 'deck': {
        // 2.4 m above the deck (the catwalk edge), looking down the flight
        // deck toward the bow. Slightly higher than eye height on purpose:
        // at exactly 1.8 m a few degrees of pitch dips the lens below the
        // deck plane ahead, which used to read as a black flash.
        const local = new THREE.Vector3(...this.vessel.deckEye);
        const p = local.clone().applyQuaternion(q).add(shipPos);
        // same never-underwater rule (see bridge)
        const wy = field.heightAt(p.x, p.z) + CLEARANCE.deck;
        if (p.y < wy) p.y = wy;
        const look = new THREE.Vector3(this.vessel.length*.88, this.vessel.deckY-this.vessel.length*.0175, -this.vessel.beamWater*.148).applyQuaternion(q).add(shipPos);
        cam.position.copy(p);
        cam.lookAt(look);
        break;
      }
      case 'cinema': {
        const d = tsunamiDir || fwd;
        // Park SEAWARD of the leading crest, retreating as the wave closes,
        // so the wall never runs over the lens. The old rig sat between the
        // ship and the wave: the near-breaking crest (15 m+, curling lip
        // overhanging the surface) passed THROUGH the camera on its way in,
        // and for the second or two that the lip was over the lens the
        // screen was the inside of an opaque wave — a full black flash.
        // Switching into this view mid-event could also spawn the camera
        // inside the wave group; the crest-distance clamp fixes that too.
        let dist = 480;
        const dCrest = field.distanceToCrest(shipPos.x, shipPos.z);
        if (isFinite(dCrest) && dCrest > 0 && dCrest < 640) {
          dist = Math.max(170, Math.min(480, dCrest - 150));
        }
        const wanted = shipPos.clone()
          .addScaledVector(d, dist)
          .addScaledVector(stbd, 260)
          .add(new THREE.Vector3(0, 75, 0));
        // clearance for the curling lip, not just the surface underfoot
        const wy = field.heightAt(wanted.x, wanted.z) + CLEARANCE.cinema;
        if (wanted.y < wy) wanted.y = wy;
        if (!this._cineInit) { this.chasePos.copy(wanted); this._cineInit = true; }
        const ck = snap ? 1 : (1 - Math.exp(-dt * 3.5));
        this.chasePos.lerp(wanted, ck);
        cam.position.copy(this.chasePos);
        cam.lookAt(this.smoothTarget);
        break;
      }
      case 'walk': {
        // handled by walkStep(), driven from the main loop every frame
        break;
      }
    }
    // A rig that looks identical at 3 kn and 32 kn feels dead. Three cues,
    // all scaling with speed over ground:
    //   • FOV opens up (the "world rushing at you" effect) — strong in the
    //     first-person rigs, gentle in orbit
    //   • a fine, high-frequency vibration through the hull (4 shafts)
    //   • the chase rig drops back a little so she visibly pulls away
    // In bridge/deck the vibration is ROTATIONAL, not translational: with
    // window mullions and sills a couple of metres from the lens, moving the
    // camera amplifies parallax and the frames strobe against the scene.
    // A tiny rotation reads as the hull trembling with everything moving
    // together — which is what actually happens when you stand there.
    const sp = THREE.MathUtils.clamp(speed / 16, 0, 1);
    const firstPerson = this.mode === 'bridge' || this.mode === 'deck'
                     || this.mode === 'chase';
    if (firstPerson && sp > 0.02) {
      const amp = sp * sp * 0.16;
      const tt = this._t;
      if (this.mode === 'chase') {
        cam.position.y += Math.sin(tt * 41.0) * amp + Math.sin(tt * 67.0) * amp * 0.5;
        cam.position.x += Math.sin(tt * 53.0) * amp * 0.6;
        cam.position.z += Math.cos(tt * 47.0) * amp * 0.6;
      } else {
        const ra = amp * 0.035;
        cam.rotateX(Math.sin(tt * 41.0) * ra + Math.sin(tt * 67.0) * ra * 0.5);
        cam.rotateZ(Math.sin(tt * 53.0) * ra * 0.7);
        cam.rotateY(Math.cos(tt * 47.0) * ra * 0.7);
      }
    }

    // impact shake — same rule: rotate the close-up rigs, translate the rest
    if (this.shake > 0.001) {
      const s = this.shake * 2.2;
      if (this.mode === 'bridge' || this.mode === 'deck') {
        cam.rotateX((Math.random() - 0.5) * s * 0.012);
        cam.rotateZ((Math.random() - 0.5) * s * 0.012);
        cam.rotateY((Math.random() - 0.5) * s * 0.008);
      } else {
        cam.position.x += (Math.random() - 0.5) * s;
        cam.position.y += (Math.random() - 0.5) * s;
        cam.position.z += (Math.random() - 0.5) * s;
      }
      this.shake *= Math.exp(-dt * 3.2);
    }

    cam.position.y = Math.max(cam.position.y,
      field.heightAt(cam.position.x, cam.position.z) + CLEARANCE[this.mode]);

    // FOV eases toward its speed-dependent target instead of snapping
    const targetFov = view.bridgeOptic?32:this.fov + (firstPerson ? sp * 10 : sp * 3.5);
    if (Math.abs(cam.fov - targetFov) > 0.02) {
      cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-dt * 3.0));
      cam.updateProjectionMatrix();
    }
  }
}
