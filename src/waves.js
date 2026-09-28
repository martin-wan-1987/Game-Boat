/**
 * waves.js — Gerstner wave field, shared by CPU physics and GPU rendering.
 *
 * Both the buoyancy solver (CPU, JS) and the ocean surface shader (GPU, GLSL)
 * evaluate the *same* wave parameters with the *same* math. That is the whole
 * reason the hull never visibly sinks through / floats above the water:
 * physics and visuals are one and the same function.
 *
 * Conventions
 *   +x = east-ish world axis, +y = up, +z = north-ish world axis
 *   "2D position" p = (x, z)
 *   1 unit = 1 metre, g = 9.81
 */

export const G = 9.81;

export const MAX_SEA = 8;   // ambient sea components
export const MAX_TSU = 8;   // tsunami wave-train components (a packet = a wave group)

/* ------------------------------------------------------------------ *
 * small helpers
 * ------------------------------------------------------------------ */
const TAU = Math.PI * 2;

function rand(min, max) { return min + Math.random() * (max - min); }

/** Deep-water dispersion: omega from k. */
export function omegaOfK(k) { return Math.sqrt(G * k); }

/** Phase speed of a deep-water wave of wavelength L. */
export function phaseSpeed(L) { return Math.sqrt(G * L / TAU); }

/* ------------------------------------------------------------------ *
 * A single wave component
 * ------------------------------------------------------------------ */
class Wave {
  constructor(dirX, dirZ, amp, len, steep, phase, kind) {
    const n = Math.hypot(dirX, dirZ) || 1;
    this.dx = dirX / n;
    this.dz = dirZ / n;
    this.amp = amp;
    this.len = len;
    this.steep = steep;            // Gerstner Q, 0..1 (1 = sharpest, folding)
    this.k = TAU / len;
    this.omega = omegaOfK(this.k);
    this.speed = this.omega / this.k;   // phase speed
    this.phase = phase;
    this.kind = kind;              // 'sea' | 'tsu'
    this.lodDist = 0;              // metres at which short waves start fading
  }
}

/* ------------------------------------------------------------------ *
 * The wave field
 * ------------------------------------------------------------------ */
export class WaveField {
  constructor() {
    this.sea = [];
    this.tsunami = [];
    this.time = 0;

    // tsunami packet envelope (super-Gaussian travelling along tsuDir)
    this.tsuActive = false;
    this.tsuDirX = 1;
    this.tsuDirZ = 0;
    this.tsuCenter = 0;      // s-coordinate of packet centre at t=0
    this.tsuSpeed = 0;       // packet travel speed (= component phase speed)
    this.tsuWidth = 1;       // half width of packet
    this.tsuHeight = 0;      // design crest-to-trough height
    this.tsuOriginX = 0;
    this.tsuOriginZ = 0;
    this.tsuSpawnT = 0;
    this.tsuLife = 0;        // seconds the packet stays "alive"
  }

  /* ---------------- ambient sea ---------------- */

  /**
   * Build a small, strongly directional sea from a Pierson–Moskowitz spectrum.
   *
   * Using a real spectrum (rather than "N equal waves") is what makes the
   * surface read as water: a dominant swell plus the right amount of short
   * chop, so there is visible texture at every camera distance instead of one
   * glassy swell.
   *
   * @param {number} hs      significant wave height (m)
   * @param {number} dirX    dominant travel direction (normalised later)
   * @param {number} dirZ
   * @param {number} spread  half-angle of directional spread, radians
   * @param {number} peakLen peak wavelength (m)
   */
  buildSea(hs, dirX, dirZ, spread = 0.5, peakLen = 90) {
    this.sea.length = 0;
    const n = MAX_SEA;
    const wp = Math.sqrt((2 * Math.PI * G) / peakLen);   // peak angular freq
    const wMin = wp * 0.34, wMax = wp * 3.4;
    const ALPHA = 0.0081;                                // PM constant
    const ratio = Math.pow(wMax / wMin, 1 / (n - 1));

    const ang0 = Math.atan2(dirZ, dirX);
    for (let i = 0; i < n; i++) {
      const w = wMin * Math.pow(ratio, i);
      const dw = w * (ratio - 1) * 0.9;
      // Pierson–Moskowitz
      const S = (ALPHA * G * G / Math.pow(w, 5)) *
                Math.exp(-1.25 * Math.pow(wp / w, 4));
      const amp = Math.sqrt(2 * S * dw);
      const k = w * w / G;                               // deep water
      const len = TAU / k;
      const ang = ang0 + rand(-spread, spread);
      // longer swell runs straighter, chop is more scattered
      const steep = Math.min(0.92, 0.42 + 0.40 * (w / wp) * 0.5 + 0.25 * Math.random());
      const wv = new Wave(Math.cos(ang), Math.sin(ang), amp, len, steep,
                          rand(0, TAU), 'sea');
      wv.lodDist = Math.max(220, len * 22);
      this.sea.push(wv);
    }
    this.calibrateSea(hs);
    return this;
  }

  /** Scale amplitudes so the resulting significant wave height matches `hs`. */
  calibrateSea(hs) {
    // Hs = 4*sqrt(m0),  m0 = sum(a_i^2 / 2)
    let m0 = 0;
    for (const w of this.sea) m0 += w.amp * w.amp * 0.5;
    if (m0 <= 0) return;
    const target = (hs * hs) / 16;
    const s = Math.sqrt(target / m0);
    for (const w of this.sea) w.amp *= s;
  }

  /* ---------------- tsunami ---------------- */

  /**
   * Spawn a tsunami wave train ahead of `origin` travelling along (dirX,dirZ)
   * *towards* the ship.
   *
   * Modelled the physically honest way for deep water: a long, non-dispersive
   * wave train (every crest shares one phase speed, like a real tsunami) with a
   * steep leading front and a decaying tail. Height is crest-to-trough.
   *
   * Geometry is expressed in a packet frame:
   *     sRel = s + speed * (t - t0)
   * so the leading crest sits at sRel = 0 and rides along at `speed` toward
   * decreasing s — i.e. straight at the ship.
   *
   * @param {object} o {x, z, dirX, dirZ, height, distance, speed, period, crests}
   */
  spawnTsunami(o) {
    this.tsunami.length = 0;
    const n = Math.hypot(o.dirX, o.dirZ) || 1;
    const dx = o.dirX / n, dz = o.dirZ / n;
    this.tsuDirX = dx; this.tsuDirZ = dz;

    // Phase speed. A deep-ocean tsunami runs at ~200 m/s and would be gone
    // before you could react, so this models a tsunami that has shoaled onto
    // the continental shelf (c = sqrt(g*h), h ~ 40-60 m). Slower, much steeper,
    // and it puts the encounter period in the same neighbourhood as the ship's
    // own natural periods — which is where the danger actually lives.
    //
    // It is also deliberately brisk: the player asked for the wave to close
    // fast enough to read as a landmark event, not a slow swell. At ~30 m/s
    // the leading crest covers the 850 m approach in about half a minute.
    const speed = o.speed ?? (21 + o.height * 1.15);     // m/s
    const crests = Math.min(o.crests ?? 7, MAX_TSU);
    // A real tsunami front is not a plane wave: refraction and the source
    // geometry mean successive crests arrive a few degrees apart. This is what
    // makes an otherwise head-on encounter develop roll (and, if she loses way,
    // broach) instead of pure pitching.
    const spread = o.spread ?? 0.20;                     // radians, per crest
    const T0 = o.period ?? (8.0 + o.height * 0.34);      // seconds
    const L0 = speed * T0;                               // non-dispersive

    // ---- wave-group height profile -------------------------------------
    // A tsunami is not one wave: it is a *group*. The leading crest is the
    // wall the player sees coming; behind it follow a secondary crest, then a
    // scatter of medium and small waves. `profile` shapes that group so the
    // encounter reads as "several waves hitting together" rather than a single
    // swell. Entries after the first are jittered so no two events match.
    const profile = [1.00, 0.88, 0.54, 0.74, 0.42, 0.52, 0.30, 0.22];
    const a0 = 0.45 * o.height;
    let sOff = 0;
    for (let i = 0; i < crests; i++) {
      const rel = profile[i % profile.length] * Math.pow(0.93, i);
      const jitter = rand(0.86, 1.14);                   // <- the randomness
      const Li = L0 * rand(0.88, 1.14);
      const ang = Math.atan2(dz, dx) + rand(-spread, spread);
      const w = new Wave(Math.cos(ang), Math.sin(ang), a0 * rel * jitter,
                         Li, 0, 0, 'tsu');
      // non-dispersive: every crest rides at the packet speed
      w.omega = w.k * speed;
      w.speed = speed;
      // The leading crest is near-breaking (Q -> 1 gives it a sharp, almost
      // curling face); the rest of the group is progressively softer.
      w.steep = i === 0 ? 1.02 : rand(0.62, 0.86);
      w.sOff = sOff;
      w.phase = -w.k * sOff;     // crest i sits at sRel = sOff
      w.lodDist = 1e9;           // the tsunami never fades with distance
      this.tsunami.push(w);
      sOff += L0 * rand(0.82, 1.12);
    }

    this.tsuSpeed = speed;
    // wide enough that the whole train lives inside the envelope
    this.tsuWidth = Math.max(L0 * 1.5, sOff * 0.98);
    this.tsuHeight = o.height;
    this.tsuOriginX = o.x + dx * o.distance;
    this.tsuOriginZ = o.z + dz * o.distance;
    this.tsuDistance0 = o.distance;
    this.tsuSpawnT = this.time;
    this.tsuActive = true;

    this.calibrateTsunami(o.height);
    return this;
  }

  /** Envelope shape: hard leading edge, long trailing tail. */
  envelope(sRel) {
    const x = sRel / this.tsuWidth;
    if (x < 0) {
      const a = -x * 3.2;
      if (a > 2.2) return 0;
      return Math.exp(-Math.pow(a, 6));
    }
    const a = x * 0.85;
    if (a > 3.0) return 0;
    return Math.exp(-Math.pow(a, 2.2));
  }

  /** Elevation of the tsunami alone at a world XZ point (calibration helper). */
  _tsuEta(bx, bz, t) {
    if (!this.tsuActive) return 0;
    const sMain = (bx - this.tsuOriginX) * this.tsuDirX +
                  (bz - this.tsuOriginZ) * this.tsuDirZ;
    const env = this.envelope(sMain + this.tsuSpeed * (t - this.tsuSpawnT));
    if (env <= 1e-4) return 0;
    let y = 0;
    for (const w of this.tsunami) {
      const si = (bx - this.tsuOriginX) * w.dx + (bz - this.tsuOriginZ) * w.dz;
      const sRel = si + this.tsuSpeed * (t - this.tsuSpawnT);
      y += w.amp * env * Math.sin(w.k * sRel + w.phase);
    }
    return y;
  }

  /** Numerically scale the train so max(eta)-min(eta) === target. */
  calibrateTsunami(target) {
    let lo = Infinity, hi = -Infinity;
    const span = this.tsuWidth * 5.0;
    for (let i = 0; i <= 700; i++) {
      const s = -this.tsuWidth * 0.6 + (span * i) / 700;
      const y = this._tsuEta(
        this.tsuOriginX + this.tsuDirX * s,
        this.tsuOriginZ + this.tsuDirZ * s,
        this.tsuSpawnT);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    const measured = hi - lo;
    if (measured > 1e-6) {
      const sc = target / measured;
      for (const w of this.tsunami) w.amp *= sc;
    }
  }

  /** Peak elevation of the train along the main axis (for the HUD readout). */
  etaAlong(s) {
    return this._tsuEta(
      this.tsuOriginX + this.tsuDirX * s,
      this.tsuOriginZ + this.tsuDirZ * s,
      this.time);
  }

  /**
   * Distance (m) from a world point to the leading crest of the tsunami.
   * Positive while the front is still approaching, negative once past.
   */
  distanceToCrest(x, z) {
    if (!this.tsuActive) return Infinity;
    const sx = (x - this.tsuOriginX) * this.tsuDirX +
               (z - this.tsuOriginZ) * this.tsuDirZ;
    const travelled = (this.time - this.tsuSpawnT) * this.tsuSpeed;
    return -sx - travelled;
  }

  update(dt) {
    this.time += dt;
    if (this.tsuActive) {
      if (this.time - this.tsuSpawnT > this.tsuLife + 60) this.tsuActive = false;
    }
  }

  /* ================================================================ *
   * CPU sampling
   * ================================================================ */

  /**
   * Full sample at a *base* (undisplaced) 2D position.
   * Fills `out` with the displaced position, normal and water velocity.
   */
  sampleBase(bx, bz, out) {
    const t = this.time;
    let px = bx, pz = bz, py = 0;
    let vx = 0, vy = 0, vz = 0;
    // tangent derivatives (dP/dx and dP/dz) start as identity
    let txx = 1, txy = 0, txz = 0;
    let tzx = 0, tzy = 0, tzz = 1;

    for (let i = 0; i < this.sea.length; i++) {
      const w = this.sea[i];
      const f = w.k * (w.dx * bx + w.dz * bz) - w.omega * t + w.phase;
      const S = Math.sin(f), C = Math.cos(f);
      const QA = w.steep * w.amp;
      px += QA * w.dx * C;
      pz += QA * w.dz * C;
      py += w.amp * S;
      const k = w.k;
      txx += -QA * k * w.dx * w.dx * S;
      txz += -QA * k * w.dx * w.dz * S;
      txy += w.amp * k * w.dx * C;
      tzx += -QA * k * w.dx * w.dz * S;
      tzz += -QA * k * w.dz * w.dz * S;
      tzy += w.amp * k * w.dz * C;
      vx += QA * w.dx * w.omega * S;
      vz += QA * w.dz * w.omega * S;
      vy += -w.amp * w.omega * C;
    }

    if (this.tsuActive) {
      const sMain = (bx - this.tsuOriginX) * this.tsuDirX +
                    (bz - this.tsuOriginZ) * this.tsuDirZ;
      const env = this.envelope(sMain + this.tsuSpeed * (t - this.tsuSpawnT));
      if (env > 1e-4) {
        const travel = this.tsuSpeed * (t - this.tsuSpawnT);
        for (let i = 0; i < this.tsunami.length; i++) {
          const w = this.tsunami[i];
          // each crest is a plane perpendicular to *its own* axis, so the
          // crest lines are oblique to each other -> real roll excitation
          const si = (bx - this.tsuOriginX) * w.dx +
                     (bz - this.tsuOriginZ) * w.dz;
          const f = w.k * (si + travel) + w.phase;
          const S = Math.sin(f), C = Math.cos(f);
          const A = w.amp * env;
          const QA = w.steep * env * A;
          px += QA * w.dx * C;
          pz += QA * w.dz * C;
          py += A * S;
          const k = w.k;
          txx += -QA * k * w.dx * w.dx * S;
          txz += -QA * k * w.dx * w.dz * S;
          txy += A * k * w.dx * C;
          tzx += -QA * k * w.dx * w.dz * S;
          tzz += -QA * k * w.dz * w.dz * S;
          tzy += A * k * w.dz * C;
          vx += QA * w.dx * w.omega * S;
          vz += QA * w.dz * w.omega * S;
          vy += -A * w.omega * C;
        }
      }
    }

    // normal = normalize(cross(Tz, Tx))
    let nx = tzy * txz - tzz * txy;
    let ny = tzz * txx - tzx * txz;
    let nz = tzx * txy - tzy * txx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    out.x = px; out.y = py; out.z = pz;
    out.nx = nx; out.ny = ny; out.nz = nz;
    out.vx = vx; out.vy = vy; out.vz = vz;
    // Jacobian: < 1 means the surface is compressed -> whitecap
    out.jac = txx * tzz - txz * tzx;
    return out;
  }

  /**
   * Water surface at a *world* horizontal position (x, z).
   * Solves the inverse Gerstner mapping with a few fixed-point iterations so
   * physics queries land on exactly the same surface the GPU draws.
   */
  sampleWorld(x, z, out, iterations = 3) {
    let bx = x, bz = z;
    const tmp = this._tmp || (this._tmp = {});
    for (let i = 0; i < iterations; i++) {
      this.sampleBase(bx, bz, tmp);
      const ex = tmp.x - x, ez = tmp.z - z;
      bx -= ex; bz -= ez;
      if (Math.abs(ex) + Math.abs(ez) < 0.02) break;
    }
    return this.sampleBase(bx, bz, out);
  }

  /** Cheap: just the surface height at (x,z). */
  heightAt(x, z) {
    const o = this._h || (this._h = {});
    this.sampleWorld(x, z, o, 2);
    return o.y;
  }
}

/* ------------------------------------------------------------------ *
 * GLSL — the same maths, mirrored exactly.
 * ------------------------------------------------------------------ */
export function glslWaves() {
  return /* glsl */`
#define MAX_SEA ${MAX_SEA}
#define MAX_TSU ${MAX_TSU}

uniform int   uSeaCount;
uniform vec4  uSeaA[MAX_SEA];   // dirX, dirZ, amp, steep
uniform vec4  uSeaB[MAX_SEA];   // k, omega, phase, lodDist

uniform int   uTsuCount;
uniform int   uTsuActive;
uniform vec2  uTsuDir;
uniform vec4  uTsuA[MAX_TSU];   // dirX, dirZ, amp, steep
uniform vec4  uTsuB[MAX_TSU];   // k, omega, phase, (unused)
uniform vec4  uTsuEnv;          // originX, originZ, speed, width
uniform float uTsuT0;           // time at which the packet was spawned

uniform float uTime;
uniform float uCamDist;         // distance from camera, for LOD fade

struct WaveSample {
  vec3  pos;
  vec3  nrm;
  vec3  vel;
  float jac;
};

WaveSample sampleWaves(vec2 p) {
  vec3 pos = vec3(p.x, 0.0, p.y);
  vec3 vel = vec3(0.0);
  float txx = 1.0, txz = 0.0, txy = 0.0;
  float tzx = 0.0, tzz = 1.0, tzy = 0.0;

  for (int i = 0; i < MAX_SEA; i++) {
    if (i >= uSeaCount) break;
    vec4 A = uSeaA[i];
    vec4 B = uSeaB[i];
    // amplitude LOD: short waves vanish with distance to avoid aliasing
    float fade = 1.0 - smoothstep(B.w * 0.45, B.w, uCamDist);
    float amp = A.z * fade;
    if (amp < 0.0005) continue;
    float f = B.x * dot(A.xy, p) - B.y * uTime + B.z;
    float S = sin(f), C = cos(f);
    float QA = A.w * amp;
    pos.x += QA * A.x * C;
    pos.z += QA * A.y * C;
    pos.y += amp * S;
    float k = B.x;
    txx += -QA * k * A.x * A.x * S;
    txz += -QA * k * A.x * A.y * S;
    txy +=  amp * k * A.x * C;
    tzx += -QA * k * A.x * A.y * S;
    tzz += -QA * k * A.y * A.y * S;
    tzy +=  amp * k * A.y * C;
    vel.x += QA * A.x * B.y * S;
    vel.z += QA * A.y * B.y * S;
    vel.y += -amp * B.y * C;
  }

  if (uTsuActive == 1) {
    float sMain = dot(p - uTsuEnv.xy, uTsuDir);
    float sRelMain = sMain + uTsuEnv.z * (uTime - uTsuT0);
    float x = sRelMain / uTsuEnv.w;
    float env = 0.0;
    if (x < 0.0) {
      float a = -x * 3.2;
      if (a < 2.2) env = exp(-pow(a, 6.0));
    } else {
      float a = x * 0.85;
      if (a < 3.0) env = exp(-pow(a, 2.2));
    }
    if (env > 1e-4) {
      float travel = uTsuEnv.z * (uTime - uTsuT0);
      for (int i = 0; i < MAX_TSU; i++) {
        if (i >= uTsuCount) break;
        vec4 A = uTsuA[i];
        vec4 B = uTsuB[i];
        float amp = A.z * env;
        // each crest propagates along its own axis -> oblique crest lines
        float si = dot(p - uTsuEnv.xy, A.xy);
        float f = B.x * (si + travel) + B.z;
        float S = sin(f), C = cos(f);
        float QA = A.w * env * amp;
        pos.x += QA * A.x * C;
        pos.z += QA * A.y * C;
        pos.y += amp * S;
        float k = B.x;
        txx += -QA * k * A.x * A.x * S;
        txz += -QA * k * A.x * A.y * S;
        txy +=  amp * k * A.x * C;
        tzx += -QA * k * A.x * A.y * S;
        tzz += -QA * k * A.y * A.y * S;
        tzy +=  amp * k * A.y * C;
        vel.x += QA * A.x * B.y * S;
        vel.z += QA * A.y * B.y * S;
        vel.y += -amp * B.y * C;
      }
    }
  }

  WaveSample o;
  o.pos = pos;
  o.nrm = normalize(cross(vec3(tzx, tzy, tzz), vec3(txx, txy, txz)));
  o.vel = vel;
  o.jac = txx * tzz - txz * tzx;
  return o;
}
`;
}

/** Fill the uniform objects from the JS wave field. */
export function applyWaveUniforms(uniforms, field) {
  const A = uniforms.uSeaA.value;
  const B = uniforms.uSeaB.value;
  const n = Math.min(field.sea.length, MAX_SEA);
  for (let i = 0; i < n; i++) {
    const w = field.sea[i];
    A[i].set(w.dx, w.dz, w.amp, w.steep);
    B[i].set(w.k, w.omega, w.phase, w.lodDist);
  }
  uniforms.uSeaCount.value = n;

  const TA = uniforms.uTsuA.value;
  const TB = uniforms.uTsuB.value;
  const m = Math.min(field.tsunami.length, MAX_TSU);
  for (let i = 0; i < m; i++) {
    const w = field.tsunami[i];
    TA[i].set(w.dx, w.dz, w.amp, w.steep);
    TB[i].set(w.k, w.omega, w.phase, 0);
  }
  uniforms.uTsuCount.value = m;
  uniforms.uTsuActive.value = field.tsuActive ? 1 : 0;
  uniforms.uTsuDir.value.set(field.tsuDirX, field.tsuDirZ);
  uniforms.uTsuEnv.value.set(field.tsuOriginX, field.tsuOriginZ,
                             field.tsuSpeed, field.tsuWidth);
  uniforms.uTsuT0.value = field.tsuSpawnT;
}

/** Allocate the uniform block shared by every shader that samples waves. */
export function makeWaveUniforms(THREE) {
  const arr = (n) => Array.from({ length: n }, () => new THREE.Vector4());
  return {
    uSeaCount:  { value: 0 },
    uSeaA:      { value: arr(MAX_SEA) },
    uSeaB:      { value: arr(MAX_SEA) },
    uTsuCount:  { value: 0 },
    uTsuActive: { value: 0 },
    uTsuDir:    { value: new THREE.Vector2(1, 0) },
    uTsuA:      { value: arr(MAX_TSU) },
    uTsuB:      { value: arr(MAX_TSU) },
    uTsuEnv:    { value: new THREE.Vector4(0, 0, 0, 1) },
    uTsuT0:     { value: 0 },
    uTime:      { value: 0 },
    uCamDist:   { value: 0 },
  };
}

export { rand };
