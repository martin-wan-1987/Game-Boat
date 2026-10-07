import * as THREE from 'three';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {FLEET} from '../src/fleet.js';
import {ShipPhysics} from '../src/physics.js';
import {WaveField} from '../src/waves.js';
import {SEA_STATE} from '../src/tsunami.js';
import {createHullLoft} from '../src/hull-loft.js';
const root=new URL('../',import.meta.url),output=new URL('../qa/2026-10-07/naval-combat/',import.meta.url);
await mkdir(output,{recursive:true});
const baseline=execFileSync('git',['show','HEAD:src/physics.js'],{cwd:fileURLToPath(root),encoding:'utf8'}).replace(/from '(\.\/[^']+)'/g,(_match,p)=>`from '${new URL(p,new URL('src/',root))}'`);
await writeFile(new URL('physics-baseline.mjs',output),baseline);
const {ShipPhysics:Baseline}=await import(new URL('physics-baseline.mjs',output));
const checks=[];
for(const {spec:S} of FLEET){
 const make=Class=>{const p=new Class(createHullLoft(S).buildPatches(),{vessel:S});p.reset(0,0,.7);return p;};
 const a=make(ShipPhysics),b=make(Baseline),f=new WaveField().buildSea(SEA_STATE.hs,1,0,SEA_STATE.spread,SEA_STATE.peakLength,SEA_STATE.directions);
 for(let i=0;i<720;i++){
  f.update(1/120);for(const p of [a,b]){p.throttle=.75;p.rudder=Math.sin(i/120);p.step(1/120,f);}
  for(const key of ['position','velocity','omega','quaternion'])assert.deepEqual(a[key].toArray(),b[key].toArray(),S.id+' '+key);
  assert.equal(a.rudderAngle,b.rudderAngle);
 }
 checks.push({id:S.id,steps:720,exactlyEqual:true});console.log(checks.at(-1));
}
const report={status:'passed',baseline:execFileSync('git',['rev-parse','HEAD'],{cwd:fileURLToPath(root),encoding:'utf8'}).trim(),checks};
await writeFile(new URL('steering-regression.json',output),JSON.stringify(report,null,2));
