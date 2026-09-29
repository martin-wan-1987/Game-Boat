/**
 * camera.js — several camera rigs.
 *
 *   orbit     free 360 deg look around the ship (the "watch her roll" view)
 *   chase     follows astern, lagged and damped
 *   bridge    locked to the island — you feel every degree of roll
 *   deck      standing on the flight deck
 *   cinema    parked in front of the tsunami, watching the ship take it
 *
 * In orbit mode the horizon stays level, which is exactly what you want when
 * judging how far over she is going.
 */
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
// scratch for the "keep the lens out of the hull" test (orbit mode)
const _qInv = new THREE.Quaternion();
const _loc = new THREE.Vector3();

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'orbit';

    this.radius = 620;
    this.theta = -0.6;        // azimuth around the ship
    this.phi = 1.12;          // polar (from +Y)
    this.minRadius = 40;
    this.maxRadius = 2600;
    this.minPhi = 0.18;
    this.maxPhi = 1.62;

    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.chasePos = new THREE.Vector3();
    this.chaseLook = new THREE.Vector3();
    this.fov = 48;
    this.shake = 0;
    this._snap = false;       // set true by setMode; consumed by the next update
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._tmp = new THREE.Vector3();
  }

  orbitBy(dx, dy) {
    this.theta -= dx;
    this.phi = THREE.MathUtils.clamp(this.phi - dy, this.minPhi, this.maxPhi);
  }

  zoomBy(d) {
    this.radius = THREE.MathUtils.clamp(
      this.radius * Math.pow(1.0016, d), this.minRadius, this.maxRadius);
  }

  setMode(m) {
    this.mode = m;
    // Every mode must SNAP on the first frame after a switch. Without this the
    // rig lerps from wherever the previous camera was — e.g. orbit at 600 m
    // straight through the hull into the bridge — and for several frames you
    // fly through the ship's interior. With DoubleSide materials those interior
    // faces flash black across the screen. Snapping kills that entirely.
    this._snap = true;
    if (m === 'chase') this._chaseInit = false;
    if (m === 'cinema') this._cineInit = false;
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  update(dt, shipObj, field, tsunamiDir, speed = 0) {
    this._t = (this._t || 0) + dt;
    const cam = this.camera;
    const shipPos = shipObj.position;
    this.target.copy(shipPos);
    this.target.y += 8;

    // One-frame snap after a mode switch (see setMode). Consumed here so the
    // very next frame goes back to smooth damping.
    const snap = this._snap;
    this._snap = false;

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
        const wy = field.heightAt(wanted.x, wanted.z) + 6;
        if (wanted.y < wy) wanted.y = wy;

        // ...and never let it go *inside* the hull. The hull is drawn
        // DoubleSide, so a camera that ends up within it sees unlit interior
        // faces — which strobe black as you orbit. Push the point outside an
        // ellipsoid that bounds hull + flight deck. (The island is FrontSide,
        // so clipping it is harmless and the close pass is left alone.)
        _qInv.copy(q).invert();
        _loc.copy(wanted).sub(shipPos).applyQuaternion(_qInv);
        _loc.y -= 4;
        const ex = _loc.x / 178, ey = _loc.y / 25, ez = _loc.z / 45;
        const dd = ex * ex + ey * ey + ez * ez;
        if (dd < 1) {
          const push = 1 / Math.sqrt(Math.max(dd, 1e-4));
          _loc.multiplyScalar(push);
          _loc.y += 4;
          wanted.copy(_loc).applyQuaternion(q).add(shipPos);
        }

        if (snap) cam.position.copy(wanted);
        else cam.position.lerp(wanted, 1 - Math.exp(-dt * 9));
        cam.lookAt(this.smoothTarget);
        break;
      }
      case 'chase': {
        const back = 300, up = 95;
        const wanted = shipPos.clone()
          .addScaledVector(fwd, -back)
          .addScaledVector(UP, up);
        const wy = field.heightAt(wanted.x, wanted.z) + 12;
        if (wanted.y < wy) wanted.y = wy;
        // snap on the first frame after switching, otherwise the rig slides in
        // from wherever it happened to be
        if (!this._chaseInit) { this.chasePos.copy(wanted); this._chaseInit = true; }
        const kk = snap ? 1 : (1 - Math.exp(-dt * 2.4));
        this.chasePos.lerp(wanted, kk);
        cam.position.copy(this.chasePos);
        cam.lookAt(this.smoothTarget.clone().addScaledVector(fwd, 120));
        break;
      }
      case 'bridge': {
        // In the nav-bridge house: eye 2.2 m above the deck of a bridge
        // whose FRONT IS OPEN (sill + window band + mullions — see
        // buildIsland). 3.5 m behind the glass, looking down the flight
        // deck toward the bow, which sits ~10° below the view axis and so
        // lands low in frame — you watch the deck rush and the stem part
        // the sea, exactly the reference view.
        const local = new THREE.Vector3(55.4, 38.9, 31);
        const p = local.clone().applyQuaternion(q).add(shipPos);
        // One rule for every rig: THE LENS NEVER GOES UNDER. A mega-tsunami
        // face or the final sink can bury the bridge itself — without this
        // clamp the camera sits inside opaque water and the screen is black.
        // Clamped, the view skims the crest instead: a wash-over, not a
        // blackout.
        const wy = field.heightAt(p.x, p.z) + 1.2;
        if (p.y < wy) p.y = wy;
        const look = new THREE.Vector3(600, 24, 24).applyQuaternion(q).add(shipPos);
        if (snap) cam.position.copy(p);
        else cam.position.lerp(p, 1 - Math.exp(-dt * 30));
        cam.lookAt(look);
        break;
      }
      case 'deck': {
        const local = new THREE.Vector3(-120, 21.8, -18);
        const p = local.clone().applyQuaternion(q).add(shipPos);
        // same never-underwater rule (see bridge)
        const wy = field.heightAt(p.x, p.z) + 1.2;
        if (p.y < wy) p.y = wy;
        const look = new THREE.Vector3(300, 14, -6).applyQuaternion(q).add(shipPos);
        if (snap) cam.position.copy(p);
        else cam.position.lerp(p, 1 - Math.exp(-dt * 30));
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
        const wy = field.heightAt(wanted.x, wanted.z) + 22;
        if (wanted.y < wy) wanted.y = wy;
        if (!this._cineInit) { this.chasePos.copy(wanted); this._cineInit = true; }
        const ck = snap ? 1 : (1 - Math.exp(-dt * 3.5));
        this.chasePos.lerp(wanted, ck);
        cam.position.copy(this.chasePos);
        cam.lookAt(this.smoothTarget);
        break;
      }
    }

    // ---- speed feedback -------------------------------------------
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

    // FOV eases toward its speed-dependent target instead of snapping
    const targetFov = this.fov + (firstPerson ? sp * 10 : sp * 3.5);
    if (Math.abs(cam.fov - targetFov) > 0.02) {
      cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-dt * 3.0));
      cam.updateProjectionMatrix();
    }
  }
}
