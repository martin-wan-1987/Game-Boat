import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { TANKER } from '../src/tanker-layout.js';
import { createHullLoft } from '../src/hull-loft.js';
import { ShipPhysics } from '../src/physics.js';
import { WaveField } from '../src/waves.js';
const field=new WaveField(),ship=new ShipPhysics(createHullLoft(TANKER).buildPatches(),{vessel:TANKER});ship.reset(0,0,0);
for(let i=0;i<7200;i++)ship.step(1/120,field);
const settled={q:ship.quaternion.clone(),p:ship.position.clone()};
function sampleAt(knots){
  ship.quaternion.copy(settled.q);ship.position.copy(settled.p);ship.velocity.set(knots/1.94384,0,0);ship.omega.set(0,0,0);ship.throttle=1;
  ship.step(1/120,field);const forces={...ship.lastForces};
  assert.ok(forces.pressureDragPower<=0);
  return {knots,forces,powerMW:forces.thrust*knots/1.94384/1e6};
}
const samples=[14,16.5,19].map(sampleAt);
let low=16.5,high=TANKER.dynamics.freeSpeed*1.94384;
assert.ok(samples[1].forces.netX>0&&sampleAt(high).forces.netX<0,'ballast terminal speed bracket');
for(let i=0;i<28;i++){
  const mid=(low+high)/2;
  if(sampleAt(mid).forces.netX>0)low=mid;else high=mid;
}
const terminal=sampleAt((low+high)/2);
assert.ok(Math.abs(terminal.forces.netX)<100,'ballast resistance root');
assert.ok(samples[1].powerMW>30&&samples[1].powerMW<45,'installed power scale');
const result={status:'passed',interpretation:'Empty ballast game-resistance calibration; loaded 16.5 kn point is reference context, not its present terminal speed.',hashes:Object.fromEntries(['physics','tanker-layout','hull-loft','waves'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(`src/${p}.js`)).digest('hex')])),samples,terminal};
fs.writeFileSync('qa/2026-10-02/realism/tanker-resistance.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
