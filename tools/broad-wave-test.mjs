import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { WaveField } from '../src/waves.js';
import { TsunamiManager, TSUNAMI_TIERS } from '../src/tsunami.js';
import { ShipPhysics } from '../src/physics.js';
import { buildPatches } from '../src/ship.js';
import { DamageModel } from '../src/damage.js';

let seed=651030;
Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const near=(a,b,tolerance,message)=>assert.ok(Math.abs(a-b)<tolerance,`${message}: ${a} vs ${b}`);
const dt=1/120, report={profile:[],lifecycles:[],voyages:[]};
const tier=TSUNAMI_TIERS.broad;
// Check analytic normals and vertical velocities against independent finite
// differences, including the joins, arbitrary headings, positions and times.
for(const heading of [0,.73,2.8]) for(const period of [.5,1,2].map(r=>tier.period*r)) {
  const field=new WaveField();
  field.spawnTsunami({x:137,z:-82,dirX:Math.cos(heading),dirZ:Math.sin(heading),shape:tier.shape,height:tier.hMax,period,speed:tier.speed,distance:tier.distance});
  field.time=74;
  let minimum=Infinity,maximum=-Infinity,maxSlope=0;
  for(let i=0;i<=800;i++) {
    const s=(-1.1+2.9*i/800)*field.tsuWidth;
    const x=field.tsuOriginX+(s-field.time*18)*field.tsuDirX;
    const z=field.tsuOriginZ+(s-field.time*18)*field.tsuDirZ;
    const sample=field.sampleBase(x,z,{}),e=.0005;
    const dx=(field.heightAt(x+e,z)-field.heightAt(x-e,z))/(2*e);
    const dz=(field.heightAt(x,z+e)-field.heightAt(x,z-e))/(2*e);
    near(-sample.nx/sample.ny,dx,1e-7,'x slope');
    near(-sample.nz/sample.ny,dz,1e-7,'z slope');
    field.time+=e;const hi=field.heightAt(x,z);field.time-=2*e;const lo=field.heightAt(x,z);field.time+=e;
    near(sample.vy,(hi-lo)/(2*e),3e-6,'water velocity');
    assert.ok(Object.values(sample).every(Number.isFinite));
    minimum=Math.min(minimum,sample.y);maximum=Math.max(maximum,sample.y);maxSlope=Math.max(maxSlope,Math.hypot(dx,dz));
  }
  near(maximum,30,.001,'crest above mean');near(minimum,-1.2,.001,'return trough');
  near(maxSlope,96*30/(25*Math.sqrt(5)*field.tsuWidth),.00001,'analytic maximum slope');
  report.profile.push({heading,period,minimum,maximum,maxSlope});
}
// An event's support, rather than elapsed seconds, determines completion.
// Test every preset with a stationary observer through its entire passage.
for(const id of Object.keys(TSUNAMI_TIERS)) {
  const field=new WaveField(),ship=new ShipPhysics(buildPatches(8,4));
  const manager=new TsunamiManager(field);manager.trigger(id,ship,0);
  const duration=(manager.distanceToCrest(ship.position)+field.trailingExtent+342)/field.tsuSpeed+8;
  if(id==='broad'){
    near(field.tsuWidth*2,210,1e-8,'main wave thickness');
    near(manager.distanceToCrest(ship.position)-manager.hullExtent(ship)-field.leadingExtent,100,1e-8,'front-to-bow clearance');
  }
  const transitions=['inbound'];let previous=manager.state;
  for(let t=0;t<duration;t+=.25){field.update(.25);manager.update(.25,field.time,ship,ship);if(manager.state!==previous){transitions.push(manager.state);previous=manager.state;}}
  assert.deepEqual(transitions,['inbound','active','clearing','idle']);
  assert.equal(field.tsuActive,true,'distant packet remains visible instead of being erased');
  near(field.heightAt(0,0),0,1e-8,'event has fully passed observer');
  report.lifecycles.push({id,duration,transitions});
}
for(const throttle of [0,.5,1]) {
  const field=new WaveField(),ship=new ShipPhysics(buildPatches(26,14));
  const manager=new TsunamiManager(field),damage=new DamageModel();
  ship.throttle=throttle;
  const settled=[];
  for(let i=0;i<12000;i++){field.update(dt);ship.step(dt,field);if(i>=9600)settled.push(ship.position.y);}
  const before=settled.reduce((a,b)=>a+b,0)/settled.length;manager.trigger('broad',ship,field.time);
  const start=field.time,rows=[];let maxStep=0,lastY=ship.position.y;
  for(let i=0;i<120*100;i++) {
    field.update(dt);ship.step(dt,field);manager.update(dt,field.time,ship,ship);
    damage.update(dt,ship,field,{spawn(){}},field.time);
    const attitude=ship.attitude,water=field.heightAt(ship.position.x,ship.position.z);
    maxStep=Math.max(maxStep,Math.abs(ship.position.y-lastY));lastY=ship.position.y;
    assert.ok(Number.isFinite(ship.position.y+ship.velocity.length()+ship.omega.length()));
    assert.equal(ship.capsized,false);assert.equal(damage.state,'ok');
    if(i%120===0)rows.push({t:field.time-start,y:ship.position.y,water,immersion:water-ship.position.y,vy:ship.velocity.y,roll:attitude.roll*180/Math.PI,pitch:attitude.pitch*180/Math.PI,state:manager.state});
  }
  const peakIndex=rows.reduce((best,r,i)=>r.y>rows[best].y?i:best,0);
  const peak=rows[peakIndex],after=rows.slice(peakIndex+1),dip=after.reduce((a,b)=>a.y<b.y?a:b);
  assert.ok(peak.y>3&&peak.y<30,'ship climbs the concentrated wave');
  assert.ok(dip.y<before&&dip.y>before-12,'ship returns through the trough without sinking');
  assert.ok(after.some(r=>r.vy<-.7));assert.ok(maxStep<.1,'continuous motion below 12 m/s vertically');
  assert.equal(manager.state,'idle');assert.equal(damage.flood,0);
  near(rows.slice(-20).reduce((a,r)=>a+r.y,0)/20,before,.15,'mean recovered draft');
  report.voyages.push({throttle,before,peak,dip,end:rows.at(-1),maxStep,damage:{state:damage.state,flood:damage.flood,integrity:damage.integrity},rows});
}
const output=process.argv[2]||new URL('../qa/2026-10-02/wave-response/broad-wave.json',import.meta.url);
if(typeof output==='string')mkdirSync(dirname(output),{recursive:true});
writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,voyages:report.voyages.map(({rows,...summary})=>summary)},null,2));
