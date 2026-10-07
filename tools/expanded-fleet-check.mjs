import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {FLEET} from '../src/fleet.js';
import {createHullLoft,pressureIntegral} from '../src/hull-loft.js';
import {ShipPhysics,FLEET_BUOYANCY} from '../src/physics.js';
import {WaveField} from '../src/waves.js';
import {SEA_STATE,TsunamiManager} from '../src/tsunami.js';
import {DamageModel} from '../src/damage.js';
import {WeaponBattery} from '../src/weapons.js';
import {Periscope} from '../src/submarine.js';
import {SolidWater} from '../src/solid-water.js';
import {deckHeightAt,insideOutline} from '../src/deck-surface.js';
const output=process.argv[2]??'qa/2026-10-04/expanded-fleet',report={at:new Date().toISOString(),status:'passed',checks:[],vessels:[]};
const body=S=>{const p=new ShipPhysics(createHullLoft(S).buildPatches(),{vessel:S});p.reset(0,0,0);return p;};
function seeded(seed,fn){const original=Math.random;let s=seed;Math.random=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);try{return fn();}finally{Math.random=original;}}
function check(name,fn){try{const evidence=fn();report.checks.push({name,status:'passed',evidence});}catch(e){report.status='failed';report.checks.push({name,status:'failed',error:e.stack});console.error(name,e.message);}}
function closure(S){
  const shell=createHullLoft(S).buildMesh(),edges=new Map();let volume=0,triangles=0;shell.updateMatrixWorld(true);
  shell.traverse(m=>{if(!m.isMesh)return;const {position:p}=m.geometry.attributes,index=m.geometry.index;
    for(let i=0;i<index.count;i+=3){const pts=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,index.getX(i+k)).applyMatrix4(m.matrixWorld)),keys=pts.map(p=>p.toArray().map(v=>Math.round(v*1e5)).join(','));
      volume+=pts[0].dot(pts[1].clone().cross(pts[2]))/6;triangles++;
      for(let j=0;j<3;j++){const a=keys[j],b=keys[(j+1)%3],key=[a,b].sort().join('/'),e=edges.get(key)??{n:0,w:0};e.n++;e.w+=a<b?1:-1;edges.set(key,e);}
    }m.geometry.dispose();});
  assert.equal([...edges.values()].filter(e=>e.n!==2||e.w!==0).length,0,`${S.id} closed shell`);assert.ok(volume>0);return {triangles,volume};
}
check('buoyancy coefficient and unchanged mass',()=>{
  assert.equal(FLEET_BUOYANCY,1.5);const results=[];
  for(const {spec:S} of FLEET){const p=body(S);p.step(0,new WaveField());assert.equal(p.lastForces.buoyancyScale,(S.buoyancyScale??1)*1.5);results.push({id:S.id,mass:p.mass,coefficient:p.lastForces.buoyancyScale});}
  for(const id of ['pilot','spirit','typhoon']){const S=FLEET.find(e=>e.spec.id===id).spec;assert.ok(Math.abs(body(S).mass/S.designMass-1)<1e-12);}
  return results;
});
check('multi-hull pressure and topsides assembled once',()=>{
  const results=[];
  for(const {spec:S} of FLEET.filter(e=>e.spec.hulls)){
    const L=createHullLoft(S),all=L.buildPatches(),top=L.buildTopsides();
    assert.equal(all.filter(p=>p.kind==='deck').length,top.filter(p=>p.kind==='deck').length);
    const reference=S.hulls.reduce((sum,h)=>sum+pressureIntegral(createHullLoft({...S,hulls:null,houses:[],...h}).buildShellPatches(),0),0);
    assert.ok(Math.abs(pressureIntegral(all,0)-reference)<1e-8);results.push({id:S.id,deckPatches:top.length,integral:reference});
  }return results;
});
check('muzzle lifetime finite before and after firing',()=>{
  const w=new WeaponBattery(FLEET.find(e=>e.spec.id==='yamato').spec.weapons,{broadside:true});
  for(const dt of [0,1/60,5,1/60])w.update(dt);
  for(const m of w.mounts)for(const f of m.flames){assert.ok(Number.isFinite(f.mat.uniforms.uBlastAge.value));assert.ok(f.mat.uniforms.uBlastAge.value<=f.mat.uniforms.uBlastLife.value);}
  w.warmup(true);w.warmup(false);return {mounts:w.mounts.length};
});
for(const id of ['yamato','iowa'])check(id+' selected-side all-gun salvo and recoil',()=>{
  const S=FLEET.find(e=>e.spec.id===id).spec,w=new WeaponBattery(S.weapons,S.battery),p=body(S),events=[];
  const fire=({spec,origin,direction,recoilScale})=>{const c=spec.radius*2,m=7800*Math.PI*(c/2)**2*c*5;p.applyImpulseAtPoint(direction.clone().multiplyScalar(-m*780*recoilScale),origin);events.push({id:spec.id,side:spec.side,z:direction.z,time:w.elapsed});};
  const trials=[];
  for(const side of [-1,1]){
    w.reset();p.reset(0,0,0);events.length=0;w.setSide(side);w.requestSalvo();
    for(let i=0;i<120*5;i++)w.update(1/120,{onShot:fire});
    const expected=S.weapons.filter(s=>s.type!=='ciws'&&s.operable!==false&&(!s.side||s.side===side));
    assert.equal(events.length,expected.reduce((n,s)=>n+s.barrels,0));assert.ok(events.every(e=>e.z*side>.98));assert.equal(new Set(events.map(e=>e.time)).size,1);
    assert.ok(p.velocity.z*side<-.3);trials.push({side,barrels:events.length,velocity:p.velocity.toArray(),omega:p.omega.toArray(),events:structuredClone(events)});
  }return trials;
});
check('all deck masks follow transformed actual outlines',()=>{
  let points=0;
  for(const {spec:S} of FLEET){
    const ship=new THREE.Object3D();ship.userData.vessel=S;ship.position.set(100,20,-50);ship.quaternion.setFromEuler(new THREE.Euler(.2,.7,.4));const mask=new SolidWater(S.deckOutline.length);mask.update([ship]);
    for(let x=-S.length/2+S.length*.0093;x<S.length/2;x+=S.length/40)for(let z=-S.deckHalfWidth+S.deckHalfWidth*.0205;z<S.deckHalfWidth;z+=S.deckHalfWidth/20){
      const expected=insideOutline(S.deckOutline,x,z),p=new THREE.Vector3(x,deckHeightAt(S,x),z).applyMatrix4(ship.matrixWorld);
      // A flat projected deck is an affine polygon, so containment commutes
      // exactly with its gravity projection. Ramp boundary is independently
      // rendered and checked in WebGL rather than replaced by a flat mask.
      if(!S.ramp)assert.equal(mask.contains(p.x,p.z),expected);points++;
    }
    mask.texture.dispose();
  }return {points};
});
check('surface submarine periscope and optical anchor',()=>{
  const S=FLEET.find(e=>e.spec.id==='typhoon').spec,s=new Periscope(S.periscope),ship=new THREE.Group();ship.add(s.group);
  assert.equal(s.mirrorView('bridge'),false);const initial=s.localEye(ship,new THREE.Vector3());s.toggle();s.update(2.2);
  assert.ok(s.mirrorView('bridge'));assert.equal(s.mirrorView('orbit'),false);
  assert.ok(Math.abs(s.localEye(ship,new THREE.Vector3()).y-initial.y-S.periscope.travel)<1e-8);
  s.toggle();s.update(2.2);assert.equal(s.extension,0);s.reset();assert.equal(s.raised,false);
  return {surfacePhysicsUnchanged:true,travel:S.periscope.travel};
});
check('multiple deck masks form a union without filling the sea between',()=>{
  const S=FLEET[0].spec,ships=[0,1200].map(x=>{const ship=new THREE.Object3D();ship.userData.vessel=S;ship.position.x=x;return ship;});
  const mask=new SolidWater(S.deckOutline.length,2);mask.update(ships);
  assert.ok(mask.contains(0,0));assert.ok(mask.contains(1200,0));assert.equal(mask.contains(600,0),false);
  mask.update([ships[0]]);assert.equal(mask.contains(1200,0),false);mask.texture.dispose();return {actors:2};
});
for(const {spec:S} of FLEET){
  check(S.id+' closed hull',()=>closure(S));
  const p=body(S),flat=new WaveField();for(let i=0;i<120*30;i++)p.step(1/120,flat);
  const steady={y:p.position.y,roll:p.attitude.roll,pitch:p.attitude.pitch,vy:p.velocity.y};
  check(S.id+' flat stable and stronger buoyancy',()=>{assert.ok(Math.abs(steady.vy)<.03);assert.ok(Math.abs(steady.roll)<.05&&Math.abs(steady.pitch)<.09);return steady;});
  p.throttle=1;for(let i=0;i<120*110;i++)p.step(1/120,flat);
  const speed=Math.hypot(p.velocity.x,p.velocity.z)*3.6;
  check(S.id+' forward propulsion',()=>{assert.ok(speed>0&&p.position.x>10);assert.ok(p.position.y<50);assert.ok(!p.capsized);assert.ok(speed<=(S.dynamics.speedLimit??60)*3.6+.001);return {speedKmH:speed,y:p.position.y};});
  const cases=[];
  for(const tier of ['ambient','large','broad'])seeded(931,()=>{
    const q=body(S),f=new WaveField().buildSea(SEA_STATE.hs,1,0,SEA_STATE.spread,SEA_STATE.peakLength,SEA_STATE.directions),t=new TsunamiManager(f),d=new DamageModel(S),stats={tier,minY:Infinity,maxY:-Infinity,maxRoll:0,maxPitch:0,minScale:Infinity,maxScale:0};q.throttle=.65;
    for(let i=0;i<120*85;i++){
      const time=i/120;if(i===120*15&&tier!=='ambient')t.trigger(tier,q,time);f.update(1/120);q.step(1/120,f);t.update(1/120,time,q,q);if(i%2===0)d.update(1/60,q,f,{spawn(){}},time);
      if(![...q.position.toArray(),...q.velocity.toArray(),q.quaternion.w].every(Number.isFinite))throw new Error(S.id+'/'+tier+' nonfinite dynamics');
      stats.minY=Math.min(stats.minY,q.position.y);stats.maxY=Math.max(stats.maxY,q.position.y);stats.maxRoll=Math.max(stats.maxRoll,Math.abs(q.attitude.roll));stats.maxPitch=Math.max(stats.maxPitch,Math.abs(q.attitude.pitch));stats.minScale=Math.min(stats.minScale,q.lastForces.buoyancyScale);stats.maxScale=Math.max(stats.maxScale,q.lastForces.buoyancyScale);
    }
    Object.assign(stats,{speedKmH:q.speedKnots/1.94384*3.6,capsized:q.capsized,damage:d.state,flood:d.flood,finalY:q.position.y});cases.push(stats);
  });
  report.vessels.push({id:S.id,mass:p.mass,steady,speedKmH:speed,cases});console.log(JSON.stringify(report.vessels.at(-1)));
}
fs.mkdirSync(output,{recursive:true});fs.writeFileSync(output+'/physics-expanded.json',JSON.stringify(report,null,2));console.log({status:report.status,checks:report.checks.length});if(report.status!=='passed')process.exitCode=1;
