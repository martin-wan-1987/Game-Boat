/**
 * crew.js — the flight-deck crew, animated.
 *
 * Real deck crews are colour-coded by job, and the deck is never still:
 * people walk between work stations, pause, move on. Each sailor is a tiny
 * articulated figure (torso, head, two legs, two arms) drawn entirely with
 * six InstancedMeshes — one draw call per body part for the whole crew, so
 * 48 walking people cost about nothing.
 *
 * The group is parented to the ship mesh, so everything here is in
 * ship-local metres and the crew heels with the deck.
 */
import * as THREE from 'three';
import { SHIP } from './ship.js';

/* jersey colour code, as on a real CVN:
 * yellow = plane directors, green = catapult & arresting gear,
 * red = crash / ordnance, purple = fuel ("grapes"),
 * blue = chocks & blocks, white = safety / QA / medical */
const JERSEYS = [
  { shirt: 0xe8c222, helmet: 0xe8c222 },   // yellow
  { shirt: 0x37b34a, helmet: 0x37b34a },   // green
  { shirt: 0xd5332f, helmet: 0xd5332f },   // red
  { shirt: 0x8a4fbf, helmet: 0x8a4fbf },   // purple
  { shirt: 0x3679c9, helmet: 0x3679c9 },   // blue
  { shirt: 0xe8e8e8, helmet: 0xe8e8e8 },   // white
];
const PANTS = 0x2a3038;

/* boxes the crew must not walk through (ship-local): the island and the
 * parked aircraft. Rough rectangles are plenty at this scale. */
const BLOCKED = [
  [27, 69, 23, 39],      // island footprint + margin
  // parked air wing
  [86, 106, 18, 39], [86, 106, 15, 39], [70, 90, 14, 26], [70, 90, 27, 39],
  [-60, -40, 26, 38], [-82, -62, 26, 38], [-104, -84, 26, 38],
  [-62, -42, 9, 21], [-84, -64, 9, 21],
  [32, 52, -39, -27], [10, 30, -37, -25],
  [-128, -108, 20, 32], [-150, -130, 20, 32], [-152, -132, 7, 19],
  [-22, -2, 27, 39], [-34, -14, 27, 39],   // helos
];

const inBlocked = (x, z, m = 1.2) => BLOCKED.some(
  ([x0, x1, z0, z1]) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m);

const rand = (a, b) => a + Math.random() * (b - a);

export class DeckCrew {
  constructor(count = 48) {
    this.count = count;
    this.group = new THREE.Group();
    this.group.position.y = SHIP.deckY;

    const mkMat = (color) => new THREE.MeshStandardMaterial({
      color, roughness: 0.85, metalness: 0.02,
    });

    // geometry pivots: legs and arms rotate about their TOP (hip / shoulder)
    const torsoGeo = new THREE.CapsuleGeometry(0.20, 0.52, 4, 8);
    const headGeo = new THREE.SphereGeometry(0.115, 10, 8);
    const legGeo = new THREE.BoxGeometry(0.15, 0.82, 0.19);
    legGeo.translate(0, -0.41, 0);
    const armGeo = new THREE.BoxGeometry(0.10, 0.60, 0.12);
    armGeo.translate(0, -0.30, 0);

    const mkInst = (geo, mat) => {
      const im = new THREE.InstancedMesh(geo, mat, count);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = true;
      im.frustumCulled = false;
      this.group.add(im);
      return im;
    };

    this.torso = mkInst(torsoGeo, mkMat(0xffffff));
    this.head = mkInst(headGeo, mkMat(0xffffff));
    this.legs = [mkInst(legGeo, mkMat(PANTS)), mkInst(legGeo, mkMat(PANTS))];
    this.arms = [mkInst(armGeo, mkMat(0xffffff)), mkInst(armGeo, mkMat(0xffffff))];

    // per-sailour state
    this.people = [];
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const jersey = JERSEYS[i % JERSEYS.length];
      this.torso.setColorAt(i, col.setHex(jersey.shirt));
      this.arms[0].setColorAt(i, col.setHex(jersey.shirt));
      this.arms[1].setColorAt(i, col.setHex(jersey.shirt));
      this.head.setColorAt(i, col.setHex(jersey.helmet));

      let x, z, tries = 0;
      do { x = rand(-148, 158); z = rand(-32, 32); } while (inBlocked(x, z) && ++tries < 40);
      this.people.push({
        x, z,
        tx: x, tz: z,
        heading: rand(0, Math.PI * 2),
        speed: rand(0.9, 1.6),
        phase: rand(0, Math.PI * 2),
        state: 'idle',
        idleT: rand(0, 5),
        // a few stand still near the aircraft doing maintenance forever
        walker: i % 5 !== 4,
      });
    }
    this.torso.instanceColor.needsUpdate = true;
    this.head.instanceColor.needsUpdate = true;
    this.arms[0].instanceColor.needsUpdate = true;
    this.arms[1].instanceColor.needsUpdate = true;

    this._d = new THREE.Object3D();
  }

  _newTarget(p) {
    for (let tries = 0; tries < 30; tries++) {
      const tx = rand(-148, 158), tz = rand(-32, 32);
      if (inBlocked(tx, tz)) continue;
      // bias shortish legs so walks read as work, not migrations
      if (Math.hypot(tx - p.x, tz - p.z) > 110) continue;
      p.tx = tx; p.tz = tz;
      return;
    }
    p.tx = p.x; p.tz = p.z;
  }

  update(dt) {
    const d = this._d;
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];

      if (p.state === 'idle') {
        p.idleT -= dt;
        p.phase += dt * 1.2;                     // weight shift while standing
        if (p.idleT <= 0 && p.walker) {
          this._newTarget(p);
          p.state = 'walk';
        }
      } else {
        const dx = p.tx - p.x, dz = p.tz - p.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.6) {
          p.state = 'idle';
          p.idleT = rand(1.5, 9);
        } else {
          const vx = dx / dist, vz = dz / dist;
          p.x += vx * p.speed * dt;
          p.z += vz * p.speed * dt;
          // ease the heading toward the travel direction
          const want = Math.atan2(-vz, vx);      // ship +x forward, +z stbd
          let da = want - p.heading;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          p.heading += da * Math.min(1, dt * 6);
          p.phase += dt * p.speed * 5.2;         // stride frequency with speed
        }
      }

      const walking = p.state === 'walk';
      const swing = walking ? Math.sin(p.phase) * 0.52 : Math.sin(p.phase * 0.35) * 0.03;
      const bob = walking ? Math.abs(Math.sin(p.phase)) * 0.05 : 0;
      const cosH = Math.cos(p.heading), sinH = Math.sin(p.heading);

      // torso + head (heading rotation only)
      d.rotation.set(0, p.heading, 0);
      d.position.set(p.x, 1.16 + bob, p.z);
      d.updateMatrix();
      this.torso.setMatrixAt(i, d.matrix);
      d.position.set(p.x + sinH * 0.06, 1.60 + bob, p.z + cosH * 0.06);
      d.updateMatrix();
      this.head.setMatrixAt(i, d.matrix);

      // legs: rotate about the hip (ship X axis after heading rotation)
      d.position.set(p.x, 0.86 + bob, p.z);
      d.rotation.set(swing, p.heading, 0);
      d.updateMatrix();
      this.legs[0].setMatrixAt(i, d.matrix);
      d.rotation.set(-swing, p.heading, 0);
      d.updateMatrix();
      this.legs[1].setMatrixAt(i, d.matrix);

      // arms: opposite phase, set slightly out from the shoulders
      const sx = sinH * 0.26, sz = cosH * 0.26;
      d.position.set(p.x - sx, 1.40 + bob, p.z + sz);
      d.rotation.set(-swing * 0.7, p.heading, 0);
      d.updateMatrix();
      this.arms[0].setMatrixAt(i, d.matrix);
      d.position.set(p.x + sx, 1.40 + bob, p.z - sz);
      d.rotation.set(swing * 0.7, p.heading, 0);
      d.updateMatrix();
      this.arms[1].setMatrixAt(i, d.matrix);
    }
    this.torso.instanceMatrix.needsUpdate = true;
    this.head.instanceMatrix.needsUpdate = true;
    for (const im of this.legs) im.instanceMatrix.needsUpdate = true;
    for (const im of this.arms) im.instanceMatrix.needsUpdate = true;
  }
}
