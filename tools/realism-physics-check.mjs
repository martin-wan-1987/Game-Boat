/** Current dual-vessel/multidirectional candidate, no browser required.
 * node tools/realism-physics-check.mjs static
 * node tools/realism-physics-check.mjs dynamics
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { WaveField } from '../src/waves.js';
import { ShipPhysics } from '../src/physics.js';
import { createHullLoft, operatingWaterlineY } from '../src/hull-loft.js';
import { SHIP } from '../src/carrier-layout.js';
import { TANKER } from '../src/tanker-layout.js';
import { TsunamiManager, SEA_STATE, TSUNAMI_TIERS, hullExtent } from '../src/tsunami.js';
import { DamageModel } from '../src/damage.js';
const mode=process.argv[2]??'static',vesselFilter=process.argv[3],seedFilter=process.argv[4]&&Number(process.argv[4]),outDir=process.env.BOAT_QA_OUTPUT??'qa/2026-10-02/realism';
const vessels=[SHIP,TANKER].filter(v=>!vesselFilter||v.id===vesselFilter);
assert.ok(vessels.length>0,`Unknown vessel ${vesselFilter}`);
const seeds=seedFilter?[seedFilter]:[137,931];
const evidenceName=[mode,vesselFilter,seedFilter].filter(Boolean).join('-');
const files=['waves','tsunami','physics','hull-loft','carrier-layout','tanker-layout','damage'];
const result={mode,at:new Date().toISOString(),hashes:Object.fromEntries(files.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(`src/${p}.js`)).digest('hex')])),checks:[]};
const note=(name,data)=>{result.checks.push({name,...data});console.log(name,JSON.stringify(data));};
const close=(a,b,tolerance,message)=>assert.ok(Math.abs(a-b)<=tolerance,`${message}: ${a} versus ${b}`);
function seeded(seed,fn){const prior=Math.random;let n=seed>>>0;Math.random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};try{return fn();}finally{Math.random=prior;}}
function sea(seed=137){return seeded(seed,()=>new WaveField().buildSea(SEA_STATE.hs,1,0,SEA_STATE.spread,SEA_STATE.peakLength,SEA_STATE.directions));}
function body(vessel){const p=new ShipPhysics(createHullLoft(vessel).buildPatches(),{vessel});p.reset(0,0,0);return p;}
const zero=new THREE.Vector3();
function origin(ship){return ship.localToWorld(zero,new THREE.Vector3());}
const flat=new WaveField();
function staticChecks(){
  assert.ok(SHIP.deckOutline.slice(0,15).every((p,i,a)=>p[1]>=0&&(i===0||p[0]<=a[i-1][0])),'carrier first 15 points are starboard bow to stern');
  let derivativeError=0,normalError=0,inverseError=0;
  const field=sea();
  field.replacePackets([{x:143,z:-71,dirX:.8,dirZ:.6,height:30,thickness:210,lateralWidth:1000,speed:18},{x:-192,z:91,dirX:-.6,dirZ:.8,height:18,thickness:210,lateralWidth:1400,speed:18}]);
  for(let i=0;i<120;i++){
    const x=-320+i*5.37,z=177*Math.sin(i*.6),t=i*.061,eps=1e-4;
    field.time=t;const s=field.sampleBase(x,z,{});
    const px=field.sampleBase(x+eps,z,{}),mx=field.sampleBase(x-eps,z,{}),pz=field.sampleBase(x,z+eps,{}),mz=field.sampleBase(x,z-eps,{});
    const tx=new THREE.Vector3(px.x-mx.x,px.y-mx.y,px.z-mx.z),tz=new THREE.Vector3(pz.x-mz.x,pz.y-mz.y,pz.z-mz.z);
    const n=tz.cross(tx).normalize();normalError=Math.max(normalError,n.distanceTo(new THREE.Vector3(s.nx,s.ny,s.nz)));
    field.time=t+eps;const plus=field.sampleBase(x,z,{});field.time=t-eps;const minus=field.sampleBase(x,z,{});field.time=t;
    for(const a of ['x','y','z'])derivativeError=Math.max(derivativeError,Math.abs((plus[a]-minus[a])/(2*eps)-s[`v${a}`]));
    const inv=field.sampleWorld(s.x,s.z,{});inverseError=Math.max(inverseError,Math.hypot(inv.x-s.x,inv.z-s.z),Math.abs(inv.y-s.y));
  }
  assert.ok(derivativeError<1e-5);assert.ok(normalError<1e-6);assert.ok(inverseError<2e-4);
  close(field.significantSeaHeight,5.6,1e-12,'ambient significant wave height');
  note('analytic derivatives and inverse',{samples:120,derivativeError,normalError,inverseError,hs:field.significantSeaHeight});
  function entryBody(){const p=new ShipPhysics([{pos:new THREE.Vector3(0,-1,0),nrm:new THREE.Vector3(0,-1,0),area:1000,kind:'bottom'}],{vessel:SHIP});p.reset(0,0,0);return p;}
  const impacts=[];
  for(const [label,depth,speed] of [['entry',.025,-8],['submerged',3,-8],['exit',.025,8]]){
    const p=entryBody();p.position.y=1-depth;p.velocity.y=speed;p.step(1/120,flat);impacts.push({label,impulse:p.lastForces.entryImpulse});
  }
  assert.ok(impacts[0].impulse>0);assert.equal(impacts[1].impulse,0);assert.equal(impacts[2].impulse,0);
  const integrals=[120,240].map(hz=>{const p=entryBody(),dt=1/hz;let integral=0,entries=0;
    for(let i=0;i<hz*2;i++){p.position.set(SHIP.cg[0],1-(-.51+8*i*dt),SHIP.cg[2]);p.velocity.set(0,-8,0);p.omega.set(0,0,0);p.quaternion.identity();p.step(dt,flat);integral+=p.slam*dt;if(p.lastForces.entryImpulse>0)entries++;}
    assert.equal(entries,1);return integral;});
  assert.ok(Math.abs(integrals[0]/integrals[1]-1)<.03,'entry-response integral converges under timestep refinement');
  note('free-surface entry flux',{impacts,responseIntegrals:integrals});
  const bottom=()=>({pos:new THREE.Vector3(0,-10,0),nrm:new THREE.Vector3(0,-1,0),area:500,kind:'bottom'});
  const ballastOnly=new ShipPhysics([bottom()],{vessel:SHIP});ballastOnly.reset(0,0,0);ballastOnly.step(0,flat);
  const withDeck=new ShipPhysics([bottom(),{pos:new THREE.Vector3(0,-10,0),nrm:new THREE.Vector3(0,-1,0),area:500,kind:'deck'}],{vessel:SHIP});withDeck.reset(0,0,0);withDeck.step(0,flat);close(withDeck.lastForces.buoy,ballastOnly.lastForces.buoy,1e-6,'non-watertight deck adds no hydrostatic pressure');
  const deep=[100,200].map(depth=>{const p=body(SHIP);p.position.y-=depth;p.step(0,flat);return p.lastForces.buoy;});close(deep[0],deep[1],1e-6,'38 m depth saturation');
  const waterSpeeds=[20,1200].map(vy=>{const p=body(SHIP);const f={sampleWorld:(x,z,o)=>Object.assign(o,{x,y:0,z,nx:0,ny:1,nz:0,vx:0,vy,vz:0})};p.step(1/120,f);return p.velocity.y;});close(waterSpeeds[0],waterSpeeds[1],1e-12,'12 m/s water-velocity saturation');
  const capped=body(SHIP);capped.velocity.set(100,0,0);capped.omega.set(0,10,0);capped.step(0,flat);close(capped.velocity.length(),60,1e-12,'linear speed cap');close(capped.omega.length(),1.1,1e-12,'angular speed cap');
  note('preserved physical invariants',{deckAddedBuoyancy:withDeck.lastForces.buoy-ballastOnly.lastForces.buoy,deepBuoyancy:deep,verticalResponse:waterSpeeds,speedCap:capped.velocity.length(),angularCap:capped.omega.length()});
  for(const vessel of vessels){
    const p=body(vessel),manager=new TsunamiManager(field);
    for(const heading of [0,.63,Math.PI/2,-2.5]){
      p.reset(57,-19,heading);close(p.heading,heading,1e-12,'heading reset');
      assert.ok(origin(p).distanceTo(new THREE.Vector3(57,-operatingWaterlineY(vessel),-19))<1e-10);
      for(const id of Object.keys(TSUNAMI_TIERS)){
        manager.trigger(id,p,field.time);const tier=TSUNAMI_TIERS[id];let i=0;
        for(const group of tier.groups)for(let j=0;j<group.count;j++){
          const packet=field.packets[i++],o=origin(p);
          const distance=packet.distanceToCrest(o.x,o.z,field.time);
          if(group.bearing===0&&j===0)close(distance-packet.leadingExtent-hullExtent(p,packet.dx,packet.dz),100,1e-9,`${vessel.id}/${id} leading edge`);
          const phase=(distance-field.packets[0].distanceToCrest(o.x,o.z,field.time))/tier.spacing;
          close(phase,(group.phase??0)+j*(group.stride??1),1e-9,'relative arrival phase');
          close(packet.width*2,tier.thickness,1e-12,'packet thickness');
        }
        assert.equal(i,field.packets.length);
        if(id==='broad'){close(field.packets[0].height,30,1e-12,'main crest');close(field.packets[4].height,18,1e-12,'side crest');}
        const generatedAt=field.time;
        field.time+=200;manager.update(200,field.time,p,{attitude:p.attitude});assert.equal(manager.state,'clearing');
        field.time+=5;manager.update(5,field.time,p,{attitude:p.attitude});assert.equal(manager.state,'idle');field.time=generatedAt;
      }
    }
    const mesh=createHullLoft(vessel).buildMesh(new THREE.MeshBasicMaterial(),new THREE.MeshBasicMaterial());
    const edges=new Map();let signedVolume=0,triangles=0;
    const key=p=>p.map(v=>Math.round(v*1e5)).join(',');
    mesh.traverse(child=>{if(!child.isMesh)return;const g=child.geometry,pts=g.attributes.position,index=g.index.array;
      for(let i=0;i<index.length;i+=3){const vs=[0,1,2].map(j=>[pts.getX(index[i+j]),pts.getY(index[i+j]),pts.getZ(index[i+j])]);
        const cross=new THREE.Vector3(...vs[1]).cross(new THREE.Vector3(...vs[2]));signedVolume+=new THREE.Vector3(...vs[0]).dot(cross)/6;triangles++;
        for(let j=0;j<3;j++){const a=key(vs[j]),b=key(vs[(j+1)%3]);const k=a<b?`${a}/${b}`:`${b}/${a}`;const e=edges.get(k)??{count:0,winding:0};e.count++;e.winding+=a<b?1:-1;edges.set(k,e);}
      }});
    const bad=[...edges.values()].filter(e=>e.count!==2||e.winding!==0);assert.equal(bad.length,0,'closed, consistently oriented shell');assert.ok(signedVolume>0);
    note(`${vessel.id} placement and hull closure`,{headings:4,tiers:3,triangles,edges:edges.size,signedVolume,badEdges:bad.length});
    // Rotating the entire world around vertical cannot alter body response.
    const a=body(vessel),b=body(vessel),q=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),1.13);
    a.quaternion.setFromEuler(new THREE.Euler(.13,0,.045));a.position.copy(a.cg).applyQuaternion(a.quaternion);a.velocity.set(8,.4,-1);a.omega.set(.11,.015,.04);a.throttle=.8;a.rudder=.6;a.flood=.08;a.list=.03;
    b.quaternion.copy(q).multiply(a.quaternion);b.position.copy(a.position).applyQuaternion(q);b.velocity.copy(a.velocity).applyQuaternion(q);b.omega.copy(a.omega).applyQuaternion(q);b.throttle=a.throttle;b.rudder=a.rudder;b.flood=a.flood;b.list=a.list;
    close(a.attitude.roll,b.attitude.roll,1e-12,'yaw-invariant roll');close(a.attitude.pitch,b.attitude.pitch,1e-12,'yaw-invariant pitch');
    for(let i=0;i<120;i++){a.step(1/120,flat);b.step(1/120,flat);assert.ok(a.lastForces.pressureDragPower<=0&&b.lastForces.pressureDragPower<=0,'pressure drag dissipates relative-water energy');}
    const positionError=b.position.distanceTo(a.position.clone().applyQuaternion(q)),velocityError=b.velocity.distanceTo(a.velocity.clone().applyQuaternion(q)),angularError=b.omega.distanceTo(a.omega.clone().applyQuaternion(q));
    assert.ok(positionError<1e-8&&velocityError<1e-8&&angularError<1e-8);
    note(`${vessel.id} rigid-frame covariance`,{positionError,velocityError,angularError});
    // Damage samples and emitters must consume geometry coordinates via CG.
    const damage=new DamageModel(vessel);let samplePosition;const probe={heightAt:(x,z)=>{samplePosition=[x,z];return -100;}};damage.update(0,a,probe,{spawn(){}},0);
    const expected=a.localToWorld(new THREE.Vector3(...vessel.lossPoint),new THREE.Vector3());close(samplePosition[0],expected.x,1e-10,'loss sample X');close(samplePosition[1],expected.z,1e-10,'loss sample Z');
    damage.fires=[{local:new THREE.Vector3(21,17,-4),intensity:1,kind:'deck'}];const positions=[];
    seeded(1,()=>{const old=Math.random;Math.random=()=>.5;try{damage.emitSmoke(1/14,a,flat,{spawn:(...args)=>positions.push(args.slice(0,3))},0);}finally{Math.random=old;}});
    const fire=a.localToWorld(damage.fires[0].local,new THREE.Vector3());assert.ok(new THREE.Vector3(...positions[0]).distanceTo(fire.add(new THREE.Vector3(0,1,0)))<1e-10);
    const inverted=body(vessel);inverted.quaternion.setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI);
    const incident=new DamageModel(vessel);incident.update(0,inverted,probe,{spawn(){}},1);const firstFlood=incident.flood;
    incident.update(0,inverted,probe,{spawn(){}},1);close(incident.flood,firstFlood,1e-12,'capsize transition is not repeated');
    assert.equal(incident.events.filter(e=>e.msg==='倾覆！弃船！').length,1);
    incident.smokeAcc=.7;incident.emberAcc=.4;incident._lastFireSpawn=81;incident.reset();
    assert.equal(incident.smokeAcc+incident.emberAcc+incident._lastFireSpawn+incident.underT+incident.lostAt,0);
  }
}
function dynamicsChecks(){
  const dt=1/120;
  function run(ship,field,seconds,manager,damage){
    const stats={seconds:0,minY:Infinity,maxY:-Infinity,maxRoll:0,maxPitch:0,maxSpeed:0,maxVerticalSpeed:0,maxAngularSpeed:0,capsized:false,originStart:origin(ship).toArray()};
    for(let i=0;i<Math.round(seconds/dt);i++){
      field.update(dt);ship.step(dt,field);
      const a=ship.attitude,o=origin(ship);assert.ok([...o.toArray(),...ship.velocity.toArray(),...ship.omega.toArray()].every(Number.isFinite),'finite dynamics');
      stats.minY=Math.min(stats.minY,o.y);stats.maxY=Math.max(stats.maxY,o.y);stats.maxRoll=Math.max(stats.maxRoll,Math.abs(a.roll)*180/Math.PI);stats.maxPitch=Math.max(stats.maxPitch,Math.abs(a.pitch)*180/Math.PI);stats.maxSpeed=Math.max(stats.maxSpeed,ship.speedKnots);stats.maxVerticalSpeed=Math.max(stats.maxVerticalSpeed,Math.abs(ship.velocity.y));stats.maxAngularSpeed=Math.max(stats.maxAngularSpeed,ship.omega.length());stats.capsized ||= ship.capsized;
      if(manager)manager.update(dt,field.time,ship,{attitude:a});if(damage)damage.update(dt,ship,field,{spawn(){}},field.time);
      stats.seconds=(i+1)*dt;
      if(manager?.state==='idle')break;
    }
    stats.speedKnots=ship.speedKnots;stats.finalY=origin(ship).y;stats.distance=origin(ship).distanceTo(new THREE.Vector3(...stats.originStart));stats.damage=damage&&{state:damage.state,integrity:damage.integrity,flood:damage.flood};return stats;
  }
  for(const vessel of vessels){
    const ship=body(vessel),wf=new WaveField();
    const operatingY=-operatingWaterlineY(vessel);
    const equilibrium=run(ship,wf,60);note(`${vessel.id} calm equilibrium`,equilibrium);assert.ok(Math.abs(equilibrium.finalY-operatingY)<1);assert.ok(equilibrium.maxRoll<10&&!equilibrium.capsized);
    ship.throttle=1;const propulsion=run(ship,wf,vessel.id==='carrier'?300:600);note(`${vessel.id} full power acceleration`,propulsion);
    // The empty tanker may run faster than the loaded reference; the separate
    // resistance test examines its operating speed under the same thrust law.
    assert.ok(propulsion.speedKnots>(vessel.id==='carrier'?28:16.5)&&propulsion.speedKnots<vessel.dynamics.freeSpeed*1.94384);
    for(const seed of seeds){
      const ambient=sea(seed),p=body(vessel),damage=new DamageModel(vessel);p.throttle=.65;
      const severe=run(p,ambient,90,null,damage);note(`${vessel.id} severe sea seed ${seed}`,severe);assert.ok(!severe.capsized&&severe.maxRoll<25&&severe.maxPitch<15);assert.notEqual(damage.state,'lost');
      for(const id of Object.keys(TSUNAMI_TIERS)){
        const f=sea(seed),s=body(vessel),d=new DamageModel(vessel);s.throttle=.65;run(s,f,25,null,d);const manager=new TsunamiManager(f);seeded(seed,()=>manager.trigger(id,s,f.time));
        const event=run(s,f,360,manager,d);note(`${vessel.id} ${id} seed ${seed}`,{...event,eventState:manager.state,height:manager.height});assert.ok(!event.capsized,'event capsize');assert.ok(event.maxVerticalSpeed<12,'excessive heave speed');assert.ok(event.maxY-operatingY>1,'visible rise');assert.ok(event.maxY-operatingY<30,'no superposed giant rebound');assert.ok(event.minY<operatingY,'downward recovery');assert.notEqual(d.state,'lost','event loss');assert.equal(manager.state,'idle');
      }
    }
  }
}
try{if(mode==='static')staticChecks();else if(mode==='dynamics')dynamicsChecks();else throw new Error(`Unknown mode ${mode}`);result.status='passed';}catch(error){result.status='failed';result.error=error.stack;console.error(error);process.exitCode=1;}finally{fs.mkdirSync(outDir,{recursive:true});fs.writeFileSync(`${outDir}/physics-${evidenceName}.json`,JSON.stringify(result,null,2)+'\n');}
