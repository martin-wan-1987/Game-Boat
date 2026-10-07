/** Ship water effects. All surface channels share one mesh and wave sampler.
 * Bow shoulders and propeller wash follow the ship. Kelvin arms and turbulent
 * wake preserve the actual stern positions in world space, including turns.
 */
import * as THREE from 'three';
import {solidWaterGLSL} from './solid-water.js';
import {islandGLSL} from './islands.js';
import { glslWaves, applyWaveUniforms } from './waves.js';


const KELVIN_SLOPE = Math.tan(Math.asin(1 / 3));
const INTERVAL = 0.16;
const LIFE = 32;
const _forward = new THREE.Vector3(), _side = new THREE.Vector3();
const _world = new THREE.Vector3(), _normal = new THREE.Vector3();

export class VesselWaterFX {
  constructor(waveUniforms, { vessel, loft, tex, solidWater,islands, particles = 4800, history = 210, pixelRatio = 1 }) {
    this.vessel=vessel;this.loft=loft;
    this.historyLimit = history;
    this.history = [];
    this.sampleClock = 0;
    this.propLevel = 0;
    this.sides = loft.surfaces.flatMap(surface=>{
      const outline=surface.waterlineOutline(96);
      return [-1,1].map(side=>outline.filter(p=>p.side===side).sort((a,b)=>b.x-a.x));
    });
    // Spray samples the full hull station range: a breaking crest can reach
    // sections that are dry at the calm operating waterline.
    this.spraySources = loft.surfaces.flatMap(surface=>surface.waterlineOutline(96,0)
      .filter((p,i)=>i%4===0).map(p=>({...p,point:surface.point})));
    this.emitCarry=new Float32Array(this.spraySources.length);
    this.contact=new THREE.Vector3();this.relative=new THREE.Vector3();this.pointVelocity=new THREE.Vector3();this.waterSample={};
    this.channels = [...this.sides.map(p => p.length), ...Array(vessel.propulsion.shafts.length).fill(32), ...Array(3).fill(history)];
    this.offsets = [];
    let count = 0;
    const indices = [];
    for (const sections of this.channels) {
      this.offsets.push(count);
      for (let i = 0; i < sections - 1; i++) for (let lane = 0; lane < 2; lane++) {
        const a = (count + i) * 3 + lane, b = a + 3;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
      count += sections;
    }
    const geometry = new THREE.BufferGeometry();
    for (const [name, components] of [['position', 3], ['aAcross', 1], ['aAge', 1], ['aStrength', 1], ['aLift', 1]]) {
      geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * 3 * components), components).setUsage(THREE.DynamicDrawUsage));
    }
    geometry.setIndex(indices);
    this.geometry = geometry;
    this.uniforms = { ...waveUniforms,...solidWater.uniforms,...islands.uniforms, uFoamTex: { value: tex } };
    this.foam = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      name: 'Vessel surface water', uniforms: this.uniforms, transparent: true,
      depthWrite: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        ${glslWaves()}
        attribute float aAcross, aAge, aStrength, aLift;
        varying vec3 vWorld;
        varying float vAcross, vAlpha;
        void main() {
          WaveSample wave = sampleWaves(position.xz);
          vWorld = wave.pos + vec3(0.0, 0.16 + aLift * (1.0 - aAcross * aAcross), 0.0);
          vAcross = aAcross;
          vAlpha = aStrength * pow(1.0 - aAge, 1.5);
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        ${solidWaterGLSL(solidWater.maxEdges,solidWater.maxActors)}
        ${islandGLSL()}
        uniform sampler2D uFoamTex;
        uniform float uTime;
        varying vec3 vWorld;
        varying float vAcross, vAlpha;
        void main() {
          if(solidWater(vWorld)||islandWater(vWorld.xz))discard;
          float edge = 1.0 - smoothstep(0.30, 1.0, abs(vAcross));
          float coarse = texture2D(uFoamTex, vWorld.xz * 0.071 + vec2(uTime * 0.035, -uTime * 0.019)).a;
          float fine = texture2D(uFoamTex, vWorld.xz * 0.43 - vec2(uTime * 0.08, uTime * 0.031)).a;
          float bubbles = smoothstep(0.23, 0.71, coarse * 0.7 + fine * 0.6);
          float alpha = edge * vAlpha * (0.12 + 0.78 * bubbles);
          if (alpha < 0.003) discard;
          vec3 colour = mix(vec3(0.44, 0.66, 0.71), vec3(0.91, 0.97, 1.0), bubbles);
          gl_FragColor = vec4(colour, alpha);
        }
      `,
    }));
    this.foam.frustumCulled = false;
    this.foam.renderOrder = 2;

    this.capacity = particles;
    this.sprayPosition = new Float32Array(particles * 3);
    this.sprayVelocity = new Float32Array(particles * 3);
    this.sprayLife = new Float32Array(particles);
    this.sprayDuration = new Float32Array(particles);
    this.spraySize = new Float32Array(particles);
    this.sprayAlpha = new Float32Array(particles);
    const drops = new THREE.BufferGeometry();
    drops.setAttribute('position', new THREE.BufferAttribute(this.sprayPosition, 3).setUsage(THREE.DynamicDrawUsage));
    drops.setAttribute('aSize', new THREE.BufferAttribute(this.spraySize, 1).setUsage(THREE.DynamicDrawUsage));
    drops.setAttribute('aAlpha', new THREE.BufferAttribute(this.sprayAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.sprayUniforms = { uPixelRatio: { value: pixelRatio }, uHeight: { value: innerHeight } };
    this.drops = new THREE.Points(drops, new THREE.ShaderMaterial({
      name: 'Ballistic water droplets', uniforms: this.sprayUniforms, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        attribute float aSize, aAlpha;
        uniform float uPixelRatio, uHeight;
        varying float vAlpha;
        void main() {
          vec4 eye = modelViewMatrix * vec4(position, 1.0);
          vAlpha = aAlpha;
          float diameter = aSize * projectionMatrix[1][1] * uHeight * 0.5 / max(1.0, -eye.z);
          gl_PointSize = clamp(diameter, 1.0, 42.0) * uPixelRatio;
          gl_Position = projectionMatrix * eye;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        varying float vAlpha;
        void main() {
          vec2 point = gl_PointCoord * 2.0 - 1.0;
          float radius = dot(point, point);
          if (radius > 1.0 || vAlpha < 0.002) discard;
          float rim = 1.0 - smoothstep(0.1, 1.0, radius);
          float light = 0.75 + 0.25 * (1.0 - point.y);
          gl_FragColor = vec4(vec3(0.84, 0.95, 1.0) * light, rim * vAlpha * 0.78);
        }
      `,
    }));
    this.drops.frustumCulled = false;
    this.drops.renderOrder = 3;
    this.reset();
  }

  reset() {
    this.history.length = 0; this.sampleClock = 0; this.propLevel = 0;
    this.cursor = 0; this.emission = 0;this.emitCarry.fill(0);
    this.sprayLife.fill(0); this.sprayAlpha.fill(0);
    this.geometry.attributes.aStrength.array.fill(0);
    this.geometry.attributes.aStrength.needsUpdate = true;
    this.geometry.setDrawRange(0, 0);
    this.drops.geometry.attributes.aAlpha.needsUpdate = true;
  }
  resize(height, ratio) { this.sprayUniforms.uHeight.value = height; this.sprayUniforms.uPixelRatio.value = ratio; }

  section(index, x, z, nx, nz, width, strength, age = 0, lift = 0) {
    const a = this.geometry.attributes;
    for (let lane = 0; lane < 3; lane++) {
      const across = lane - 1, vertex = index * 3 + lane;
      a.position.array[vertex * 3] = x + nx * width * across;
      a.position.array[vertex * 3 + 2] = z + nz * width * across;
      a.aAcross.array[vertex] = across;
      a.aAge.array[vertex] = Math.min(1, age); // normalized lifetime, before fractional exponent
      a.aStrength.array[vertex] = Math.min(1, strength);
      a.aLift.array[vertex] = lift;
    }
  }

  drawChannels(activeSections) {
    const attribute = this.geometry.index, indices = attribute.array;
    let cursor = 0;
    activeSections.forEach((sections, channel) => {
      for (let i = 0; i < sections - 1; i++) for (let lane = 0; lane < 2; lane++) {
        const a = (this.offsets[channel] + i) * 3 + lane, b = a + 3;
        for (const vertex of [a, b, a + 1, a + 1, b, b + 1]) indices[cursor++] = vertex;
      }
    });
    attribute.needsUpdate = true;
    this.geometry.setDrawRange(0, cursor);
  }

  update(time, dt, field, ship, physics) {
    const {velocity,throttle,slam,omega}=physics;
    const shaftCount=this.vessel.propulsion.shafts.length,historyOffset=this.sides.length+shaftCount;
    applyWaveUniforms(this.uniforms, field);
    _forward.set(1, 0, 0).applyQuaternion(ship.quaternion).setY(0).normalize();
    _side.set(-_forward.z, 0, _forward.x);
    const forwardSpeed = velocity.dot(_forward);
    const speed = Math.abs(forwardSpeed), level = Math.min(1, speed / 16);
    this.geometry.attributes.aStrength.array.fill(0);
    this.propLevel += (Math.max(0, throttle) - this.propLevel) * (1 - Math.exp(-dt / 1.8));

    // Hull shoulders use the same loft normals as geometry and hydro patches.
    this.sides.forEach((points, channel) => points.forEach((p, i) => {
      const fore = Math.max(0, p.x / (this.vessel.length / 2));
      _world.set(p.x, p.y, p.z).applyQuaternion(ship.quaternion).add(ship.position);
      _normal.set(p.nx, 0, p.nz).applyQuaternion(ship.quaternion).setY(0).normalize();
      const width = 0.35 + level * (1.8 + fore * 4.4);
      this.section(this.offsets[channel] + i, _world.x + _normal.x * width * 0.55, _world.z + _normal.z * width * 0.55,
        _normal.x, _normal.z, width * 0.7, level * (0.45 + fore * 0.75) + slam * 0.4, 0, fore * level * 0.65);
    }));

    // Four shafts. Churn appears as the engines spool, before appreciable way.
    this.vessel.propulsion.shafts.forEach((shaft, channel) => {
      const z=shaft.position[2];
      for (let i = 0; i < 32; i++) {
        const t = i / 31;
        _world.set(-this.vessel.length / 2 - this.vessel.beamWater*.05 - t*this.vessel.length*.307, 0, z).applyQuaternion(ship.quaternion).add(ship.position);
        this.section(this.offsets[channel + this.sides.length] + i, _world.x, _world.z, _side.x, _side.z,
          shaft.radius * (.9+t*2.03), this.propLevel * (0.98 - t * 0.62), t * 0.75, this.propLevel * (1 - t) * 0.34);
      }
    });

    this.sampleClock += dt;
    if (this.sampleClock >= INTERVAL && speed > 0.3) {
      this.sampleClock %= INTERVAL;
      _world.set(-Math.sign(forwardSpeed) * this.vessel.length / 2, 0, 0).applyQuaternion(ship.quaternion).add(ship.position);
      this.history.push({ x: _world.x, z: _world.z, sx: _side.x, sz: _side.z, speed, time });
    }
    this.history = this.history.filter(p => time - p.time < LIFE).slice(-this.historyLimit);
    this.history.forEach((p, i) => {
      const elapsed = time - p.time, strength = Math.min(1, p.speed / 11), age = elapsed / LIFE;
      this.section(this.offsets[historyOffset] + i, p.x, p.z, p.sx, p.sz, this.vessel.beamWater*.247 + elapsed * 0.6, strength * 0.8, age);
      for (const [channel, side] of [[historyOffset+1, -1], [historyOffset+2, 1]]) {
        const spread = this.vessel.beamWater * 0.35 + elapsed * p.speed * KELVIN_SLOPE;
        this.section(this.offsets[channel] + i, p.x + p.sx * spread * side, p.z + p.sz * spread * side,
          p.sx, p.sz, 1.2 + elapsed * 0.15, strength * 0.65, age, strength * (1 - age) * 0.2);
      }
    });
    this.drawChannels([...this.channels.slice(0, historyOffset), ...Array(3).fill(this.history.length)]);
    for (const attribute of Object.values(this.geometry.attributes)) attribute.needsUpdate = true;

    // Intersect the actual tilted hull loft with the shared sea. No spray
    // emitter exists where the whole section is dry or completely submerged.
    this.spraySources.forEach((p,sourceIndex)=>{
      const contact=u=>p.point(p.t,u,p.side,this.contact).applyQuaternion(ship.quaternion).add(ship.position);
      let low=0,high=1;
      contact(low);const bottom=this.contact.y-field.heightAt(this.contact.x,this.contact.z);
      contact(high);const top=this.contact.y-field.heightAt(this.contact.x,this.contact.z);
      if(bottom>0 || top<0){this.emitCarry[sourceIndex]=0;return;}
      for(let k=0;k<8;k++){
        const u=(low+high)/2;contact(u);
        if(this.contact.y>field.heightAt(this.contact.x,this.contact.z))high=u;else low=u;
      }
      contact((low+high)/2);field.sampleWorld(this.contact.x,this.contact.z,this.waterSample);
      _normal.set(p.nx,0,p.nz).applyQuaternion(ship.quaternion).setY(0).normalize();
      this.pointVelocity.copy(this.contact).sub(physics.position).crossVectors(omega,this.pointVelocity).add(velocity);
      this.relative.copy(this.pointVelocity).sub(_world.set(this.waterSample.vx,this.waterSample.vy,this.waterSample.vz));
      const closing=Math.max(0,this.relative.dot(_normal));
      const impact=Math.max(0,this.waterSample.vy-this.pointVelocity.y);
      const energy=closing*closing*.9+impact*impact*1.5;
      this.emitCarry[sourceIndex]+=(energy*1.3+slam*18)*dt;
      const count=Math.floor(this.emitCarry[sourceIndex]);this.emitCarry[sourceIndex]-=count;
      for(let n=0;n<count;n++){
        const outward=1.6+closing*(.28+Math.random()*.28)+impact*.32;
        const up=1.4+closing*(.13+Math.random()*.34)+impact*(.25+Math.random()*.5);
        const i=this.cursor;this.cursor=(i+1)%this.capacity;
        const j=i*3;
        this.sprayPosition[j]=this.contact.x+_normal.x*(.6+Math.random());
        this.sprayPosition[j+2]=this.contact.z+_normal.z*(.6+Math.random());
        this.sprayPosition[j+1]=field.heightAt(this.sprayPosition[j],this.sprayPosition[j+2])+.16;
        this.sprayVelocity[j]=this.pointVelocity.x*.45+_normal.x*outward;
        this.sprayVelocity[j+1]=up;
        this.sprayVelocity[j+2]=this.pointVelocity.z*.45+_normal.z*outward;
        this.sprayLife[i]=this.sprayDuration[i]=2*up/9.81+1.2;
        this.spraySize[i]=.23+Math.random()**2*1.0+Math.min(1,impact/12)*.45;
      }
    });
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      this.sprayLife[i] = Math.max(0, this.sprayLife[i] - dt);
      if (this.sprayLife[i] > 0) {
        const j = i * 3, drag = Math.exp(-dt * 0.65);
        this.sprayVelocity[j] *= drag; this.sprayVelocity[j + 2] *= drag;
        const vy=this.sprayVelocity[j+1];
        this.sprayVelocity[j+1]-=9.81*dt;
        this.sprayPosition[j]+=this.sprayVelocity[j]*dt;
        this.sprayPosition[j+2]+=this.sprayVelocity[j+2]*dt;
        this.sprayPosition[j+1]+=vy*dt-.5*9.81*dt*dt;
        if (this.sprayPosition[j + 1] < field.heightAt(this.sprayPosition[j], this.sprayPosition[j + 2])) this.sprayLife[i] = 0;
        this.sprayAlpha[i] = Math.min(1,this.sprayLife[i]/.5) * (this.sprayLife[i]>0?1:0);
        alive += this.sprayLife[i] > 0 ? 1 : 0;
      } else this.sprayAlpha[i] = 0;
    }
    this.alive = alive;
    for (const attribute of Object.values(this.drops.geometry.attributes)) attribute.needsUpdate = true;
  }
}
