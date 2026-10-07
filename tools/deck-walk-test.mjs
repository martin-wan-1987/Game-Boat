import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SHIP,DECK_BLOCKS} from '../src/carrier-layout.js';
import {deckHalfWidth} from '../src/ship.js';
import {CameraRig} from '../src/camera.js';
import {projectDeckWalk,WALK_INSET} from '../src/deck-walk.js';
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
