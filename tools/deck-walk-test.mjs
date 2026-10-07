import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SHIP,DECK_BLOCKS} from '../src/carrier-layout.js';
import {deckHalfWidth} from '../src/ship.js';
import {CameraRig} from '../src/camera.js';
import {projectDeckWalk,WALK_INSET} from '../src/deck-walk.js';
import {FLEET} from '../src/fleet.js';
import {cameraModes} from '../src/vessel-capabilities.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
function check([x,z]) {
 assert.ok(Number.isFinite(x+z));
 assert.ok(x>=-SHIP.length/2+WALK_INSET.ends-1e-7&&x<=SHIP.length/2-WALK_INSET.ends+1e-7);
 assert.ok(z<=deckHalfWidth(x,1)-WALK_INSET.rail+1e-7&&z>=-deckHalfWidth(x,-1)+WALK_INSET.rail-1e-7);
 for(const [x0,x1,z0,z1] of DECK_BLOCKS)assert.ok(
  x<=x0-WALK_INSET.obstacle+1e-7||x>=x1+WALK_INSET.obstacle-1e-7||
  z<=z0-WALK_INSET.obstacle+1e-7||z>=z1+WALK_INSET.obstacle-1e-7,
  `Inside island exclusion: ${x}, ${z}`);
}
// The corrected outline leaves an outboard corridor. Valid corridor points
// stay fixed; an island-interior point projects to the nearest valid face.
const block=DECK_BLOCKS[0],cx=(block[0]+block[1])/2;
const p=projectDeckWalk(cx,deckHalfWidth(cx,1)-1.3);
near(p[0],cx);near(p[1],deckHalfWidth(cx,1)-1.3);
const q=projectDeckWalk(cx,block[3]-0.2);
near(q[0],cx);near(q[1],block[3]+WALK_INSET.obstacle);
near(projectDeckWalk(40,0)[0],40);near(projectDeckWalk(40,0)[1],0);
let positions=0;
for(let x=-190;x<=190;x+=2)for(let z=-65;z<=65;z++) {check(projectDeckWalk(x,z));positions++;}
// Drive the actual rig against the obstacle, rail and concave port shoulder.
const ship=new THREE.Object3D(),field={heightAt:(x,z)=>5+3*Math.sin(x*.02+z*.03)};
const rig=new CameraRig(new THREE.PerspectiveCamera());rig.setMode('walk');rig.walkRun=true;
for(const start of [[cx,28],[65,-44],[168,0],[-168,-27],[40,0]]) {
 [rig.walkX,rig.walkZ]=start;rig.walkVX=rig.walkVZ=0;
 for(let i=0;i<600;i++) {
  rig.walkYaw=i*.03;rig.walkStep(1/60,new Set(['w','d']),ship,field);
  rig.update(1/60,ship,field,null,0);check([rig.walkX,rig.walkZ]);
  const eye=rig.camera.position;assert.ok(eye.y>=field.heightAt(eye.x,eye.z)+1.2-1e-7);
 }
}
console.log(`${positions} projections and 3000 walking frames pass deck, island and water-clearance checks.`);
// Compare actual camera forward with actual walker velocity in the hull
// frame. This checks the -Z camera/+X vessel boundary independently of the
// camera's Euler expression, including pitched heads and rotated hulls.
let headings=0;const direction=new THREE.Vector3(),velocity=new THREE.Vector3();
for(const {spec} of FLEET.filter(e=>cameraModes(e.spec).includes('walk'))){
 const walker=new CameraRig(new THREE.PerspectiveCamera(),spec);walker.setMode('walk');
 for(const attitude of [[0,0,0],[.42,-.19,.31],[-.36,.23,-.8]]){
  ship.quaternion.setFromEuler(new THREE.Euler(...attitude));const inverse=ship.quaternion.clone().invert();
  for(let i=0;i<128;i++)for(const pitch of [-1.1,0,1.1]){
   walker.walkYaw=-Math.PI+i*Math.PI/64;walker.walkPitch=pitch;walker.walkVX=walker.walkVZ=0;
   walker.walkStep(1/120,new Set(['w']),ship,field);
   walker.camera.getWorldDirection(direction).applyQuaternion(inverse);direction.y=0;direction.normalize();
   velocity.set(walker.walkVX,0,walker.walkVZ).normalize();assert.ok(direction.dot(velocity)>1-1e-10);headings++;
  }
 }
}
console.log(`${headings} actual view/movement heading comparisons pass across all walk-capable vessels.`);
