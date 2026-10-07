import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildHull } from '../src/ship.js';
import { SHIP, LAYOUT, LANDING_FRAME, deckHalfWidth } from '../src/carrier-layout.js';

for (const [stations, ring] of [[8, 4], [80, 18], [160, 32]]) {
  const hull = buildHull(new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial(), stations, ring);
  const edges = new Map(); let triangles = 0;
  const vertexKey = (p, i) => [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e5)).join(',');
  hull.traverse(mesh => {
    if (!mesh.isMesh) return;
    const p = mesh.geometry.attributes.position, ids = mesh.geometry.index.array;
    assert.ok([...p.array].every(Number.isFinite));
    for (let i = 0; i < ids.length; i += 3) {
      triangles++;
      for (let k = 0; k < 3; k++) {
        const a = vertexKey(p, ids[i+k]), b = vertexKey(p, ids[i+(k+1)%3]);
        assert.notEqual(a, b, 'degenerate hull edge');
        const id = [a,b].sort().join('|'), edge = edges.get(id) || [0,0];
        edge[0]++; edge[1] += a < b ? 1 : -1; edges.set(id, edge);
      }
    }
  });
  for (const edge of edges.values()) assert.deepEqual(edge, [2,0], 'closed, consistently oriented hull');
  hull.updateMatrixWorld(true);
  for (const sign of [-1,1]) for (const y of [1,8,17]) {
    const hits = new THREE.Raycaster(new THREE.Vector3(sign*(SHIP.length/2+20),y,0),new THREE.Vector3(-sign,0,0)).intersectObject(hull,true);
    assert.ok(hits.length && Math.abs(hits[0].point.x-sign*SHIP.length/2)<1e-5, 'visible end cap');
  }
  console.log({ stations, ring, triangles, edges: edges.size, openEdges: 0, reversedEdges: 0, endRays: 6 });
}
const inside = ([x,z]) => x >= -SHIP.length/2-1e-8 && x <= SHIP.length/2+1e-8 && z <= deckHalfWidth(x,1)+1e-8 && z >= -deckHalfWidth(x,-1)-1e-8;
for (const e of LAYOUT.elevators) for (const sx of [-1,1]) for (const sz of [-1,1])
  assert.ok(inside([e.x+sx*e.length/2,e.z+sz*e.width/2]), 'flush elevator lies on deck');
for (const cat of LAYOUT.catapults) { assert.ok(inside(cat.start)); assert.ok(inside(cat.end)); }
for (let i=0;i<=100;i++) for (const sign of [-1,1]) {
  const {start,end,width}=LAYOUT.landing, f=i/100, n=LANDING_FRAME.normal;
  assert.ok(inside([start[0]+(end[0]-start[0])*f+n[0]*width/2*sign,start[1]+(end[1]-start[1])*f+n[1]*width/2*sign]), 'landing strip lies on deck');
}
console.log({ deckMaximumBeam: SHIP.deckHalfWidth*2, landingDegrees: Math.atan2(-LANDING_FRAME.tangent[1],LANDING_FRAME.tangent[0])*180/Math.PI, elevators: LAYOUT.elevators.length });
