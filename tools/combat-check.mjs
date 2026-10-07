import assert from 'node:assert/strict';
import * as THREE from 'three';
import {mkdir,writeFile} from 'node:fs/promises';
import {FLEET,COMBAT_FLEET,FLEET_BY_ID} from '../src/fleet.js';
import {COMBAT_CLASSES,COMBAT_RULES,combatProfile} from '../src/combat-rules.js';
import {CombatSession,HeatCycle,fireWindow,leadPoint} from '../src/combat.js';
import {createHullLoft} from '../src/hull-loft.js';
import {WeaponBattery} from '../src/weapons.js';
import {ShipPhysics,STANDARD_STEERING} from '../src/physics.js';
import {WaveField} from '../src/waves.js';
const output=process.argv[2]??'qa/2026-10-07/naval-combat',checks=[];
function check(name,run){try{checks.push({name,pass:true,evidence:run()});}catch(e){checks.push({name,pass:false,error:e.stack});console.error(name,e.message);}}
const near=(actual,expected,tolerance=1e-7)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
function actor(id,x=0,z=0,heading=0){
  const definition=FLEET_BY_ID[id],loft=createHullLoft(definition.spec),mesh=new THREE.Group();
  mesh.userData.loft=loft;mesh.userData.vessel=definition.spec;
  mesh.userData.weapons=new WeaponBattery(definition.spec.weapons,definition.spec.battery);mesh.add(mesh.userData.weapons.group);
  const physics=new ShipPhysics(loft.buildPatches(),{vessel:definition.spec});physics.reset(x,z,heading);
  return {mesh,physics};
}
function session(id='destroyer',enemyId='iowa',x=900,z=0){return new CombatSession(actor(id),FLEET_BY_ID[id],actor(enemyId,x,z,Math.PI),FLEET_BY_ID[enemyId],{random:()=>.5});}
const flat=new WaveField(),quiet={throttle:0,rudder:0,main:false,ciws:false};
function freezeAI(s){s.ai.update=()=>quiet;s.player.mainAuto=false;}
check('twenty-one military entries and explicit health classes',()=>{
  assert.equal(COMBAT_FLEET.length,21);assert.ok(COMBAT_FLEET.every(e=>e.combat));
  assert.ok(['tanker','pilot','spirit','msc-irina','ever-fortune','oocl-hong-kong','icon-of-the-seas','symphony-of-the-seas'].every(id=>!COMBAT_FLEET.some(e=>e.spec.id===id)));
  for(const [id,hp] of [['iowa',12000],['battleship',12000],['yamato',13000],['liaoning',14000]])assert.equal(combatProfile(FLEET_BY_ID[id]).health,hp);
  assert.equal(COMBAT_CLASSES.nimitz.health,15000);assert.equal(COMBAT_CLASSES.ford.health,17000);
  for(const e of COMBAT_FLEET.filter(e=>['nimitz','ford'].includes(e.combat)))assert.equal(combatProfile(e).health,e.combat==='ford'?17000:15000);
  return COMBAT_FLEET.map(e=>({id:e.spec.id,...combatProfile(e)}));
});
check('ordinary automatic gun has exactly forty 500-damage rounds per minute for varied frame partitions',()=>{
  const result=[];
  for(const parts of [[60],Array(7200).fill(1/120),Array(600).fill(.1),[.2,10.8,17,32]]){
    const m={lastShot:-1.5,shots:0},shots=[];let time=0;
    for(const dt of parts){fireWindow(m,time,time+dt,COMBAT_RULES.gun.interval,t=>shots.push(t));time+=dt;}
    assert.equal(shots.length,40);shots.forEach((t,i)=>near(t,1.5*i));result.push({count:shots.length,damage:shots.length*COMBAT_RULES.gun.damage});
  }return result;
});
check('all battleship main barrels share one five-second volley totaling 2000',()=>{
  const result=[];
  for(const id of ['battleship','iowa','yamato']){
    const s=session(id,'destroyer'),p=s.player;freezeAI(s);p.salvoRequested=true;
    // Aiming uses the generated joints. It does not depend on legacy side/operable flags.
    for(let i=0;i<600&&p.shots.shell===0;i++){s.weapons(p,s.enemy,quiet,s.time,s.time+1/120);s.time+=1/120;}
    assert.equal(p.shots.shell,p.profile.mainBarrels);near(s.projectiles.reduce((n,x)=>n+x.damage,0),2000);
    const first=s.projectiles.map(x=>x.at);near(Math.max(...first)-Math.min(...first),0);
    const at=first[0];p.salvoRequested=true;
    for(let i=0;i<720;i++){s.weapons(p,s.enemy,quiet,s.time,s.time+1/120);s.time+=1/120;}
    const second=s.projectiles.filter(x=>x.at>at+1e-5);assert.equal(second.length,p.profile.mainBarrels);near(second[0].at-at,5,1e-6);
    result.push({id,barrels:p.profile.mainBarrels,volleyDamage:2000,interval:second[0].at-at});s.dispose();
  }return result;
});
check('CIWS total damage budget is 2000 per ten firing seconds across every mount count',()=>{
  const result=[];
  for(const e of COMBAT_FLEET.filter(e=>combatProfile(e).ciwsMounts)){
    const s=session(e.spec.id),p=s.player;freezeAI(s);
    // Measure ten seconds of aligned fire, independently of the time needed
    // to train side-facing historical guns onto the target.
    for(let i=0;i<240;i++)s.weapons(p,s.enemy,quiet,-2+i/120,-2+(i+1)/120);
    for(let i=0;i<1200;i++){s.weapons(p,s.enemy,{...quiet,ciws:true},i/120,(i+1)/120);}
    near(s.projectiles.filter(x=>x.kind==='ciws').reduce((n,x)=>n+x.damage,0),2000,1e-6);
    assert.equal(p.missiles,p.profile.missiles??0);result.push({id:e.spec.id,mounts:p.profile.ciwsMounts,shots:p.shots.ciws,damage:2000});s.dispose();
  }return result;
});
check('defence heat remains cold while every mount is out of range',()=>{
  const s=session('yamato','iowa',5000);freezeAI(s);
  for(let i=0;i<1200;i++)s.weapons(s.player,s.enemy,{...quiet,ciws:true},i/120,(i+1)/120);
  assert.equal(s.player.thermal.heat,0);assert.equal(s.player.shots.ciws,0);s.dispose();return {seconds:10};
});
check('thermal integration preserves ten firing / five cooling seconds across partitions and reset',()=>{
  const result=[];
  for(const parts of [[30],Array(3600).fill(1/120),[1,9,2,3,10,5]]){
    const h=new HeatCycle();let active=0;
    for(const dt of parts)for(const [a,b] of h.step(dt,true))active+=b-a;
    near(active,20,1e-6);near(h.heat,0,1e-6);assert.equal(h.locked,false);h.reset();assert.equal(h.heat,0);result.push({active,heat:h.heat});
  }
  const h=new HeatCycle();h.step(10,true);assert.equal(h.locked,true);assert.equal(h.remaining,5);assert.deepEqual(h.step(4,true),[]);near(h.remaining,1);h.step(1,true);assert.equal(h.locked,false);
  return result;
});
check('actual closed hull sweep distinguishes a hit from a miss and applies exactly 500',()=>{
  const s=session('destroyer','destroyer',600);freezeAI(s);
  const point=s.enemy.targetPoint(),origin=point.clone().add(new THREE.Vector3(-300,0,0));
  s.launch(s.player,s.enemy,'shell',origin,new THREE.Vector3(1,0,0),COMBAT_RULES.gun,0);
  for(let i=0;i<120;i++)s.step(1/120,quiet,flat);
  assert.equal(s.enemy.hp,s.enemy.profile.health-500);assert.equal(s.player.hits,1);
  s.launch(s.player,s.enemy,'shell',point.clone().add(new THREE.Vector3(-300,100,0)),new THREE.Vector3(1,0,0),COMBAT_RULES.gun,s.time);
  for(let i=0;i<120;i++)s.step(1/120,quiet,flat);
  assert.equal(s.player.hits,1);const r={hp:s.enemy.hp,hits:s.player.hits,misses:s.projectiles.length};s.dispose();return r;
});
check('missiles require map lock, range, cooldown and exactly twenty rounds',()=>{
  const s=session();freezeAI(s);assert.equal(s.fireMissile(s.player),false);assert.equal(s.player.missiles,20);
  assert.equal(s.lock(s.player,s.player),false);assert.ok(s.lock(s.player,s.enemy));
  const old=s.enemy.physics.position.clone();s.enemy.physics.position.x=10000;assert.equal(s.fireMissile(s.player),false);s.enemy.physics.position.copy(old);
  for(let i=0;i<20;i++){s.time=i*COMBAT_RULES.missile.interval;assert.ok(s.fireMissile(s.player));assert.equal(s.fireMissile(s.player),false);}
  s.time+=10;assert.equal(s.fireMissile(s.player),false);assert.equal(s.player.missiles,0);assert.equal(s.projectiles.length,20);assert.ok(s.projectiles.every(x=>x.damage===1500));s.dispose();return {ammo:20,damage:1500};
});
check('guided missile hits moving physical hull for 1500 damage',()=>{
  const s=session('destroyer','destroyer',1100,400);freezeAI(s);s.lock(s.player,s.enemy);s.fireMissile(s.player);
  const command={...quiet,throttle:.6,rudder:.12};
  s.ai.update=()=>command;
  for(let i=0;i<120*20&&s.player.hits===0;i++)s.step(1/120,quiet,flat);
  assert.equal(s.player.hits,1);assert.equal(s.enemy.hp,s.enemy.profile.health-1500);const r={hp:s.enemy.hp,time:s.time,position:s.enemy.physics.position.toArray()};s.dispose();return r;
});
check('lead root satisfies interception over bearings and speed directions',()=>{
  for(let i=0;i<100;i++){
    const origin=new THREE.Vector3(12,30,-5),target=new THREE.Vector3(1000*Math.cos(i),5,1000*Math.sin(i)),v=new THREE.Vector3(30*Math.sin(i*.3),.2,30*Math.cos(i*.7));
    const p=leadPoint(origin,target,v,900),time=p.distanceTo(origin)/900;near(p.distanceTo(target.clone().addScaledVector(v,time)),0);
  }return {cases:100};
});
check('same-class opponents have independent hulls, ammo, joints and disposal restores steering',()=>{
  const s=session('destroyer','destroyer');assert.notEqual(s.player.entry,s.enemy.entry);assert.notEqual(s.player.battery,s.enemy.battery);s.player.damage(500);assert.equal(s.enemy.hp,9000);
  const a=s.player.entry,b=s.enemy.entry;s.dispose();assert.equal(a.physics.steering,STANDARD_STEERING);assert.equal(b.physics.steering,STANDARD_STEERING);
  const next=session('destroyer','destroyer');assert.equal(next.player.hp,9000);assert.equal(next.player.missiles,20);assert.equal(next.projectiles.length,0);next.dispose();return {independent:true};
});
check('combat helm responds in the first step, reaches fast yaw and restores standard response',()=>{
  const s=session();freezeAI(s);s.step(1/120,{...quiet,rudder:1},flat);near(s.player.physics.rudderAngle,THREE.MathUtils.degToRad(35));assert.ok(s.player.physics.heading>0);
  for(let i=0;i<120;i++)s.step(1/120,{...quiet,rudder:1},flat);
  assert.ok(s.player.physics.heading>.3);const heading=s.player.physics.heading;s.dispose();
  const p=actor('destroyer').physics;p.rudder=1;p.step(1/120,flat);assert.ok(p.rudderAngle<.001);return {firstStepImmediate:true,headingAfterSecond:heading};
});
check('AI autonomously navigates, aims and damages without player input',()=>{
  const s=session('iowa','destroyer',1100,400);s.player.mainAuto=false;
  const origin=s.enemy.physics.position.clone();
  for(let i=0;i<120*35&&!s.outcome;i++)s.step(1/120,quiet,flat);
  assert.ok(s.enemy.physics.position.distanceTo(origin)>5);assert.ok(s.enemy.shots.shell>0);assert.ok(s.enemy.hits>0);assert.ok(s.player.hp<12000);
  const r={distance:s.enemy.physics.position.distanceTo(origin),shots:s.enemy.shots,hits:s.enemy.hits,playerHP:s.player.hp};s.dispose();return r;
});
check('victory defeat and mutual loss derive only from current health',()=>{
  const s=session();assert.equal(s.outcome,null);s.enemy.damage(s.enemy.hp);assert.equal(s.outcome,'victory');s.player.damage(s.player.hp);assert.equal(s.outcome,'draw');s.dispose();
  const t=session();t.player.damage(t.player.hp);assert.equal(t.outcome,'defeat');const time=t.time;t.step(1,quiet,flat);assert.equal(t.time,time);t.dispose();return {outcomes:3};
});
await mkdir(output,{recursive:true});const report={at:new Date().toISOString(),status:checks.every(c=>c.pass)?'passed':'failed',checks};await writeFile(output+'/combat-unit.json',JSON.stringify(report,null,2));console.log({status:report.status,checks:checks.length,failures:checks.filter(c=>!c.pass)});if(report.status==='failed')process.exitCode=1;
