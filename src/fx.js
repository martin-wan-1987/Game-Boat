/** Generic damage particles and storm rain. Ship water lives in vessel-water.js. */
import * as THREE from 'three';

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
          } else if(vKind < 2.5) {       // ember
            col = mix(vec3(1.0, 0.85, 0.35), vec3(0.9, 0.15, 0.05), 1.0 - vLife);
            alpha = fade * 0.95;
          } else {                      // pale, expanding propellant smoke
            col=vec3(.62,.65,.65); alpha=fade*.46;
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
  reset(){this.life.fill(0);this.lifeAttr.array.fill(0);this.lifeAttr.needsUpdate=true;this.cursor=0;}

  spawn(x, y, z, vx, vy, vz, life, size, kind) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.kind[i] = kind;
  }

  update(dt, wind = 0,field=null) {
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
        if(field&&p[i*3+1]<=field.heightAt(p[i*3],p[i*3+2])){l[i]=0;la[i]=0;continue;}
      } else if (k < 1.5 || k > 2.5) {       // smoke: buoyant, drifts
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

export class Rain {
  constructor(count = 2400) {
    this.count = count;
    this.box = { w: 300, h: 170 };
    this.wind = 16;                      // m/s sideways drift — a squall, not a drizzle
    this.pos = new Float32Array(count * 2 * 3);
    this.vel = new Float32Array(count);  // per-drop fall speed
    this.len = new Float32Array(count);  // streak length
    this.center = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      this.vel[i] = 46 + Math.random() * 34;
      this.len[i] = 2.0 + Math.random() * 3.6;
      const j = i * 6;
      this.pos[j] = (Math.random() - 0.5) * this.box.w;
      this.pos[j + 1] = Math.random() * this.box.h;
      this.pos[j + 2] = (Math.random() - 0.5) * this.box.w;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo = geo;
    this.mat = new THREE.LineBasicMaterial({
      color: 0xcfdcEC, transparent: true, opacity: 0, depthWrite: false,
    });
    this.mesh = new THREE.LineSegments(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  update(dt, camPos, intensity) {
    this.mat.opacity = intensity * 0.55;
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
