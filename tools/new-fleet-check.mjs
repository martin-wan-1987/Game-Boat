import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {FLEET} from '../src/fleet.js';
import {createHullLoft,operatingWaterlineY} from '../src/hull-loft.js';
import {ShipPhysics} from '../src/physics.js';
import {WaveField} from '../src/waves.js';
import {TsunamiManager,SEA_STATE} from '../src/tsunami.js';
import {DamageModel} from '../src/damage.js';
const output='qa/2026-10-03/new-fleet',filter=process.argv[2],results=[];
const zero=new THREE.Vector3(),world=new THREE.Vector3();
const body=S=>{const p=new ShipPhysics(createHullLoft(S).buildPatches(),{vessel:S});p.reset(0,0,0);return p;};
function seeded(seed,fn){const prev=Math.random;let s=seed;Math.random=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);try{return fn();}finally{Math.random=prev;}}
function closure(S){
  const shell=createHullLoft(S).buildMesh(),edges=new Map();let volume=0,triangles=0;
  shell.traverse(m=>{if(!m.isMesh)return;const {position:p}=m.geometry.attributes,index=m.geometry.index;
    for(let i=0;i<index.count;i+=3){const pts=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,index.getX(i+k))),keys=pts.map(p=>p.toArray().map(v=>Math.round(v*1e5)).join(','));
      volume+=pts[0].dot(pts[1].clone().cross(pts[2]))/6;triangles++;
      for(let j=0;j<3;j++){const a=keys[j],b=keys[(j+1)%3],key=[a,b].sort().join('/'),e=edges.get(key)??{n:0,w:0};e.n++;e.w+=a<b?1:-1;edges.set(key,e);}
    }m.geometry.dispose();});
  assert.equal([...edges.values()].filter(e=>e.n!==2||e.w!==0).length,0,`${S.id} closed hull`);assert.ok(volume>0);
  return {triangles,volume};
}
for(const {spec:S} of FLEET.filter(e=>!filter||e.spec.id===filter)){
  const p=body(S),mass=p.mass,flat=new WaveField(),shell=closure(S);
  for(let i=0;i<120*35;i++)p.step(1/120,flat);
  const origin=p.localToWorld(zero,new THREE.Vector3()),steady={y:origin.y,roll:p.attitude.roll*180/Math.PI,pitch:p.attitude.pitch*180/Math.PI,vy:p.velocity.y};
  assert.ok(Math.abs(steady.y+operatingWaterlineY(S))<.7,`${S.id} draft balance`);
  assert.ok(Math.abs(steady.roll)<1&&Math.abs(steady.pitch)<4&&Math.abs(steady.vy)<.02,`${S.id} flat equilibrium`);
  p.position.y-=8;p.step(0,flat);const reserve=p.lastForces.buoy/(mass*9.81);
  p.reset(0,0,0);p.throttle=1;for(let i=0;i<120*160;i++)p.step(1/120,flat);
  const speed=p.speedKnots;assert.ok(speed>10&&Number.isFinite(speed),`${S.id} forward propulsion`);
  const cases=[];
  for(const id of ['ambient','large','broad'])seeded(931,()=>{
    const field=new WaveField().buildSea(SEA_STATE.hs,1,0,SEA_STATE.spread,SEA_STATE.peakLength,SEA_STATE.directions),q=body(S),d=new DamageModel(S),t=new TsunamiManager(field);
    const stats={tier:id,minY:Infinity,maxY:-Infinity,maxRoll:0,maxPitch:0,minDeckGap:Infinity};q.throttle=.65;
    for(let i=0;i<120*100;i++){
      const time=i/120;if(i===120*15&&id!=='ambient')t.trigger(id,q,time);
      field.update(1/120);q.step(1/120,field);t.update(1/120,time,q,q);
      if(i%2===0)d.update(1/60,q,field,{spawn(){}},time);
      q.localToWorld(zero,world);stats.minY=Math.min(stats.minY,world.y);stats.maxY=Math.max(stats.maxY,world.y);
      stats.maxRoll=Math.max(stats.maxRoll,Math.abs(q.attitude.roll)*180/Math.PI);stats.maxPitch=Math.max(stats.maxPitch,Math.abs(q.attitude.pitch)*180/Math.PI);
      q.localToWorld(new THREE.Vector3(0,S.deckY,0),world);stats.minDeckGap=Math.min(stats.minDeckGap,world.y-field.heightAt(world.x,world.z));
      assert.ok(q.position.toArray().every(Number.isFinite)&&Number.isFinite(q.quaternion.w),`${S.id}/${id} finite dynamics`);
    }
    Object.assign(stats,{integrity:d.integrity,damage:d.state,flood:d.flood,speed:q.speedKnots,capsized:q.capsized});cases.push(stats);
    assert.ok(!q.capsized,`${S.id}/${id} stays upright`);
  });
  const result={id:S.id,mass,shell,steady,reserve,speed,cases};results.push(result);console.log(JSON.stringify(result));
}
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(`${output}/physics${filter?'-'+filter:''}.json`,JSON.stringify(results,null,2));
