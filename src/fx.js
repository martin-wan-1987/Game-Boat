/**
 * fx.js — everything the hull does to the water, plus spray and smoke.
 *
 *  • HullFoam   — white water torn up along the waterline, widens with speed
 *  • WakeRibbon — the trail astern, follows the waves and fades with age
 *  • Particles  — bow spray, funnel/wreck smoke, embers
 *
 * Every mesh that sits on the sea samples the *same* wave field in its own
 * vertex shader, so nothing floats above or sinks into the surface.
 */
import * as THREE from 'three';
import { glslWaves, applyWaveUniforms } from './waves.js';
import { waterlineOutline, deckHalfWidth } from './ship.js';

/* ================================================================== *
 * Hull foam / bow wave
 * ================================================================== */
export class HullFoam {
  constructor(waveUniforms, { outline = waterlineOutline(80) } = {}) {
    this.outline = outline;
    const n = outline.length;

    // two rings: inner (at the waterline) and outer (offset outward)
    const verts = new Float32Array(n * 2 * 3);
    const side = new Float32Array(n * 2);
    const along = new Float32Array(n * 2);
    const outN = new Float32Array(n * 2 * 2);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const p = outline[i];
      const j = i * 2;
      verts[j * 3] = p.x; verts[j * 3 + 1] = 0; verts[j * 3 + 2] = p.z;
      verts[(j + 1) * 3] = p.x; verts[(j + 1) * 3 + 1] = 0; verts[(j + 1) * 3 + 2] = p.z;
      side[j] = 0; side[j + 1] = 1;
      const t = i / n;
      along[j] = t; along[j + 1] = t;
      outN[j * 2] = p.nx; outN[j * 2 + 1] = p.nz;
      outN[(j + 1) * 2] = p.nx; outN[(j + 1) * 2 + 1] = p.nz;
      const k = (i + 1) % n;
      idx.push(j, k * 2, j + 1, j + 1, k * 2, k * 2 + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    geo.setAttribute('aOut', new THREE.BufferAttribute(outN, 2));
    geo.setIndex(idx);

    this.uniforms = Object.assign({}, waveUniforms, {
      uSpeed: { value: 0 },
      uSlam: { value: 0 },
      uFoamTex: { value: null },
      uColor: { value: new THREE.Color(0xeef4f8) },
      uOffset: { value: new THREE.Vector2() },
    });
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        ${glslWaves()}
        uniform vec2 uOffset;
        uniform float uSpeed;
        uniform float uSlam;
        attribute float aSide;
        attribute float aAlong;
        attribute vec2  aOut;
        varying float vAlpha;
        varying vec3  vWorld;
        varying float vAlong;

        void main() {
          // ship-space -> world via the instance matrix
          vec3 local = position;
          // true outward normal of the waterline loop (in ship XZ)
          vec2 outDir = normalize(aOut);
          // aAlong runs 0 (stern) -> 0.5 (bow, starboard) -> 1 (stern, port),
          // so this peaks at the stem: that is where the water is actually
          // being shouldered aside, and it is what makes the V of the bow wave.
          float bowness = pow(1.0 - abs(aAlong - 0.5) * 2.0, 1.6);
          // the pushed water widens hard with speed, and the bow leads it
          float width = 2.2 + uSpeed * (5.0 + bowness * 11.0) + uSlam * 10.0;
          local.xz += outDir * width * aSide;

          vec4 world = modelMatrix * vec4(local, 1.0);
          vec2 wp = world.xz;
          WaveSample s = sampleWaves(wp);
          // the crest of the shoulder wave rides a little proud of the surface
          vec3 worldPos = vec3(s.pos.x,
            s.pos.y + 0.55 + (1.0 - aSide) * 0.30 + bowness * uSpeed * 1.1,
            s.pos.z);

          vWorld = worldPos;
          vAlong = aAlong;
          // densest right at the hull, thinning outward. The base floor is
          // what draws the waterline: a continuous white collar that masks
          // the mesh-resolution seam where the ocean plane meets the hull.
          float edge = 1.0 - aSide * 0.80;
          vAlpha = edge * clamp(
            0.14 + uSpeed * (0.55 + bowness * 0.75) + uSlam * 1.6, 0.0, 1.7);
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uFoamTex;
        uniform vec3 uColor;
        uniform float uTime;
        varying float vAlpha;
        varying vec3  vWorld;
        varying float vAlong;
        void main() {
          vec2 uv = vec2(vAlong * 26.0, vWorld.x * 0.06 + vWorld.z * 0.06);
          uv += vec2(uTime * 0.06, uTime * 0.03);
          float f = texture2D(uFoamTex, uv).a;
          float f2 = texture2D(uFoamTex, vWorld.xz * 0.035 - uTime * 0.02).a;
          // a base floor keeps the sheet continuous instead of punching holes
          float a = vAlpha * (0.42 + 0.58 * clamp(f * 0.75 + f2 * 0.7, 0.0, 1.0));
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  update(time, field, shipObj, speed, slam) {
    applyWaveUniforms(this.uniforms, field);
    this.uniforms.uTime.value = time;
    this.uniforms.uSpeed.value = Math.min(1, speed / 12);
    this.uniforms.uSlam.value = slam;
    this.mesh.position.copy(shipObj.position);
    this.mesh.quaternion.copy(shipObj.quaternion);
    this.mesh.updateMatrixWorld(true);
  }
}

/* ================================================================== *
 * Wake ribbon
 * ================================================================== */
export class WakeRibbon {
  constructor(waveUniforms, { max = 150, tex = null } = {}) {
    this.max = max;
    this.pts = [];
    this.timer = 0;
    this.interval = 0.18;

    const n = max;
    const verts = new Float32Array(n * 2 * 3);
    const age = new Float32Array(n * 2);
    const side = new Float32Array(n * 2);
    const idx = new Uint16Array((n - 1) * 6);
    for (let i = 0; i < n - 1; i++) {
      const j = i * 2;
      idx[i * 6] = j; idx[i * 6 + 1] = j + 2; idx[i * 6 + 2] = j + 1;
      idx[i * 6 + 3] = j + 1; idx[i * 6 + 4] = j + 2; idx[i * 6 + 5] = j + 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('aAge', new THREE.BufferAttribute(age, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);

    this.geo = geo;
    this.uniforms = Object.assign({}, waveUniforms, {
      uFoamTex: { value: tex },
      uColor: { value: new THREE.Color(0xf2f7fa) },
      uTime: { value: 0 },
    });
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        ${glslWaves()}
        attribute float aAge;
        attribute float aSide;
        varying float vA;
        varying vec3  vWorld;
        varying float vAge;
        void main() {
          vec2 wp = position.xz;
          WaveSample s = sampleWaves(wp);
          vec3 worldPos = vec3(s.pos.x, s.pos.y + 0.32, s.pos.z);
          vWorld = worldPos;
          vAge = aAge;
          // wake is widest and brightest just astern, then dissipates
          float a = smoothstep(0.0, 0.06, aAge) * pow(1.0 - aAge, 1.6);
          vA = a * (1.0 - aSide * 0.55);
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uFoamTex;
        uniform vec3 uColor;
        uniform float uTime;
        varying float vA;
        varying vec3  vWorld;
        varying float vAge;
        void main() {
          if (vA < 0.004) discard;
          // Three octaves of churn, then a hard contrast curve. The previous
          // version summed two soft octaves and the trail read as one flat
          // white sheet; the threshold opens real holes where the churn is
          // weak, which is what makes it look like disturbed water.
          float f1 = texture2D(uFoamTex, vWorld.xz * 0.011 + vec2(-uTime * 0.006, uTime * 0.004)).a;
          float f2 = texture2D(uFoamTex, vWorld.xz * 0.030 + vec2(uTime * 0.010, -uTime * 0.012)).a;
          float f3 = texture2D(uFoamTex, vWorld.xz * 0.085 + vec2(uTime * 0.022, uTime * 0.016)).a;
          float churn = f1 * 0.62 + f2 * 0.55 + f3 * 0.40;
          churn = clamp((churn - 0.22) * 1.55, 0.0, 1.3);
          float a = vA * (0.16 + 0.90 * churn) * 0.68;
          if (a < 0.004) discard;
          // thin water between the foam picks up a cool tint instead of pure white
          vec3 c = mix(uColor, vec3(0.70, 0.81, 0.88), clamp(churn, 0.0, 1.0));
          gl_FragColor = vec4(c, a);
        }
      `,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  reset() { this.pts.length = 0; }

  update(time, dt, field, shipObj, speed) {
    applyWaveUniforms(this.uniforms, field);
    this.uniforms.uTime.value = time;

    this.timer += dt;
    if (this.timer >= this.interval && speed > 0.4) {
      this.timer = 0;
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(shipObj.quaternion);
      const stbd = new THREE.Vector3(0, 0, 1).applyQuaternion(shipObj.quaternion);
      this.pts.push({
        x: shipObj.position.x, z: shipObj.position.z,
        fx: fwd.x, fz: fwd.z, sx: stbd.x, sz: stbd.z,
        speed, t: 0,
      });
      if (this.pts.length > this.max) this.pts.shift();
    }

    const pos = this.geo.attributes.position.array;
    const ageArr = this.geo.attributes.aAge.array;
    const sideArr = this.geo.attributes.aSide.array;
    const n = this.pts.length;
    const life = this.max * this.interval;

    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      p.t += dt;
      const a = Math.min(1, p.t / life);
      // wake half-width grows downstream (a CVN wake is wide but diffuse)
      const w = 11 + a * 26 + (1 - a) * 5;
      const j = i * 2;
      const x = p.x, z = p.z;
      pos[j * 3] = x - p.sx * w; pos[j * 3 + 1] = 0; pos[j * 3 + 2] = z - p.sz * w;
      pos[(j + 1) * 3] = x + p.sx * w; pos[(j + 1) * 3 + 1] = 0; pos[(j + 1) * 3 + 2] = z + p.sz * w;
      const strength = Math.min(1, p.speed / 10);
      ageArr[j] = a / Math.max(0.35, strength);
      ageArr[j + 1] = a / Math.max(0.35, strength);
      sideArr[j] = 0; sideArr[j + 1] = 1;
    }
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAge.needsUpdate = true;
    this.geo.attributes.aSide.needsUpdate = true;
  }
}

/* ================================================================== *
 * Particle system (spray, smoke, embers)
 * ================================================================== */
export class Particles {
  constructor(max = 3000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.kind = new Float32Array(max);      // 0 spray, 1 smoke, 2 ember
    this.count = 0;
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(max), 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1));
    this.geo = geo;
    this.lifeAttr = geo.attributes.aLife;

    const tex = makeSpriteTexture();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uPixelRatio: { value: 1 } },
      transparent: true, depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: /* glsl */`
        attribute float aLife;
        attribute float aSize;
        attribute float aKind;
        varying float vLife;
        varying float vKind;
        uniform float uPixelRatio;
        void main() {
          vLife = aLife; vKind = aKind;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Clamp the on-screen size. Without a cap a particle a couple of
          // metres from the lens (which is exactly what happens when you switch
          // into the bridge or deck rig, right next to the spray) blows up to
          // thousands of pixels and paints a giant blob over the whole view.
          float ps = aSize * uPixelRatio * (260.0 / max(-mv.z, 1.0));
          gl_PointSize = clamp(ps, 1.0, 190.0 * uPixelRatio);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uTex;
        varying float vLife;
        varying float vKind;
        void main() {
          if (vLife <= 0.0) discard;
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float soft = smoothstep(0.5, 0.12, d);
          vec4 t = texture2D(uTex, gl_PointCoord);
          float fade = smoothstep(0.0, 0.15, vLife) * smoothstep(1.0, 0.55, vLife);
          vec3 col;
          float alpha;
          if (vKind < 0.5) {            // spray: bright white water
            col = vec3(0.93, 0.96, 0.99); alpha = fade * 0.85;
          } else if (vKind < 1.5) {     // smoke
            float g = mix(0.06, 0.42, 1.0 - vLife);
            col = vec3(g, g * 0.98, g * 0.97); alpha = fade * 0.5;
          } else {                      // ember
            col = mix(vec3(1.0, 0.85, 0.35), vec3(0.9, 0.15, 0.05), 1.0 - vLife);
            alpha = fade * 0.95;
          }
          gl_FragColor = vec4(col, alpha * t.a * soft);
        }
      `,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  setPixelRatio(r) { this.mat.uniforms.uPixelRatio.value = r; }

  spawn(x, y, z, vx, vy, vz, life, size, kind) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.kind[i] = kind;
  }

  update(dt, wind = 0) {
    const p = this.pos, v = this.vel, l = this.life, la = this.lifeAttr.array;
    for (let i = 0; i < this.max; i++) {
      if (l[i] <= 0) { la[i] = 0; continue; }
      l[i] -= dt;
      const k = this.kind[i];
      if (k < 0.5) {                        // spray: ballistic + drag
        v[i * 3] *= 0.985; v[i * 3 + 1] -= 9.81 * dt; v[i * 3 + 2] *= 0.985;
        p[i * 3] += v[i * 3] * dt;
        p[i * 3 + 1] += v[i * 3 + 1] * dt;
        p[i * 3 + 2] += v[i * 3 + 2] * dt;
      } else if (k < 1.5) {                 // smoke: buoyant, drifts
        v[i * 3 + 1] += 2.4 * dt;
        v[i * 3] += wind * dt;
        p[i * 3] += v[i * 3] * dt;
        p[i * 3 + 1] += v[i * 3 + 1] * dt;
        p[i * 3 + 2] += v[i * 3 + 2] * dt;
        this.size[i] += dt * 5.0;
      } else {                              // ember
        v[i * 3 + 1] -= 6.0 * dt;
        p[i * 3] += v[i * 3] * dt;
        p[i * 3 + 1] += v[i * 3 + 1] * dt;
        p[i * 3 + 2] += v[i * 3 + 2] * dt;
      }
      la[i] = Math.max(0, l[i] / this.maxLife[i]);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.lifeAttr.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aKind.needsUpdate = true;
  }

  /** Live particle count (for diagnostics). */
  get alive() {
    let n = 0;
    for (let i = 0; i < this.max; i++) if (this.life[i] > 0) n++;
    return n;
  }
}

function makeSpriteTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

/* ================================================================== *
 * Spray emitter — driven by how hard the bow is working
 *
 * Three sources feed the same particle pool:
 *   • bow wave    — continuous, scales with speed, thrown forward/outboard
 *   • slamming    — a burst when the forebody buries into a wave face
 *   • tsunami     — a sustained torrent as the wave group passes, plus a
 *                   big vertical launch when the hull is picked up and
 *                   dropped back into the water
 * ================================================================== */
export class SprayEmitter {
  constructor(particles) {
    this.p = particles;
    this.acc = 0;
    this.impactAcc = 0;
    this.punchAcc = 0;
  }

  /**
   * @param {number} seaState  0..1 how rough it is (tsunami active -> ~1)
   * @param {number} vertVel   ship vertical velocity (m/s); big negative =
   *                           she just came down hard off a crest
   * @param {number} bowPunch  0..1 how deep the forefoot is buried in the
   *                           face of the oncoming wave (deck-at-water)
   */
  update(dt, shipObj, speed, slam, field, seaState = 0, vertVel = 0, bowPunch = 0) {
    const rate = speed * 13 + slam * 320 + seaState * 55;
    if (rate < 1) return;
    this.acc += rate * dt;
    const n = Math.min(60, Math.floor(this.acc));
    this.acc -= n;

    const q = shipObj.quaternion;
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const stbd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const drop = Math.max(0, -vertVel);          // falling speed onto the sea

    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? 1 : -1;
      // most of the spray comes off the forebody where the bow parts the water
      const along = Math.random() < 0.72
        ? 150 + Math.random() * 18          // bow
        : -20 + Math.random() * 150;        // along the hull
      // Born OUTBOARD of the flight-deck outline: spray that starts under
      // the 78 m deck overhang rises through it and reads as water clipping
      // through the ship. Out past the outline it can fly as high as it likes.
      const dw = deckHalfWidth(along, side);
      const local = new THREE.Vector3(
        along,
        -1.5 + Math.random() * 2.0,
        side * (dw + 0.8 + Math.random() * 6),
      );
      local.applyQuaternion(q).add(shipObj.position);

      // vertical launch: the harder she is working / the harder she lands,
      // the higher the plume. A tsunami pass throws water mast-high.
      const up = 2.5 + Math.random() * 6
               + speed * 0.42
               + slam * 26
               + seaState * (8 + Math.random() * 16)
               + drop * 1.4;
      const out = 3.5 + Math.random() * 8 + speed * 0.5 + seaState * 7;
      this.p.spawn(
        local.x, local.y, local.z,
        fwd.x * speed * 0.6 + stbd.x * out * side + (Math.random() - 0.5) * 3.5,
        up,
        fwd.z * speed * 0.6 + stbd.z * out * side + (Math.random() - 0.5) * 3.5,
        1.6 + Math.random() * 2.4,
        3 + Math.random() * 8 + slam * 16 + seaState * 9,
        0,
      );
    }

    // ---- bow-punch curtain --------------------------------------------
    // bowPunch > 0 means the forefoot is IN the face of a wave: the deck at
    // the stem sits at or below the oncoming water. That deserves a wall of
    // white water thrown high and wide off the bow, PLUS sheet flow tearing
    // aft ACROSS the deck — from the bridge, this pair is exactly what
    // "crashing through a wave" looks like from inside.
    if (bowPunch > 0.06) {
      this.punchAcc += bowPunch * 300 * dt;
      const m = Math.min(70, Math.floor(this.punchAcc));
      this.punchAcc -= m;
      for (let i = 0; i < m; i++) {
        if (Math.random() < 0.62) {
          // curtain: launched off the stem, thrown up and outboard
          const side = Math.random() < 0.5 ? 1 : -1;
          const along = 130 + Math.random() * 40;
          const dw = deckHalfWidth(along, side);
          const local = new THREE.Vector3(
            along, 19 + Math.random() * 3,
            side * (dw * (0.9 + Math.random() * 0.2)));
          local.applyQuaternion(q).add(shipObj.position);
          const up = 8 + Math.random() * 14 + bowPunch * 14;
          const out = 6 + Math.random() * 14;
          this.p.spawn(
            local.x, local.y, local.z,
            fwd.x * speed * 0.25 + stbd.x * out * side + (Math.random() - 0.5) * 6,
            up,
            fwd.z * speed * 0.25 + stbd.z * out * side + (Math.random() - 0.5) * 6,
            1.8 + Math.random() * 2.6, 6 + Math.random() * 12 + bowPunch * 10, 0);
        } else {
          // sheet flow: water already on the deck, torn aft across it
          const local = new THREE.Vector3(
            60 + Math.random() * 105, 21.2 + Math.random() * 2.2,
            (Math.random() - 0.5) * 56);
          local.applyQuaternion(q).add(shipObj.position);
          const back = -(6 + Math.random() * 10 + speed * 0.3);
          this.p.spawn(
            local.x, local.y, local.z,
            fwd.x * back + (Math.random() - 0.5) * 4,
            1.5 + Math.random() * 5,
            fwd.z * back + (Math.random() - 0.5) * 4,
            1.4 + Math.random() * 1.8, 5 + Math.random() * 9, 0);
        }
      }
    }

    // ---- impact plume ------------------------------------------------
    // When she is dropped back into the water (large negative vertical
    // velocity) throw one dense ring of water outward, the way a real hull
    // landing off a wave detonates the surface — always outside the deck
    // silhouette, never through it.
    if (drop > 2.5 || slam > 0.45) {
      this.impactAcc += (drop * 5 + slam * 30) * dt;
      const m = Math.min(90, Math.floor(this.impactAcc));
      this.impactAcc -= m;
      for (let i = 0; i < m; i++) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const along = -150 + Math.random() * 310;
        const dw = deckHalfWidth(along, side);
        const local = new THREE.Vector3(
          along,
          -1.5 + Math.random() * 2,
          side * (dw + 1 + Math.random() * 52),
        );
        local.applyQuaternion(q).add(shipObj.position);
        const out = 8 + Math.random() * 20;
        this.p.spawn(
          local.x, local.y, local.z,
          stbd.x * out * side + fwd.x * speed * 0.3 + (Math.random() - 0.5) * 4,
          6 + Math.random() * 18 + drop * 1.2,
          stbd.z * out * side + (Math.random() - 0.5) * 4,
          2.0 + Math.random() * 2.6,
          6 + Math.random() * 14,
          0,
        );
      }
    }
  }
}

/* ================================================================== *
 * Rain — a storm of falling streaks that follows the camera
 *
 * Rendered as LineSegments (each drop = one short segment) rather than
 * point sprites, because rain reads by its *streaks*: a stretched vertical
 * line with a slight wind slant. The whole field is a box that rides with the
 * camera and wraps at its edges, so a few thousand drops cover the entire
 * view no matter where the player looks or how fast the ship is moving.
 * ================================================================== */
export class Rain {
  constructor(count = 2400) {
    this.count = count;
    this.box = { w: 300, h: 170 };
    this.wind = 9;                       // m/s sideways drift
    this.pos = new Float32Array(count * 2 * 3);
    this.vel = new Float32Array(count);  // per-drop fall speed
    this.len = new Float32Array(count);  // streak length
    this.center = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      this.vel[i] = 34 + Math.random() * 26;
      this.len[i] = 1.4 + Math.random() * 2.6;
      const j = i * 6;
      this.pos[j] = (Math.random() - 0.5) * this.box.w;
      this.pos[j + 1] = Math.random() * this.box.h;
      this.pos[j + 2] = (Math.random() - 0.5) * this.box.w;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo = geo;
    this.mat = new THREE.LineBasicMaterial({
      color: 0xc2d8ea, transparent: true, opacity: 0, depthWrite: false,
    });
    this.mesh = new THREE.LineSegments(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  update(dt, camPos, intensity) {
    this.mat.opacity = intensity * 0.40;
    this.mesh.visible = intensity > 0.02;
    if (!this.mesh.visible) return;

    const p = this.pos;
    const hw = this.box.w * 0.5;
    const cx = camPos.x, cy = camPos.y, cz = camPos.z;
    for (let i = 0; i < this.count; i++) {
      const j = i * 6;
      let x = p[j], y = p[j + 1], z = p[j + 2];
      y -= this.vel[i] * dt;
      x += this.wind * dt;

      // wrap around the camera in XZ so the field never runs out
      if (x < cx - hw) x += this.box.w; else if (x > cx + hw) x -= this.box.w;
      if (z < cz - hw) z += this.box.w; else if (z > cz + hw) z -= this.box.w;
      // recycle when it falls below the camera
      if (y < cy - 30) {
        y = cy + this.box.h * (0.55 + Math.random() * 0.45);
        x = cx + (Math.random() - 0.5) * this.box.w;
        z = cz + (Math.random() - 0.5) * this.box.w;
      }

      const L = this.len[i];
      // bottom of the streak, then the top (slanted back into the wind)
      p[j] = x; p[j + 1] = y; p[j + 2] = z;
      p[j + 3] = x - this.wind * 0.045;
      p[j + 4] = y + L;
      p[j + 5] = z;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

/* ================================================================== *
 * Prop wash — the churned white water the screws throw astern
 *
 * A CVN drives four shafts; at speed the water behind the transom is a
 * boiling, turbulent band quite distinct from the smooth wake trail further
 * back. This is a single graded quad parented to the ship, sampling the same
 * wave field so it sits exactly on the surface, with foam noise scrolling
 * fast and the intensity driven by throttle.
 * ================================================================== */
export class PropWash {
  constructor(waveUniforms, { tex = null } = {}) {
    // long axis along the hull (local x), aft of the transom (x = -168)
    const ALONG = 96, ACROSS = 54;
    const geo = new THREE.PlaneGeometry(ALONG, ACROSS, 26, 14);
    geo.rotateX(-Math.PI / 2);
    geo.translate(-168 - ALONG / 2, 0, 0);

    this.uniforms = Object.assign({}, waveUniforms, {
      uThrottle: { value: 0 },
      uFoamTex: { value: tex },
      uColor: { value: new THREE.Color(0xf4f9fc) },
      uTime: { value: 0 },
    });
    // spool state: screws take seconds to spin up and the churn takes seconds
    // more to reach the surface — the plume must GROW, not pop in
    this.level = 0;
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        ${glslWaves()}
        uniform float uThrottle;
        varying float vA;
        varying vec3  vWorld;
        varying float vT;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vec2 wp = world.xz;
          WaveSample s = sampleWaves(wp);
          // t = 0 at the transom, 1 at the far end of the churn
          float t = clamp((-168.0 - position.x) / ${ALONG}.0, 0.0, 1.0);
          vT = t;
          float across = 1.0 - abs(position.z) / ${ACROSS * 0.5}.0;
          // the screws physically bulge the water right behind the ship
          float mound = uThrottle * uThrottle * (1.0 - t) * (0.55 + across * 0.45);
          vec3 worldPos = vec3(s.pos.x, s.pos.y + 0.30 + mound, s.pos.z);
          // widest and brightest right behind the screws, dissipating aft —
          // and the churn FIELD only reaches as far as the screws have spun up
          vA = (1.0 - t) * clamp(across * 1.4, 0.0, 1.0)
             * clamp(uThrottle * 1.15, 0.0, 1.0);
          vWorld = worldPos;
          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uFoamTex;
        uniform vec3 uColor;
        uniform float uTime;
        varying float vA;
        varying vec3  vWorld;
        varying float vT;
        void main() {
          if (vA < 0.004) discard;
          // fast, tight churn: the water here is agitated, not a smooth sheet
          float f1 = texture2D(uFoamTex, vWorld.xz * 0.09 + vec2(uTime * 0.10, -uTime * 0.07)).a;
          float f2 = texture2D(uFoamTex, vWorld.xz * 0.28 - vec2(uTime * 0.22, uTime * 0.15)).a;
          float f3 = texture2D(uFoamTex, vWorld.xz * 0.62 + vec2(-uTime * 0.4, uTime * 0.3)).a;
          float churn = clamp(f1 * 0.5 + f2 * 0.7 + f3 * 0.45, 0.0, 1.3);
          // churn only reaches as far down the trail as the wash has grown
          float a = vA * (0.35 + 0.75 * churn);
          if (a < 0.004) discard;
          // a touch brighter right at the screws
          vec3 c = uColor * (1.05 - vT * 0.25);
          gl_FragColor = vec4(c, clamp(a, 0.0, 0.92));
        }
      `,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  update(time, dt, field, shipObj, throttle) {
    applyWaveUniforms(this.uniforms, field);
    this.uniforms.uTime.value = time;

    // Spool-up: τ ≈ 3.2 s opening the throttle, ≈ 4.5 s backing off. On top
    // of that the intensity never holds still — layered sines give it the
    // uneven surge real propeller wash has, so it never reads as a decal.
    const target = Math.max(0, throttle);
    const tau = target > this.level ? 3.2 : 4.5;
    this.level += (target - this.level) * (1 - Math.exp(-dt / tau));
    const wob = 0.86
      + 0.09 * Math.sin(time * 0.9)
      + 0.05 * Math.sin(time * 2.3 + 1.7)
      + 0.04 * Math.sin(time * 5.1 + 0.6);
    this.uniforms.uThrottle.value = Math.max(0, this.level * wob);

    this.mesh.position.copy(shipObj.position);
    this.mesh.quaternion.copy(shipObj.quaternion);
    this.mesh.updateMatrixWorld(true);
  }
}
