/** Mathematical / scheduler gates for the current random-sea candidate.
 * Uses production generators; independent finite differences, geometric
 * intersection identities and ballistic endpoints are the reference. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {WaveField,WavePacket,G} from '../src/waves.js';
import {Meteors,meteorWave} from '../src/meteors.js';
import {Tracers,TRACER,interceptPoint,relativeHit} from '../src/projectiles.js';
import {RandomSea} from '../src/random-sea.js';
import {SEA_STATE,TsunamiManager} from '../src/tsunami.js';
import {PILOT} from '../src/new-vessel-layout.js';
import {createHullLoft} from '../src/hull-loft.js';
import {ShipPhysics} from '../src/physics.js';
import {DamageModel} from '../src/damage.js';
const output=process.env.BOAT_QA_OUTPUT??'qa/2026-10-04/random-sea';
const report={at:new Date().toISOString(),checks:[],hashes:Object.fromEntries(['waves','meteors','projectiles','random-sea','weapons','physics'].map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(`src/${n}.js`)).digest('hex')]))};
const note=(name,data)=>{report.checks.push({name,...data});console.log(name,JSON.stringify(data));};
function seeded(seed,fn){const prev=Math.random;let s=seed;Math.random=()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);try{return fn();}finally{Math.random=prev;}}
const vector=(x,y,z)=>new THREE.Vector3(x,y,z),silent={spawn(){}};
function ringChecks(){
  let normalError=0,velocityError=0,inverseError=0,rotationError=0,samples=0;
  for(const height of [20,60,100])seeded(931,()=>{
    const f=new WaveField().buildSea(SEA_STATE.hs,1,0,SEA_STATE.spread,SEA_STATE.peakLength,SEA_STATE.directions),tier=meteorWave(height);
    f.replacePackets(Array.from({length:3},(_,i)=>({kind:'radial',x:-123,z:219,dirX:1,dirZ:0,height:height*tier.decay**i,thickness:tier.thickness,lateralWidth:tier.lateralWidth,speed:tier.speed,delay:i*tier.spacing/tier.speed})));
    for(const time of [-.01,0,.001,.7,1,2,11,26,39])for(let a=0;a<8;a++)for(const u of [-1,-.6,0,.5,1,1.25,1.7]){
      f.time=time;const p=f.packets[0],radius=Math.max(0,p.trailingExtent+p.speed*time-u*p.width),angle=a*Math.PI/4;
      const x=p.x+radius*Math.cos(angle),z=p.z+radius*Math.sin(angle),s=f.sampleBase(x,z,{}),eps=1e-4;
      const px=f.sampleBase(x+eps,z,{}),mx=f.sampleBase(x-eps,z,{}),pz=f.sampleBase(x,z+eps,{}),mz=f.sampleBase(x,z-eps,{});
      const n=vector(pz.x-mz.x,pz.y-mz.y,pz.z-mz.z).cross(vector(px.x-mx.x,px.y-mx.y,px.z-mx.z)).normalize();
      normalError=Math.max(normalError,n.distanceTo(vector(s.nx,s.ny,s.nz)));
      f.time=time+eps;const plus=f.sampleBase(x,z,{});f.time=time-eps;const minus=f.sampleBase(x,z,{});f.time=time;
      for(const axis of ['x','y','z'])velocityError=Math.max(velocityError,Math.abs((plus[axis]-minus[axis])/(2*eps)-s['v'+axis]));
      const inv=f.sampleWorld(s.x,s.z,{});inverseError=Math.max(inverseError,Math.abs(inv.y-s.y),Math.hypot(inv.x-s.x,inv.z-s.z));
      const pulse=p.sample(x,z,time,{}),rotated=p.sample(p.x+radius,p.z,time,{});
      rotationError=Math.max(rotationError,Math.abs(pulse.y-rotated.y),Math.abs(pulse.vy-rotated.vy));
      assert.ok(Object.values(s).every(Number.isFinite));samples++;
    }
    for(const p of f.packets){assert.equal(p.sample(p.x,p.z,p.t0,{}).y,0);assert.equal(p.sample(p.x+p.trailingExtent,p.z,p.t0,{}).vy,0);assert.equal(p.sample(p.x+p.trailingExtent,p.z,p.t0-.001,{}).y,0);}
  });
  assert.ok(normalError<1e-6&&velocityError<1e-5&&inverseError<2e-4&&rotationError<1e-9);
  note('ring surface finite differences / inverse / rotation',{samples,normalError,velocityError,inverseError,rotationError});
}
function projectileChecks(){
  let aimError=0;
  seeded(61,()=>{for(let i=0;i<250;i++){
    const origin=vector(10,25,-3),target={position:vector(20+Math.random()*1000,80+Math.random()*800,-300+Math.random()*600),velocity:vector(-80+Math.random()*160,-200+Math.random()*260,-80+Math.random()*160)};
    const aim=interceptPoint(origin,target,new THREE.Vector3()),time=aim.distanceTo(origin)/TRACER.speed;
    const bullet=origin.clone().addScaledVector(aim.clone().sub(origin).normalize(),TRACER.speed*time);bullet.y-=.5*G*time*time;
    const rock=target.position.clone().addScaledVector(target.velocity,time);rock.y-=.5*G*time*time;
    aimError=Math.max(aimError,bullet.distanceTo(rock));
  }});
  assert.ok(aimError<1e-9);
  const rock={previous:vector(0,100,0),position:vector(0,100,0),radius:1,active:true};
  assert.equal(relativeHit(vector(-10,100,0),vector(10,100,0),rock),.45);
  assert.equal(relativeHit(vector(-10,100,2),vector(10,100,2),rock),null);
  assert.equal(relativeHit(vector(0,100,0),vector(10,100,0),rock),0);
  assert.equal(relativeHit(vector(10,100,0),vector(20,100,0),rock),null);
  const dt=.02,field={heightAt:()=>-1000},spec=[{type:'ciws',cooldown:.1}];
  function timeline(reverse=false,impactFraction=1){
    const t=new Tracers(spec),r={...rock,previous:rock.previous.clone(),position:rock.position.clone(),impactFraction};
    t.spawn(vector(-10,100,0),vector(1,0,0));t.spawn(vector(-5,100,0),vector(1,0,0));
    if(reverse)t.bullets.reverse();
    const hits=[];t.update(dt,1,[r],(r,p)=>{r.active=false;hits.push(p.toArray());},field);
    const survivor=t.bullets[0].previous.x;t.geometry.dispose();t.material.dispose();return {hits,survivor};
  }
  const a=timeline(),b=timeline(true),late=timeline(false,.1);
  assert.equal(a.hits.length,1);assert.deepEqual(a,b);assert.equal(a.survivor,-10);assert.equal(late.hits.length,0);
  const firstEntry=new Tracers(spec),r={...rock,impactFraction:.46};firstEntry.spawn(vector(-10,100,0),vector(1,0,0));
  let firstCount=0;firstEntry.update(20/TRACER.speed,1,[r],r=>{r.active=false;firstCount++;},field);assert.equal(firstCount,1);
  note('equal-gravity aiming / first entry / chronological resolution',{aimSamples:250,aimError,firstEntryBeforeHull:firstCount,orderIndependent:a,afterHull:late.hits.length});
}
function meteorChecks(){
  const m=new Meteors(),start=vector(-900,1800,123),end=vector(177,0,-97),T=14,rock=m.add('main',start,end,T,15,60),velocity=rock.velocity.clone();
  const endpoint=start.clone().addScaledVector(velocity,T);endpoint.y-=.5*G*T*T;assert.ok(endpoint.distanceTo(end)<1e-9);
  const field=new WaveField(),shell=new THREE.Group();let mainEvents=0,contact;
  for(let i=0;i<Math.ceil((T+1)*60);i++){
    m.prepare(1/60,field,shell);m.resolve({onSea:(r,p)=>{mainEvents++;contact=p.toArray();},onHull:()=>assert.fail('empty hull'),particles:silent,time:i/60});
  }
  assert.equal(mainEvents,1);assert.ok(vector(...contact).distanceTo(end)<.02);assert.equal(m.active,false);
  const inside=m.add('fragment',vector(0,-5,0),vector(1,-10,0),1,1);m.prepare(1/60,field,shell);assert.equal(inside.impactFraction,0);
  m.reset();assert.equal(m.fragments.length,0);assert.equal(m.stones.count,0);
  note('meteor endpoint / sea contact / reset',{duration:T,endpointError:endpoint.distanceTo(end),mainEvents,seaContact:contact});
}
function scheduleChecks(){
  const phases=[],distribution=[];
  seeded(931,()=>{
    const s=new RandomSea(),tsunami={state:'idle',triggerSpec(){}},meteor={active:false,launch:(ship,height)=>({height})};
    const before={night:s.nightTarget,deadline:s.nextPhaseAt,event:s.nextEventAt};
    for(let i=0;i<100;i++)s.update(0,{},tsunami,meteor);
    assert.equal(s.events,0);assert.equal(s.nightTarget,before.night);assert.equal(s.nextPhaseAt,before.deadline);
    for(let i=0;i<20;i++){const deadline=s.nextPhaseAt,phase=s.nightTarget;s.update(deadline,{},tsunami,meteor);assert.equal(s.nightTarget,1-phase);phases.push(s.nextPhaseAt-deadline);}
    for(const night of [0,1]){
      const q=new RandomSea();q.nightTarget=night;q.nextPhaseAt=Infinity;let count=0,minHeight=Infinity,maxHeight=0;
      for(let i=0;i<1000;i++){const event=q.update(q.nextEventAt,{},tsunami,meteor).event;count+=event.kind==='meteor';if(event.kind==='meteor'){minHeight=Math.min(minHeight,event.height);maxHeight=Math.max(maxHeight,event.height);}else assert.ok(event.height>=6&&event.height<=30);}
      distribution.push({night,meteorCount:count,trials:1000,minHeight,maxHeight});
      assert.ok(night?count>800&&count<950:count>50&&count<200);assert.ok(minHeight>=20&&maxHeight<=100);
    }
    const q=new RandomSea();q.nextPhaseAt=Infinity;tsunami.state='active';assert.equal(q.update(100,{},tsunami,meteor).event,null);tsunami.state='idle';meteor.active=true;assert.equal(q.update(100,{},tsunami,meteor).event,null);meteor.active=false;assert.ok(q.update(100,{},tsunami,meteor).event);assert.equal(q.update(100,{},tsunami,meteor).event,null);
  });
  assert.ok(phases.every(d=>d>=45&&d<=95));
  note('simulation-clock scheduling / random day-night distribution',{phaseDurations:phases,distribution,noOverlappingEvents:true});
}
function pilotChecks(){
  const cases=[];
  for(const height of [20,60,100])seeded(137,()=>{
    const field=new WaveField().buildSea(SEA_STATE.hs,1,0,SEA_STATE.spread,SEA_STATE.peakLength,SEA_STATE.directions),p=new ShipPhysics(createHullLoft(PILOT).buildPatches(),{vessel:PILOT}),t=new TsunamiManager(field),d=new DamageModel(PILOT);p.reset(0,0,0);p.throttle=.6;
    const tier=meteorWave(height);t.triggerSpec(tier,p,0,{height,epicentre:vector(1000,0,0)});
    const stats={height,minY:Infinity,maxY:-Infinity,minScale:Infinity,maxScale:0};
    for(let i=0;i<120*130;i++){
      field.update(1/120);p.step(1/120,field);t.update(1/120,field.time,p,p);
      if(i%2===0)d.update(1/60,p,field,silent,field.time);
      assert.ok([...p.position.toArray(),...p.velocity.toArray(),...p.omega.toArray(),p.quaternion.w].every(Number.isFinite));
      stats.minY=Math.min(stats.minY,p.position.y);stats.maxY=Math.max(stats.maxY,p.position.y);stats.minScale=Math.min(stats.minScale,p.lastForces.buoyancyScale);stats.maxScale=Math.max(stats.maxScale,p.lastForces.buoyancyScale);
    }
    Object.assign(stats,{state:d.state,flood:d.flood,integrity:d.integrity,finalY:p.position.y,event:t.state});
    assert.ok(stats.minScale>=4.5&&stats.maxScale<=9);assert.equal(d.state,'ok');assert.equal(t.state,'idle');assert.ok(p.position.y>-10);
    if(height===20)assert.equal(stats.maxScale,4.5);else assert.ok(stats.maxScale>8.99);
    cases.push(stats);
  });
  note('pilot ring encounters / 4.5-to-9 buoyancy / recovery',{secondsPerCase:130,cases});
}
try{ringChecks();projectileChecks();meteorChecks();scheduleChecks();pilotChecks();report.status='passed';}
catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1;}
finally{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(output+'/random-math.json',JSON.stringify(report,null,2)+'\n');}
