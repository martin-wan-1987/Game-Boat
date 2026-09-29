/**
 * physics.js — rigid-body ship dynamics.
 *
 * The hull is discretised into ~500 small surface patches. Every step, each
 * patch that is under the water line contributes
 *
 *    buoyancy   F = -rho * g * depth * area * n            (n = outward normal)
 *    drag       F = -0.5 * rho * Cd * area * |v_n| * v_n * n
 *
 * where v_n is the patch velocity *relative to the water*, and the water
 * velocity comes straight out of the Gerstner wave field. Summing those gives
 * heave, pitch, roll, the righting-arm curve, deck-edge immersion, slamming
 * when the bow buries, capsize and floating upside-down — all emergent rather
 * than scripted.
 */
import * as THREE from 'three';
import { SHIP } from './ship.js';

const RHO = 1025;          // sea water kg/m^3
const G = 9.81;
const DEPTH = 150;         // sea floor depth (m) — for anchoring

export class ShipPhysics {
  constructor(patches, opts = {}) {
    this.patches = patches;
    this.mass = opts.mass ?? SHIP.mass;
    // A real hull is never perfectly symmetric — a small permanent list both
    // looks right and, more importantly, seeds parametric rolling. On a
    // perfectly symmetric hull with a perfectly symmetric wave the roll
    // instability sits at an exact equilibrium and never grows.
    this.cg = new THREE.Vector3(opts.cgX ?? 3.0, opts.cgY ?? 0, opts.cgZ ?? 0.15);

    // inertia about the CG, local frame (x fwd, y up, z stbd)
    const kx = opts.gyradiusRoll ?? 20.5;
    const ky = opts.gyradiusYaw ?? 94;
    const kz = opts.gyradiusPitch ?? 95;
    this.inertia = new THREE.Vector3(
      this.mass * kx * kx,
      this.mass * ky * ky,
      this.mass * kz * kz,
    );
    this.invInertia = new THREE.Vector3(
      1 / this.inertia.x, 1 / this.inertia.y, 1 / this.inertia.z,
    );

    // added mass / inertia of the surrounding water
    this.addedMassLin = 0.18;
    this.addedMassAng = 0.22;

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.omega = new THREE.Vector3();

    // controls
    this.throttle = 0;          // -0.35 .. 1
    this.rudder = 0;            // -1 .. 1 (command)
    this.rudderAngle = 0;       // actual, rate limited
    this.anchorDown = false;
    this.anchorPos = new THREE.Vector3();
    this.anchorChain = 0;       // length paid out (m)
    this.anchorTarget = 0;

    this.flood = 0;             // 0..1 progressive flooding
    this.list = 0;              // permanent list bias from flooding

    // diagnostics
    this.lastForces = { thrust: 0, drag: 0, buoy: 0, chain: 0 };
    this.slam = 0;              // impact intensity this frame
    this.emerged = 0;           // 0..1 how much of the hull is out of the water

    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._cross = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._wp = new THREE.Vector3();
    this._sample = {};
    this._Iw = new THREE.Matrix3();
    this._R = new THREE.Matrix3();
    // step() runs up to 6x per frame at 120 Hz — every vector it touches is
    // preallocated scratch, otherwise GC churn alone causes visible stutter.
    this._tmpF = new THREE.Vector3();
    this._stbd = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._clr = new THREE.Vector3(-22, -7, 0);
    this._screw = new THREE.Vector3(-150, -8, 0);
    this._rudderPt = new THREE.Vector3(-158, -9, 0);
    this._bow = new THREE.Vector3(HALF_L_FWD, -6, 0);
    this._dir = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._vRel = new THREE.Vector3();
    this._m4 = new THREE.Matrix4();
    this._qi = new THREE.Quaternion();
    this._Iv = new THREE.Vector3();
    this._wLoc = new THREE.Vector3();
    this._L = new THREE.Vector3();
    this._Lw = new THREE.Vector3();
    this._gyro = new THREE.Vector3();
    this._tau = new THREE.Vector3();

    this.calibrate(patches);
  }

  /**
   * Scale patch areas so that, floating at the design draft with the CG at the
   * origin, total buoyancy exactly balances weight. Guarantees the ship floats
   * where it is drawn.
   */
  calibrate(patches) {
    let sum = 0;
    for (const p of patches) {
      const d = 0 - p.pos.y;              // depth below still water level
      if (d > 0) sum += d * p.area * -p.nrm.y;
    }
    const need = this.mass * G;
    this.areaScale = sum > 1e-6 ? need / (RHO * G * sum) : 1;
    for (const p of patches) p.area *= this.areaScale;
  }

  reset(x, z, heading) {
    this.position.set(x, 0, z);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    this.velocity.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.throttle = 0;
    this.rudderAngle = 0;
    this.flood = 0;
    this.list = 0;
    this.anchorDown = false;
    this.anchorChain = 0;
    this.anchorTarget = 0;
  }

  /* ---------------- helpers ---------------- */

  localToWorld(local, out) {
    return out.copy(local).sub(this.cg).applyQuaternion(this.quaternion)
      .add(this.position);
  }

  /** World inverse-inertia matrix: R * I^-1 * R^T (diagonal local inertia). */
  updateWorldInertia() {
    const e = this._m4.makeRotationFromQuaternion(this.quaternion)
      .elements;
    // R columns
    const r00 = e[0], r01 = e[4], r02 = e[8];
    const r10 = e[1], r11 = e[5], r12 = e[9];
    const r20 = e[2], r21 = e[6], r22 = e[10];
    const ix = this.invInertia.x, iy = this.invInertia.y, iz = this.invInertia.z;
    // M = R * diag(i) * R^T
    const m00 = r00 * ix * r00 + r01 * iy * r01 + r02 * iz * r02;
    const m01 = r00 * ix * r10 + r01 * iy * r11 + r02 * iz * r12;
    const m02 = r00 * ix * r20 + r01 * iy * r21 + r02 * iz * r22;
    const m11 = r10 * ix * r10 + r11 * iy * r11 + r12 * iz * r12;
    const m12 = r10 * ix * r20 + r11 * iy * r21 + r12 * iz * r22;
    const m22 = r20 * ix * r20 + r21 * iy * r21 + r22 * iz * r22;
    this._Iw.set(m00, m01, m02, m01, m11, m12, m02, m12, m22);
    return this._Iw;
  }

  applyForceAtPoint(force, worldPoint, outForce, outTorque) {
    outForce.add(force);
    this._r.copy(worldPoint).sub(this.position);
    // NB: dedicated scratch vector — outTorque may itself alias this._t
    this._cross.crossVectors(this._r, force);
    outTorque.add(this._cross);
  }

  /* ---------------- main step ---------------- */

  /**
   * @param {number} dt      seconds (already sub-stepped by caller)
   * @param {WaveField} field
   */
  step(dt, field) {
    const F = this._f.set(0, 0, 0);
    const T = this._t.set(0, 0, 0);
    const tmpF = this._tmpF;

    // flooding adds real weight; added mass only changes how fast the hull
    // responds to a force, it is not weight. The flood² term is what makes a
    // fully-flooded hull actually go under: a linear ×0.55 only deepens the
    // draft to ~19 m — the 20 m flight deck stays dry and she floats
    // half-full forever. Quadratic growth passes neutral buoyancy near
    // flood = 1, which is physically what "full of water" means.
    const trueMass = this.mass * (1 + this.flood * 0.55 + this.flood * this.flood * 1.3);
    const massEff = trueMass * (1 + this.addedMassLin);

    // ---- gravity -------------------------------------------------
    F.y -= trueMass * G;

    // ---- hydrostatics + hydrodynamics per patch -------------------
    let buoySum = 0;
    let submerged = 0;
    let slamAcc = 0;
    let dragAcc = 0;
    const sample = this._sample;

    for (let i = 0; i < this.patches.length; i++) {
      const patch = this.patches[i];
      // world position of the patch
      const wp = this._wp.copy(patch.pos).sub(this.cg)
        .applyQuaternion(this.quaternion).add(this.position);

      field.sampleWorld(wp.x, wp.z, sample, 3);
      const depth = sample.y - wp.y;
      if (depth <= 0) continue;

      submerged++;
      const area = patch.area;

      // world normal
      const n = this._n.copy(patch.nrm).applyQuaternion(this.quaternion);

      // ---- buoyancy ----
      // ∮ p n dA over a closed body = -rho*g*V*zhat: the hydrostatic resultant
      // is purely vertical. Applying each patch's horizontal component too
      // leaves a spurious fore/aft force (the discretisation of a bow-down
      // hull does not cancel), so only the vertical part is applied here.
      // The righting / heeling moments fall out of the *lever arm* of those
      // vertical forces, which is exactly how naval architecture does it.
      const pb = RHO * G * depth * area;
      buoySum += pb * (-n.y);
      tmpF.set(0, -pb * n.y, 0);
      this.applyForceAtPoint(tmpF, wp, F, T);

      // ---- hydrodynamic drag (relative to moving water) ----
      // patch velocity = v + omega x r
      const r = this._r.copy(wp).sub(this.position);
      const pv = this._v.crossVectors(this.omega, r).add(this.velocity);
      // relative to the local water velocity
      const rvx = pv.x - sample.vx;
      const rvy = pv.y - sample.vy;
      const rvz = pv.z - sample.vz;
      const vn = rvx * n.x + rvy * n.y + rvz * n.z;
      // Cd is deliberately low: a flat-plate Cd would double-count pressure
      // drag on the forebody without any pressure recovery aft, which made the
      // hull ~4x too "sticky". Surge resistance is handled by the skin-friction
      // term below instead.
      const cd = patch.kind === 'deck' ? 0.65 : 0.38;
      const pd = 0.5 * RHO * cd * area * Math.abs(vn) * vn;
      dragAcc += Math.abs(pd * n.x);
      tmpF.set(n.x * -pd, n.y * -pd, n.z * -pd);
      this.applyForceAtPoint(tmpF, wp, F, T);

      // slamming: fast downward water entry, mostly on the forebody
      if (vn < -5.0 && n.y < -0.35) {
        slamAcc += (Math.abs(vn) - 5.0) * area * 0.00016;
      }
    }

    this.emerged = 1 - submerged / this.patches.length;

    // ---- extra hull damping ---------------------------------------
    // Skin friction + wave-making on the wetted hull. This is what actually
    // sets the top speed.  S ~= L*(2T+B)*0.85 ~= 18 700 m^2, and Cf ~= 0.0053
    // lumps friction and wave-making for a 100 000 t hull:
    //   0.5 * 1025 * 0.0053 * 18700 * 15.4^2 ~= 1.2e7 N  ->  ~30 kn at ~200 MW
    const speed = this.velocity.length();
    const subFrac = submerged / this.patches.length;
    const wetted = 18700 * subFrac;
    const Cf = 0.0053;
    const skinF = 0.5 * RHO * Cf * wetted * speed * speed;
    if (speed > 0.01) {
      tmpF.copy(this.velocity).multiplyScalar(-skinF / speed);
      F.add(tmpF);
    }

    // Lateral (sway) resistance. Applied at the centre of lateral resistance,
    // which sits well aft of the CG — that is what makes a ship lie beam-on
    // and eventually broach when she loses steerage way.
    const stbd = this._stbd.set(0, 0, 1).applyQuaternion(this.quaternion);
    const sway = this.velocity.dot(stbd);
    if (Math.abs(sway) > 0.01) {
      tmpF.copy(stbd).multiplyScalar(-0.5 * RHO * 0.9 * 4111 * sway * Math.abs(sway));
      this.localToWorld(this._clr, this._p);
      this.applyForceAtPoint(tmpF, this._p, F, T);
    }

    // roll damping from bilge keels + hull form.
    //   I_roll = 4.2e10, k = d*g*GM = 8.7e9  ->  zeta ~= 0.035, which is the
    //   right order for a big ship and leaves room for resonant rolling.
    const rollRate = this.omega.x;
    T.x -= 1.35e9 * rollRate + 1.2e9 * rollRate * Math.abs(rollRate);
    // pitch damping -> zeta ~= 0.045
    T.z -= 1.05e11 * this.omega.z;
    // yaw damping (hull + skeg); time constant ~35 s, so she coasts in a turn
    T.y -= 2.5e10 * this.omega.y;

    // ---- propulsion ------------------------------------------------
    const fwd = this._fwd.set(1, 0, 0).applyQuaternion(this.quaternion);
    const vAlong = this.velocity.dot(fwd);
    const T_MAX = 3.2e7;            // N of bollard pull (4 shafts, ~200 MW)
    const V_FREE = 24;              // m/s at which thrust vanishes
    let thrust = 0;
    if (this.throttle > 0.001) {
      const falloff = THREE.MathUtils.clamp(1 - Math.max(vAlong, 0) / V_FREE, 0, 1);
      thrust = this.throttle * T_MAX * falloff;
    } else if (this.throttle < -0.001) {
      thrust = this.throttle * T_MAX * 0.42;
    }
    if (thrust !== 0) {
      tmpF.copy(fwd).multiplyScalar(thrust);
      // applied at the screws, which also makes the bow lift under power
      this.localToWorld(this._screw, this._p);
      this.applyForceAtPoint(tmpF, this._p, F, T);
    }

    // ---- rudder ------------------------------------------------------
    // rate-limited, and only works when water flows past it
    const target = this.rudder * THREE.MathUtils.degToRad(35);
    const rate = THREE.MathUtils.degToRad(3.2) * dt;
    this.rudderAngle += THREE.MathUtils.clamp(target - this.rudderAngle, -rate, rate);

    // rudder submergence (it lifts out when the stern pitches up)
    this.localToWorld(this._rudderPt, this._p);
    field.sampleWorld(this._p.x, this._p.z, sample, 2);
    const rudderDepth = sample.y - this._p.y;
    const rudderSub = THREE.MathUtils.clamp(rudderDepth / 9, 0, 1);
    // flow over the rudder: use the water-relative forward speed
    const flowX = sample.vx, flowZ = sample.vz;
    const vWaterRel = this._vRel.set(
      this.velocity.x - flowX, 0, this.velocity.z - flowZ).dot(fwd);
    const vR = Math.abs(vWaterRel);
    if (vR > 0.15 && rudderSub > 0.05) {
      const A_R = 62;                                    // m^2 both rudders
      const cl = 1.45 * Math.sin(this.rudderAngle) * Math.sign(vWaterRel);
      const side = this._side.set(0, 0, 1).applyQuaternion(this.quaternion);
      const fR = 0.5 * RHO * A_R * cl * vR * vR * rudderSub;
      tmpF.copy(side).multiplyScalar(-fR);
      this.applyForceAtPoint(tmpF, this._p, F, T);
    }

    // ---- anchor chain ------------------------------------------------
    let chainF = 0;
    if (this.anchorDown) {
      this.anchorChain += THREE.MathUtils.clamp(
        this.anchorTarget - this.anchorChain, -0.4 * dt * 60, 0.55 * dt * 60);
      this.localToWorld(this._bow, this._p);
      const dx = this.anchorPos.x - this._p.x;
      const dz = this.anchorPos.z - this._p.z;
      const dh = Math.hypot(dx, dz);
      const reach = Math.sqrt(Math.max(0, this.anchorChain ** 2 - DEPTH ** 2));
      if (dh > reach * 0.995 && this.anchorChain > DEPTH) {
        const stretch = dh - reach;
        const dirX = dx / dh, dirZ = dz / dh;
        // chain pulls the bow down toward the anchor
        const mag = 4.2e6 * stretch + 6.0e5 * this.velocity.dot(
          this._dir.set(dirX, 0, dirZ));
        chainF = Math.max(0, mag);
        tmpF.set(dirX * chainF, -chainF * 0.16, dirZ * chainF);
        this.applyForceAtPoint(tmpF, this._p, F, T);
      }
    }

    // ---- progressive flooding list ------------------------------------
    if (this.flood > 0.001) {
      T.x -= this.mass * G * this.list * 0.9 * this.flood;
    }

    this.lastForces.thrust = thrust;
    this.lastForces.buoy = buoySum;
    this.lastForces.chain = chainF;
    this.lastForces.drag = dragAcc;
    this.lastForces.netX = F.x;
    this.lastForces.netY = F.y;
    this.lastForces.submerged = submerged;
    this.slam = Math.min(1, slamAcc);

    // ---- integrate ----------------------------------------------------
    // linear
    this.velocity.x += (F.x / massEff) * dt;
    this.velocity.y += (F.y / massEff) * dt;
    this.velocity.z += (F.z / massEff) * dt;

    // angular: tau_eff = tau - omega x (I omega)
    const Iw = this.updateWorldInertia();
    const Iworld = this._Iv.set(this.inertia.x, this.inertia.y, this.inertia.z);
    const wLocal = this._wLoc.copy(this.omega).applyQuaternion(
      this._qi.copy(this.quaternion).invert());
    const L = this._L.set(
      wLocal.x * Iworld.x, wLocal.y * Iworld.y, wLocal.z * Iworld.z);
    const Lworld = this._Lw.copy(L).applyQuaternion(this.quaternion);
    const gyro = this._gyro.crossVectors(this.omega, Lworld);
    const tau = this._tau.copy(T).sub(gyro);

    const angAcc = tau.applyMatrix3(Iw);
    const angScale = 1 / (1 + this.addedMassAng);
    this.omega.addScaledVector(angAcc, dt * angScale);

    // quaternion integration
    const half = this._q.set(
      this.omega.x * dt * 0.5,
      this.omega.y * dt * 0.5,
      this.omega.z * dt * 0.5,
      0);
    half.multiply(this.quaternion);
    this.quaternion.x += half.x;
    this.quaternion.y += half.y;
    this.quaternion.z += half.z;
    this.quaternion.w += half.w;
    this.quaternion.normalize();

    this.position.addScaledVector(this.velocity, dt);

    return { buoySum, submerged };
  }

  /* ---------------- state readouts ---------------- */

  /** Heading (yaw) in radians, 0 = +x. */
  get heading() {
    const f = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
    return Math.atan2(f.z, f.x);
  }

  /** Roll and pitch in radians relative to the true horizon. */
  get attitude() {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
    const roll = Math.atan2(up.z, up.y);
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    return { roll, pitch, up, fwd };
  }

  /** Speed over ground in knots. */
  get speedKnots() { return this.velocity.length() * 1.94384; }

  /** Capsize test: is the keel above the water (i.e. upside down)? */
  get capsized() {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
    return up.y < -0.25;
  }
}

const HALF_L_FWD = SHIP.length / 2 - 4;

export { RHO, DEPTH };
