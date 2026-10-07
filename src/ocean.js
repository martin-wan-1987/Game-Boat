/**
 * ocean.js — the sea surface.
 *
 * A single, crack-free, graded grid centred on the ship: cells are ~1.8 m
 * near the player and grow to ~50 m at the horizon, so we get detail where it
 * matters and a horizon that reaches 12 km without a million vertices.
 *
 * The vertex shader calls the *same* Gerstner code the buoyancy solver uses,
 * so what you see is literally what the ship is floating on.
 */
import * as THREE from 'three';
import { glslWaves, applyWaveUniforms } from './waves.js';
import { cloudGLSL } from './atmosphere.js';
import {searchlightGLSL} from './searchlights.js';
import {solidWaterGLSL} from './solid-water.js';
import {islandGLSL} from './islands.js';

/* ------------------------------------------------------------------ *
 * Procedural textures
 * ------------------------------------------------------------------ */
function hash2(x, y) {
  let n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * valueNoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}

/** Tileable-ish normal map for fine capillary ripples. */
export function makeRippleNormalTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const H = new Float32Array(size * size);
  // Integer Fourier modes are exactly periodic across both tile boundaries.
  const spectrum = [[3,2,.17],[2,-5,.12],[-6,1,.11],[7,9,.06],[-11,5,.05],[15,-7,.036],[21,17,.028],[-29,11,.022],[31,-23,.018],[-17,-37,.016]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      H[y * size + x] = spectrum.reduce((height,[kx,ky,amplitude],i) =>
        height + Math.sin((kx*x+ky*y)/size*Math.PI*2+i*1.73)*amplitude,0);
    }
  }
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * 3.0;
      const dy = (at(x, y + 1) - at(x, y - 1)) * 3.0;
      let nx = -dx, ny = -dy, nz = 1.0;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Wispy, continuous foam alpha texture (soft — hard-edged blobs read as
 *  holes when the wake samples it). */
export function makeFoamTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / size * 5, fy = y / size * 5;
      // two scales so the pattern never fully closes up
      const a = fbm(fx, fy, 4);
      const b = fbm(fx * 2.7 + 11.3, fy * 2.7 + 5.1, 3);
      let v = 0.62 * a + 0.38 * b;
      v = Math.max(0, v * 1.35 - 0.18);        // gentle contrast
      v = Math.min(1, Math.pow(v, 0.85));
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = v * 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ *
 * Graded grid
 * ------------------------------------------------------------------ */
function buildGrid(extent, seg, grade) {
  const n = seg + 1;
  const pos = new Float32Array(n * n * 3);
  const remap = (u) => (Math.sinh(grade * u) / Math.sinh(grade)) * extent;
  for (let j = 0; j < n; j++) {
    const v = remap((j / seg) * 2 - 1);
    for (let i = 0; i < n; i++) {
      const u = remap((i / seg) * 2 - 1);
      const k = (j * n + i) * 3;
      pos[k] = u; pos[k + 1] = 0; pos[k + 2] = v;
    }
  }
  const idx = new Uint32Array(seg * seg * 6);
  let p = 0;
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), extent * 1.5);
  return g;
}

/* ------------------------------------------------------------------ *
 * Ocean
 * ------------------------------------------------------------------ */
export class Ocean {
  /**
   * @param {object} opts
   * @param {object} opts.waveUniforms shared wave uniform block
   */
  constructor({ waveUniforms,searchlightUniforms,solidWater, extent = 12000, seg = 384, grade = 5.2, quality = 'high' }) {
    this.extent = extent;
    this.seg = seg;
    this.grade = grade;

    const ripple = makeRippleNormalTexture(256);
    const foamTex = makeFoamTexture(256);
    ripple.repeat.set(1, 1);
    this.rippleTex = ripple;
    this.foamTex = foamTex;

    this.uniforms = Object.assign({}, waveUniforms,searchlightUniforms,solidWater.uniforms, {
      uOffset:      { value: new THREE.Vector2() },
      uEnvMap:      { value: null },
      uReflection:  { value: null },
      uReflectionMatrix: { value: new THREE.Matrix4() },
      uSunDir:      { value: new THREE.Vector3(0, 1, 0) },
      uSunColor:    { value: new THREE.Color(1, 0.95, 0.85) },
      uSunStrength: { value: 2.9 },
      uDeepColor:   { value: new THREE.Color(0x061a26) },
      uShallowColor:{ value: new THREE.Color(0x1c3d49) },
      uSSSColor:    { value: new THREE.Color(0x1b6066) },
      uFoamColor:   { value: new THREE.Color(0xe6f0f5) },
      uFogColor:    { value: new THREE.Color(0x9fb3c4) },
      uFogDensity:  { value: 0.000115 },
      uRippleNrm:   { value: ripple },
      uFoamTex:     { value: foamTex },
      uRippleAmt:   { value: 1.0 },
      uTsunamiFoam: { value: 0.0 },
      uExposure:    { value: 1.0 },
    });

    const geo = buildGrid(extent, seg, grade);
    // finest cell size — used to snap the grid so vertices never swim
    this.finestCell = (Math.sinh(grade / seg) / Math.sinh(grade)) * extent;

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        ${glslWaves()}
        uniform vec2 uOffset;
        varying vec3  vWorld;
        varying vec3  vNrm;
        varying float vFoam;
        varying float vHeight;
        varying float vDist;
        varying float vJitter;

        void main() {
          vec2 wp = position.xz + uOffset;
          WaveSample s = sampleWaves(wp);
          vec3 worldPos = vec3(s.pos.x, s.pos.y, s.pos.z);

          vWorld  = worldPos;
          vNrm    = s.nrm;
          vHeight = s.pos.y;
          vDist   = distance(worldPos, cameraPosition);

          // Whitecaps follow compression / breaking, not world elevation.
          // A 30 m long swell can have a gentle face with no white water.
          float j = s.jac;
          float fold = 1.0 - smoothstep(0.48, 0.76, j);
          vFoam = max(fold, smoothstep(0.32, 0.66, length(s.nrm.xz)) * 0.34);

          gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        ${cloudGLSL()}
        ${searchlightGLSL(searchlightUniforms.uSearchPosition.value.length)}
        ${solidWaterGLSL(solidWater.maxEdges,solidWater.maxActors)}
        ${islandGLSL()}

        uniform vec3  uSunDir;
        uniform vec3  uSunColor;
        uniform vec3  uDeepColor;
        uniform vec3  uShallowColor;
        uniform vec3  uSSSColor;
        uniform vec3  uFoamColor;
        uniform vec3  uFogColor;
        uniform float uFogDensity;
        uniform float uTime;
        uniform float uRippleAmt;
        uniform float uTsunamiFoam;
        uniform float uExposure;
        uniform float uSunStrength;
        uniform mat4 uReflectionMatrix;
        uniform sampler2D uReflection;
        uniform samplerCube uEnvMap;
        uniform sampler2D   uRippleNrm;
        uniform sampler2D   uFoamTex;

        varying vec3  vWorld;
        varying vec3  vNrm;
        varying float vFoam;
        varying float vHeight;
        varying float vDist;

        void main() {
          if(solidWater(vWorld)||islandWater(vWorld.xz))discard;
          vec3 V = normalize(cameraPosition - vWorld);
          float dist = vDist;

          // ---- fine capillary ripples -----------------------------------
          vec3 gN = normalize(vNrm);
          vec3 T = normalize(cross(gN, vec3(0.0, 0.0, 1.0)));
          vec3 B = cross(T, gN);
          float fade = 1.0 - smoothstep(260.0, 2600.0, dist);
          vec3 N = gN;
          if (fade > 0.001) {
            vec2 uv1 = vWorld.xz * 0.055 + vec2(uTime * 0.0110, uTime * 0.0074);
            mat2 rippleFrame = mat2(0.70710678, -0.70710678, 0.70710678, 0.70710678);
            vec2 uv2 = rippleFrame * vWorld.xz * 0.145 - vec2(uTime * 0.0195, uTime * 0.0138);
            vec3 n1 = texture2D(uRippleNrm, uv1).xyz * 2.0 - 1.0;
            vec3 n2 = texture2D(uRippleNrm, uv2).xyz * 2.0 - 1.0;
            // NB: a third, very LARGE ripple tile was removed here — at
            // orbit-camera range its ~80 m repeat was clearly visible as
            // concentric banding. This third octave is FINE (decimetre
            // capillary), which cannot band: it only adds close-range
            // sparkle for the bridge and deck rigs.
            vec3 n3 = texture2D(uRippleNrm,
              vWorld.xz * 0.37 + vec2(uTime * 0.031, -uTime * 0.024)).xyz * 2.0 - 1.0;
            // Texture coordinates rotate into the ripple frame; gradients
            // return by its transpose. Rotating the gradient alone leaves
            // the two sampling grids aligned and repeats the same pattern.
            vec2 rot2 = transpose(rippleFrame) * n2.xy;
            vec2 rip = n1.xy + rot2 * 0.6 + n3.xy * 0.35;
            N = normalize(gN + (T * rip.x + B * rip.y) * 0.65 * uRippleAmt * fade);
          }

          // ---- base water colour ---------------------------------------
          float hn = clamp(vHeight * 0.06 + 0.5, 0.0, 1.0);
          vec3 deep = mix(uDeepColor, uShallowColor, hn * 0.85);
          deep*=1.0-uNight*.35;
          // A breath of the haze colour keeps the water body off the black
          // floor: in a storm the sky dimms, the reflections dim with it,
          // and a shadowed crest could otherwise sink under display black —
          // half the frame reads as a blackout, not weather.
          deep = mix(deep, uFogColor, 0.16);

          // ---- sky reflection ------------------------------------------
          vec3 R = reflect(-V, N);
          R.y = abs(R.y) * 0.85 + 0.02;
          vec3 sky = textureCube(uEnvMap, R).rgb*(1.0-uNight*.93);
          vec4 reflected = uReflectionMatrix * vec4(vWorld.x, 0.0, vWorld.z, 1.0);
          vec2 reflectionUV = reflected.xy / reflected.w;
          reflectionUV += N.xz * 0.018 * fade;
          float inside = step(0.0, reflectionUV.x) * step(reflectionUV.x, 1.0)
            * step(0.0, reflectionUV.y) * step(reflectionUV.y, 1.0) * step(0.0, reflected.w);
          vec3 sceneReflection = texture2D(uReflection, clamp(reflectionUV, 0.001, 0.999)).rgb;
          sky = mix(sky, sceneReflection, inside * (0.97 - fade * 0.06));

          float fres = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0, 1.0), 5.0);
          // Water-air dielectric Fresnel; grazing views reflect the sky.
          fres = mix(0.0204, 1.0, fres);

          vec3 col = mix(deep, sky * 1.08, fres);

          // GGX microfacet sunlight. Texture slopes make many moving glints;
          // increasing roughness at distance integrates subpixel highlights.
          vec3 H = normalize(uSunDir + V);
          float nh = max(dot(N, H), 0.0);
          float nl = max(dot(N, uSunDir), 0.0), nv = max(dot(N, V), 0.001);
          // Integrate unresolved normal variance over the pixel footprint.
          // Distance alone misses oblique views, where a near ripple can
          // still cover a fraction of a pixel and produce a flashing glint.
          vec3 dNx=dFdx(N),dNy=dFdy(N);
          float normalVariance=.25*(dot(dNx,dNx)+dot(dNy,dNy));
          float roughness = sqrt(clamp(pow(mix(0.20,0.10,fade),2.0)+normalVariance,.01,.36));
          float a2 = pow(roughness, 4.0);
          float denominator = nh * nh * (a2 - 1.0) + 1.0;
          float distribution = a2 / (3.14159265 * denominator * denominator);
          float k = pow(roughness + 1.0, 2.0) / 8.0;
          float visibility = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
          float specFresnel = 0.0204 + 0.9796 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
          float specular = distribution * visibility * specFresnel / (4.0 * nv);
          col += uSunColor * uSunStrength * specular * cloudTransmission(vWorld,uSunDir);
          col += searchSurface(vWorld,N,V);

          // ---- subsurface scattering through thin crests ----------------
          float back = pow(clamp(dot(V, -uSunDir), 0.0, 1.0), 3.0);
          float thin = smoothstep(0.05, 0.75, vHeight * 0.16 + 0.28);
          col += uSSSColor * back * thin * 0.38*(1.0-uNight*.7);

          // ---- foam / whitecaps ----------------------------------------
          float foam = vFoam;
          if (foam > 0.002) {
            vec2 fuv = vWorld.xz * 0.055 + vec2(uTime * 0.010, uTime * -0.008);
            float ftex = texture2D(uFoamTex, fuv).a;
            float ftex2 = texture2D(uFoamTex, vWorld.xz * 0.014 - vec2(uTime*0.004)).a;
            // a third, very fine break-up pass so the sheet is never a flat blob
            float ftex3 = texture2D(uFoamTex, vWorld.xz * 0.21 + vec2(-uTime*0.02, uTime*0.017)).a;
            foam *= clamp(ftex * 0.6 + ftex2 * 0.62 + ftex3 * 0.30, 0.0, 1.5);
            foam = clamp(foam * 1.55, 0.0, 1.0);
            // Retain translucent blue faces; foam collects on folding crests.
            foam = clamp(foam * (1.0 + uTsunamiFoam * 0.18), 0.0, 1.0);

            // Volume: a foam crown lit from the sun side reads as a rounded
            // mass of water rather than a decal. Shading the foam by its own
            // normal (instead of a flat colour) is what sells it.
            float shade = dot(N, uSunDir);
            vec3 fc = uFoamColor * (0.62 + 0.38 * smoothstep(-0.35, 0.85, shade))*(1.0-uNight*.72);
            // a touch of cool shadow in the troughs of the foam
            fc = mix(fc * vec3(0.72, 0.80, 0.88), fc, smoothstep(-0.1, 0.5, shade));
            col = mix(col, fc, foam * 0.94);
          }

          // ---- distance fade / fog -------------------------------------
          float f = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
          f = clamp(f, 0.0, 1.0);
          col = mix(col, uFogColor, f);

          gl_FragColor = vec4(col * uExposure, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.mesh.matrixAutoUpdate = false;
  }

  setEnvMap(tex) { this.uniforms.uEnvMap.value = tex; }
  setClouds(clouds) { Object.assign(this.uniforms,clouds.uniforms); }
  setReflection(texture, matrix) {
    this.uniforms.uReflection.value = texture;
    this.uniforms.uReflectionMatrix.value = matrix;
  }
  setSun(dir, color) {
    this.uniforms.uSunDir.value.copy(dir);
    this.uniforms.uSunColor.value.copy(color);
  }
  setFog(color, density) {
    this.uniforms.uFogColor.value.copy(color);
    this.uniforms.uFogDensity.value = density;
  }

  update(time, shipPos, waveField) {
    applyWaveUniforms(this.uniforms, waveField);
    this.uniforms.uTime.value = time;
    this.uniforms.uCamDist.value = this._camDist || 0;
    // The graded grid is centred on the SHIP, not the camera: the finest
    // cells (~1.2-1.6 m) then always sit exactly where the hull meets the
    // water, so steep waves never slice through the ship side between
    // coarse vertices — the "water clipping into the hull" artefact. With a
    // camera-centred grid, orbiting put the ship 600 m out in 5-10 m cells.
    // Snapping to whole cells keeps the vertices static in world space.
    const c = this.finestCell * 4;
    this.uniforms.uOffset.value.set(
      Math.round(shipPos.x / c) * c,
      Math.round(shipPos.z / c) * c,
    );
    this.uniforms.uTsunamiFoam.value = THREE.MathUtils.clamp(
      Math.abs(waveField.eventHeightAt(shipPos.x, shipPos.z)) / 15, 0, 1);
  }

  /** Per-frame camera distance, used for the short-wave LOD fade. */
  setCamDist(d) { this._camDist = d; }

  /** Swap in a coarser grid (quality governor). Same maths, fewer cells. */
  rebuild(seg) {
    if (seg >= this.seg) return;
    this.seg = seg;
    this.mesh.geometry.dispose();
    this.mesh.geometry = buildGrid(this.extent, seg, this.grade);
    this.finestCell = (Math.sinh(this.grade / seg) / Math.sinh(this.grade)) * this.extent;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.rippleTex.dispose();
    this.foamTex.dispose();
  }
}
