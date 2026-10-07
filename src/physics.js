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
import { SHIP } from './carrier-layout.js';
import { Anchor } from './anchor.js';
import { operatingWaterlineY,pressureIntegral } from './hull-loft.js';
import {propulsionForce,propulsionSpeedLimit} from './propulsion-envelope.js';

const RHO = 1025;          // sea water kg/m^3
const G = 9.81;
const DEPTH = 150;         // sea floor depth (m) — for anchoring
export const FLEET_BUOYANCY=1.5;

export class ShipPhysics {
  constructor(patches, opts = {}) {
    this.vessel = opts.vessel ?? SHIP;
    const spec=this.vessel, dynamics=spec.dynamics;
    this.buoyancyScale=spec.buoyancyScale??1;
    this.patches = patches;
    // A step's surface samples are scratch, shared by pressure and drag.
    // Closed-body pressure needs a common gauge before face integration.
    this._surfaceSamples=new Float64Array(patches.length*10);
    this.calibrate(patches, opts.mass);
    // A real hull is never perfectly symmetric — a small permanent list both
    // looks right and, more importantly, seeds parametric rolling. On a
    // perfectly symmetric hull with a perfectly symmetric wave the roll
    // instability sits at an exact equilibrium and never grows.
    this.cg = new THREE.Vector3(opts.cgX ?? spec.cg[0], opts.cgY ?? spec.cg[1], opts.cgZ ?? spec.cg[2]);

    // inertia about the CG, local frame (x fwd, y up, z stbd)
    const kx = opts.gyradiusRoll ?? spec.gyradiusRoll;
    const ky = opts.gyradiusYaw ?? spec.gyradiusYaw;
    const kz = opts.gyradiusPitch ?? spec.gyradiusPitch;
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
    // Radiation damping of the heave mode, expressed as a fraction of
    // critical damping. This dissipates rebound energy without changing
    // hydrostatic pressure, weight, propulsion or prescribing hull motion.
    this.heaveDampingRatio = opts.heaveDampingRatio ?? dynamics.heaveDampingRatio ?? 1.2;

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.omega = new THREE.Vector3();

    // controls
    this.throttle = 0;          // -0.35 .. 1
    this.rudder = 0;            // -1 .. 1 (command)
    this.rudderAngle = 0;       // actual, rate limited
    this.anchor = new Anchor();

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
    this._dragN = new THREE.Vector3();
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
    this._clr = new THREE.Vector3(...dynamics.clr);
    const centre=items=>items.reduce((v,item)=>v.add(new THREE.Vector3(...item.position)),new THREE.Vector3()).multiplyScalar(1/items.length);
    this._screw = spec.propulsion.thrustPoint?new THREE.Vector3(...spec.propulsion.thrustPoint):centre(spec.propulsion.shafts);
    this._thrustAxes=new THREE.Vector3(...(spec.propulsion.thrustAxes??[1,1,1]));
    this._rudderPt = centre(spec.propulsion.rudders);
    this._bow = new THREE.Vector3(spec.length/2-4, -spec.draft*.5, 0);
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

  }

  /**
   * The full-load displacement calibrates the patch quadrature once. The
   * operating mass is then the same hull's pressure integral at its operating
   * draft, so drawing height, buoyancy and mass cannot diverge.
   */
  calibrate(patches, overrideMass) {
    const reference = pressureIntegral(patches,0);
    const operating = pressureIntegral(patches,operatingWaterlineY(this.vessel));
    if (reference <= 0 || operating <= 0) throw new RangeError('A wet watertight hull is required for displacement calibration');
    this.areaScale = this.vessel.designMass / (RHO * reference);
    this.mass = overrideMass ?? this.vessel.designMass * operating / reference * this.buoyancyScale;
    for (const p of patches) p.area *= this.areaScale;
  }

  reset(x, z, heading) {
    this.position.set(x, -operatingWaterlineY(this.vessel), z);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -heading);
    this.position.add(this._v.copy(this.cg).applyQuaternion(this.quaternion));
    this.velocity.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.throttle = 0;
    this.rudder = 0;
    this.rudderAngle = 0;
    this.flood = 0;
    this.list = 0;
    this.slam = 0;
    this.anchor.reset();
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
  applyImpulseAtPoint(impulse,worldPoint){
    this.velocity.addScaledVector(impulse,1/(this.mass*(1+this.addedMassLin)));
    this._r.copy(worldPoint).sub(this.position);this._cross.crossVectors(this._r,impulse).applyMatrix3(this.updateWorldInertia());
    this.omega.addScaledVector(this._cross,1/(1+this.addedMassAng));
  }

  /* ---------------- main step ---------------- */

  /**
   * @param {number} dt      seconds (already sub-stepped by caller)
   * @param {WaveField} field
   */
  step(dt, field) {
    const dynamics=this.vessel.dynamics;
    const F = this._f.set(0, 0, 0);
    const T = this._t.set(0, 0, 0);
    const tmpF = this._tmpF;

    const boost=this.vessel.waveBuoyancy;
    const encounter=boost?field.encounterAt(this.position.x,this.position.z,boost.height):0;
    const buoyancyScale=FLEET_BUOYANCY*(this.buoyancyScale+(boost?boost.scale-this.buoyancyScale:0)*encounter);

    // Uniform pressure on a closed surface has zero resultant and moment.
    // Subtract its common pressure gauge before the existing 38 m cap: a
    // deeply immersed sealed body still displaces its fixed volume instead
    // of losing all buoyancy when every face saturates to equal pressure.
    // Open hull/deck quadratures retain their original pressure reference.
    const samples=this._surfaceSamples,surface=this._sample;
    let minSealedDepth=Infinity;
    for(let i=0;i<this.patches.length;i++){
      const patch=this.patches[i],wp=this.localToWorld(patch.pos,this._wp),k=i*10;
      field.sampleWorld(wp.x,wp.z,surface);
      const depth=surface.y-wp.y;
      samples[k]=wp.x;samples[k+1]=wp.y;samples[k+2]=wp.z;samples[k+3]=depth;
      samples[k+4]=surface.vx;samples[k+5]=surface.vy;samples[k+6]=surface.vz;
      samples[k+7]=surface.nx;samples[k+8]=surface.ny;samples[k+9]=surface.nz;
      if(patch.kind==='sealed')minSealedDepth=Math.min(minSealedDepth,depth);
    }
    const sealedGauge=Math.max(0,minSealedDepth);

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
    let pressureDragPower = 0;
    let heaveArea = 0;
    const sample = this._sample;

    for (let i = 0; i < this.patches.length; i++) {
      const patch = this.patches[i];
      // world position of the patch
      const k=i*10,wp=this._wp.set(samples[k],samples[k+1],samples[k+2]);
      const depth=samples[k+3];
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
      //
      // 'deck' patches (flight deck + superstructure, WIDER than the
      // watertight hull) carry NO hydrostatic pressure: a real flight deck
      // is not watertight, and counting downward pressure on it while the
      // narrower hull pushes up is a net-DOWN force that grows with depth —
      // a buried ship used to accelerate to the seabed instead of fighting
      // back to the surface. The depth term also saturates: a fully
      // submerged hull displaces a FIXED volume, while linear-in-depth
      // would grow forever.
      if (patch.kind !== 'deck') {
        const head=depth-(patch.kind==='sealed'?sealedGauge:0);
        const pb = RHO * G * Math.min(head, 38) * area * buoyancyScale;
        buoySum += pb * (-n.y);
        tmpF.set(0, -pb * n.y, 0);
        this.applyForceAtPoint(tmpF, wp, F, T);
      }

      // ---- hydrodynamic drag (relative to moving water) ----
      // patch velocity = v + omega x r
      const r = this._r.copy(wp).sub(this.position);
      const pv = this._v.crossVectors(this.omega, r).add(this.velocity);
      // relative to the local water velocity. The water's own velocity is
      // SATURATED at ±12 m/s: a 100 m wall carries orbital velocities of
      // ~30 m/s, and quadratic drag against that simply sucks a hull to the
      // seabed — burying her, flinging her up and dropping her back is what
      // a real wall does. Buoyancy (position-based) is untouched, so she
      // still rides the crest face up. Cap removal condition: a proper
      // breaking-wave/body interaction model.
      const rvx = pv.x - THREE.MathUtils.clamp(samples[k+4], -12, 12);
      const rvy = pv.y - THREE.MathUtils.clamp(samples[k+5], -12, 12);
      const rvz = pv.z - THREE.MathUtils.clamp(samples[k+6], -12, 12);
      if (patch.kind !== 'deck') {
        // Project the wetted hull onto the vertical response mode. The
        // squared normal is a positive area measure at any hull attitude.
        const weight = area * n.y * n.y;
        heaveArea += weight;
      }
      // Cd is deliberately low: a flat-plate Cd would double-count pressure
      // drag on the forebody without any pressure recovery aft, which made the
      // hull ~4x too "sticky". Surge resistance is handled by the skin-friction
      // term below instead.
      const cd = patch.kind === 'deck' ? 0.65 : 0.38;
      // Empirical fore/aft pressure recovery in the hull frame. With
      // b = R diag(recovery,1,1) n, F=-C|v·b|(v·b)b and F·v=-C|v·b|³.
      // The tensor therefore remains dissipative at every heading and sea
      // incidence, while transverse/vertical pressure drag is unchanged.
      const b = this._dragN.copy(patch.nrm);
      b.x *= dynamics.surgeRecovery;
      b.applyQuaternion(this.quaternion);
      const dragVn = rvx*b.x + rvy*b.y + rvz*b.z;
      const pd = 0.5 * RHO * cd * area * Math.abs(dragVn) * dragVn;
      dragAcc += Math.abs(pd * b.x);
      tmpF.copy(b).multiplyScalar(-pd);
      pressureDragPower += tmpF.x*rvx + tmpF.y*rvy + tmpF.z*rvz;
      this.applyForceAtPoint(tmpF, wp, F, T);

      // Entry flux through the free surface over this integration step.
      // A submerged or emerging face is not a new impact. Positive entry
      // speed points into water; n is the outward hull normal.
      const entrySpeed = -(rvx*samples[k+7] + rvy*samples[k+8] + rvz*samples[k+9]);
      const facing = -(n.x*samples[k+7] + n.y*samples[k+8] + n.z*samples[k+9]);
      if (entrySpeed > 5 && facing > .35 && depth*samples[k+8] <= entrySpeed*dt) {
        slamAcc += (entrySpeed - 5) * area * facing * 0.00016;
      }
    }

    this.emerged = 1 - submerged / this.patches.length;

    // Reduced heave radiation model: K = rho*g*A, C = 2*zeta*sqrt(M*K).
    // Radiation is generated by body motion in the mean-sea frame; incident
    // wave velocity already drives the relative-water patch drag above.
    // Its power is -C*vY^2, so it only removes heave energy.
    // With no wetted hull there is no fluid radiation force.
    const heaveForce = heaveArea > 0
      ? -2 * this.heaveDampingRatio * Math.sqrt(massEff * RHO * G * heaveArea * buoyancyScale)
        * this.velocity.y
      : 0;
    F.y += heaveForce;

    // ---- extra hull damping ---------------------------------------
    // Skin friction + wave-making on the wetted hull. This is what actually
    // sets the top speed.  S ~= L*(2T+B)*0.85 ~= 18 700 m^2, and Cf ~= 0.0053
    // lumps friction and wave-making for a 100 000 t hull:
    //   0.5 * 1025 * 0.0053 * 18700 * 15.4^2 ~= 1.2e7 N  ->  ~30 kn at ~200 MW
    const speed = this.velocity.length();
    const subFrac = submerged / this.patches.length;
    const wetted = dynamics.wettedArea * subFrac;
    const Cf = dynamics.friction;
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
      tmpF.copy(stbd).multiplyScalar(-0.5 * RHO * 0.9 * dynamics.swayArea * sway * Math.abs(sway));
      this.localToWorld(this._clr, this._p);
      this.applyForceAtPoint(tmpF, this._p, F, T);
    }

    // roll damping from bilge keels + hull form.
    //   I_roll = 4.2e10, k = d*g*GM = 8.7e9  ->  zeta ~= 0.035, which is the
    //   right order for a big ship and leaves room for resonant rolling.
    // Hull damping is diagonal in the body frame. Transform the complete
    // torque back to world space so turning does not swap roll and pitch.
    const bodyOmega = this._wLoc.copy(this.omega).applyQuaternion(
      this._qi.copy(this.quaternion).invert());
    this._tau.set(
      -dynamics.rollLinear * bodyOmega.x - dynamics.rollQuadratic * bodyOmega.x * Math.abs(bodyOmega.x),
      -dynamics.yawDamping * bodyOmega.y,
      -dynamics.pitchDamping * bodyOmega.z,
    ).applyQuaternion(this.quaternion);
    T.add(this._tau);

    // ---- propulsion ------------------------------------------------
    const fwd = this._fwd.set(1, 0, 0).applyQuaternion(this.quaternion);
    // A vectoring jet has a gravity-referenced thrust plane and a balanced
    // thrust line. Propeller shafts retain their body-fixed force direction.
    const propulsionDirection=this._dir.copy(fwd).multiply(this._thrustAxes).normalize();
    const vAlong = this.velocity.dot(fwd);
    const thrust=propulsionForce(dynamics,this.throttle,vAlong,field.significantSeaHeight);
    if (thrust !== 0) {
      tmpF.copy(propulsionDirection).multiplyScalar(thrust);
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
    field.sampleWorld(this._p.x, this._p.z, sample);
    const rudderDepth = sample.y - this._p.y;
    const rudderSub = THREE.MathUtils.clamp(rudderDepth / dynamics.rudderDepth, 0, 1);
    // flow over the rudder: use the water-relative forward speed
    const flowX = sample.vx, flowZ = sample.vz;
    const vWaterRel = this._vRel.set(
      this.velocity.x - flowX, 0, this.velocity.z - flowZ).dot(fwd);
    const vR = Math.abs(vWaterRel);
    if (vR > 0.15 && rudderSub > 0.05) {
      const A_R = dynamics.rudderArea;                                    // m^2 both rudders
      const cl = 1.45 * Math.sin(this.rudderAngle) * Math.sign(vWaterRel);
      const side = this._side.set(0, 0, 1).applyQuaternion(this.quaternion);
      const fR = 0.5 * RHO * A_R * cl * vR * vR * rudderSub;
      tmpF.copy(side).multiplyScalar(-fR);
      this.applyForceAtPoint(tmpF, this._p, F, T);
    }

    // ---- anchor chain ------------------------------------------------
    let chainF = 0;
    this.anchor.step(dt);
    if (this.anchor.phase === 'set') {
      this.localToWorld(this._bow, this._p);
      const dx = this.anchor.position.x - this._p.x;
      const dz = this.anchor.position.z - this._p.z;
      const dh = Math.hypot(dx, dz);
      const reach = Math.sqrt(Math.max(0, this.anchor.chainLength ** 2 - DEPTH ** 2));
      if (dh > reach * 0.995 && this.anchor.chainLength > DEPTH) {
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
      T.addScaledVector(fwd, -this.mass * G * this.list * 0.9 * this.flood);
    }

    this.lastForces.thrust = thrust;
    this.lastForces.propulsionLimit=propulsionSpeedLimit(dynamics,field.significantSeaHeight);
    this.lastForces.buoy = buoySum;
    this.lastForces.buoyancyScale=buoyancyScale;
    this.lastForces.chain = chainF;
    this.lastForces.drag = dragAcc;
    this.lastForces.skinDrag = skinF;
    this.lastForces.pressureDragPower = pressureDragPower;
    this.lastForces.entryImpulse = slamAcc;
    this.lastForces.netX = F.x;
    this.lastForces.netY = F.y;
    this.lastForces.heaveDamping = heaveForce;
    this.lastForces.submerged = submerged;
    // Resolve point-quadrature entry impulses into a short impact response;
    // render/damage updates can then sample it without missing a substep.
    this.slam = Math.min(1, this.slam*Math.exp(-dt/.18) + slamAcc);

    // ---- integrate ----------------------------------------------------
    // linear
    this.velocity.x += (F.x / massEff) * dt;
    this.velocity.y += (F.y / massEff) * dt;
    this.velocity.z += (F.z / massEff) * dt;

    // Numerical guard for the mega-wall: buoyancy there runs ~5-8x weight,
    // and an unbounded integrator turns that into a projectile. The caps
    // sit far above anything real seas produce (30 kn = 15 m/s; the wall
    // itself throws her ~30-40 m/s) so ordinary physics never touches them.
    {
      const vMax = dynamics.speedLimit??60;
      const v2 = this.velocity.lengthSq();
      if (v2 > vMax * vMax) this.velocity.multiplyScalar(vMax / Math.sqrt(v2));
      const wMax = 1.1;
      const w2 = this.omega.lengthSq();
      if (w2 > wMax * wMax) this.omega.multiplyScalar(wMax / Math.sqrt(w2));
    }

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
    const side = new THREE.Vector3(0, 0, 1).applyQuaternion(this.quaternion);
    const roll = Math.atan2(-side.y, up.y);
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
    return { roll, pitch, up, fwd };
  }

  /** Speed over ground in knots. */
  get speedKnots() { return Math.hypot(this.velocity.x,this.velocity.z) * 1.94384; }

  /** Capsize test: is the keel above the water (i.e. upside down)? */
  get capsized() {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
    return up.y < -0.25;
  }
}


export { RHO, DEPTH };
