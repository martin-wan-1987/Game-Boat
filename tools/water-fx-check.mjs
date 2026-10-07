/** Production water FX/propulsion checks without a renderer or image fixture.
 * node tools/water-fx-check.mjs [output-directory]
 * The field, loft, particle integration and rotor geometry are the game code.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as THREE from 'three';
import {VesselWaterFX} from '../src/vessel-water.js';
import {SolidWater} from '../src/solid-water.js';
import {Islands} from '../src/islands.js';
import {WaveField,makeWaveUniforms} from '../src/waves.js';
import {createHullLoft,operatingWaterlineY} from '../src/hull-loft.js';
import {buildPropulsion} from '../src/propulsion.js';
import {SHIP} from '../src/carrier-layout.js';
import {TANKER} from '../src/tanker-layout.js';
import {HOUBEI,SPIRIT} from '../src/expanded-vessel-layout.js';
import {SEA_STATE,TSUNAMI_TIERS} from '../src/tsunami.js';

globalThis.innerHeight=900;
const outDir=process.argv[2]??'qa/2026-10-02/realism';
const files=['vessel-water','propulsion','mesh-bake','hull-loft','waves','carrier-layout','tanker-layout'];
const report={at:new Date().toISOString(),status:'passed',method:'Node production geometry and water sampler; deterministic RNG; no WebGL claims',
  hashes:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(`src/${file}.js`)).digest('hex')])),checks:[]};
const near=(actual,expected,tolerance,label)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: ${actual} vs ${expected} (tolerance ${tolerance})`);
function check(name,run){try{const evidence=run();report.checks.push({name,status:'passed',...evidence});console.log(name,JSON.stringify(evidence));}catch(error){report.status='failed';report.checks.push({name,status:'failed',error:error.stack});console.error(name,error.message);}}
function seeded(seed,run){let n=seed>>>0;const original=Math.random;Math.random=()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296);try{return run();}finally{Math.random=original;}}
function sea(seed=913){return seeded(seed,()=>new WaveField().buildSea(SEA_STATE.hs,1,0,SEA_STATE.spread,SEA_STATE.peakLength,SEA_STATE.directions));}
function fixture(vessel,particles=12000){
  const loft=createHullLoft(vessel),waveUniforms=makeWaveUniforms(THREE),tex=new THREE.Texture(),solidWater=new SolidWater(vessel.deckOutline.length),islands=new Islands(waveUniforms,tex),fx=new VesselWaterFX(waveUniforms,{vessel,loft,tex,solidWater,islands,particles,history:210});
  const ship=new THREE.Object3D();ship.position.y=-operatingWaterlineY(vessel);
  const physics={velocity:new THREE.Vector3(),throttle:0,slam:0,omega:new THREE.Vector3(),position:new THREE.Vector3()};
  return {vessel,loft,fx,ship,physics};
}
function validateArrays(fx){
  const attributes={...Object.fromEntries(Object.entries(fx.geometry.attributes).map(([key,value])=>[`foam.${key}`,value.array])),
    position:fx.sprayPosition,velocity:fx.sprayVelocity,life:fx.sprayLife,duration:fx.sprayDuration,size:fx.spraySize,alpha:fx.sprayAlpha};
  for(const [key,array] of Object.entries(attributes))for(const value of array)assert.ok(Number.isFinite(value),`${key} contains nonfinite value`);
  for(const value of fx.sprayAlpha)assert.ok(value>=0&&value<=1,'spray opacity in range');
  const age=fx.geometry.attributes.aAge.array,strength=fx.geometry.attributes.aStrength.array;
  for(let i=0;i<age.length;i++){assert.ok(age[i]>=0&&age[i]<=1,'foam age in range');assert.ok(strength[i]>=0&&strength[i]<=1,'foam strength in range');assert.ok(Number.isFinite(strength[i]*(1-age[i])**1.5),'GPU foam opacity expression finite');}
  assert.ok(fx.geometry.drawRange.count<=fx.geometry.index.count,'live draw indices fit allocation');
}
/** High-precision independent root, compared to actual emitted world positions. */
function contactRoots(f,field){
  return f.fx.spraySources.flatMap(source=>{
    const point=u=>source.point(source.t,u,source.side).applyQuaternion(f.ship.quaternion).add(f.ship.position);
    const residual=u=>{const p=point(u);return p.y-field.heightAt(p.x,p.z);};
    if(residual(0)>0||residual(1)<0)return [];
    let low=0,high=1;
    for(let k=0;k<48;k++){const mid=(low+high)/2;if(residual(mid)>0)high=mid;else low=mid;}
    const p=point((low+high)/2),normal=new THREE.Vector3(source.nx,0,source.nz).applyQuaternion(f.ship.quaternion).setY(0).normalize();
    return [{p,normal,source,residual:Math.abs(p.y-field.heightAt(p.x,p.z))}];
  });
}
for(const vessel of [SHIP,TANKER]){
  check(`${vessel.id}: tilted hull/sea spray birth`,()=>seeded(371,()=>{
    const f=fixture(vessel),field=sea();field.time=3.25;
    f.ship.position.set(71,1.2,-64);f.ship.quaternion.setFromEuler(new THREE.Euler(.105,.7,-.014));
    f.physics.position.set(...vessel.cg).applyQuaternion(f.ship.quaternion).add(f.ship.position);
    f.physics.velocity.set(16,0,0).applyQuaternion(f.ship.quaternion);f.physics.throttle=1;f.physics.slam=.4;f.physics.omega.set(.014,-.023,.011);
    const roots=contactRoots(f,field),dt=.06;
    assert.ok(roots.length>10,'sufficient wet sections for a tilted vessel');
    f.fx.update(field.time,dt,field,f.ship,f.physics);
    const born=f.fx.cursor;assert.ok(born>30&&born<f.fx.capacity,'actual spray was generated without wrapping');
    let maxSeaResidual=0,maxContactDistance=0,maxRootResidual=0,discarded=0;
    for(let i=0;i<born;i++){
      const j=3*i;
      const birth=new THREE.Vector3(f.fx.sprayPosition[j]-f.fx.sprayVelocity[j]*dt,
        f.fx.sprayPosition[j+1]-(f.fx.sprayVelocity[j+1]+9.81*dt)*dt+.5*9.81*dt*dt,
        f.fx.sprayPosition[j+2]-f.fx.sprayVelocity[j+2]*dt);
      const error=Math.abs(birth.y-field.heightAt(birth.x,birth.z)-.16);maxSeaResidual=Math.max(maxSeaResidual,error);
      // Sprites start 0.6..1.6 m outside the hull, independently on X/Z;
      // the 8-step source intersection adds at most a small section error.
      let closest=Infinity;
      for(const r of roots){const delta=birth.clone().sub(r.p),distance=Math.hypot(delta.x,delta.z);
        if(distance<closest)closest=distance;maxRootResidual=Math.max(maxRootResidual,r.residual);
      }
      maxContactDistance=Math.max(maxContactDistance,closest);
      if(f.fx.sprayLife[i]===0)discarded++;
    }
    near(maxSeaResidual,0,4e-5,'reconstructed birth follows displaced sea plus clearance');
    assert.ok(maxContactDistance<=1.9,'each birth is adjacent to an actual tilted hull/sea contact');
    assert.ok(maxRootResidual<1e-9,'reference roots converge');validateArrays(f.fx);
    const tiltedExtent=Math.max(...roots.map(r=>Math.abs(f.ship.worldToLocal(r.p.clone()).y)));
    assert.ok(tiltedExtent>1,'test exercises displacement from nominal local y=0 waterline');
    return {born,wetSources:roots.length,totalSources:f.fx.spraySources.length,discarded,maxSeaResidual,maxContactDistance,tiltedLocalHeight:tiltedExtent};
  }));
  check(`${vessel.id}: speed drives emission and persistent wake`,()=>seeded(63,()=>{
    const counts=[];
    for(const speed of [0,vessel.id==='carrier'?16:8.5]){
      const f=fixture(vessel),field=new WaveField();f.physics.velocity.x=speed;f.physics.throttle=speed?1:0;
      // Birth flux is checked in the original two-second window. Peak live
      // density needs a steady emission sample: the sampled ballistic arcs
      // can straddle that window (the tanker had exactly 100, then 103).
      let total=0,totalFirstTwoSeconds=0,peakAlive=0;
      for(let frame=0;frame<240;frame++){
        const before=f.fx.cursor;field.update(1/60);f.ship.position.x+=speed/60;f.physics.position.copy(f.ship.position);
        f.fx.update(field.time,1/60,field,f.ship,f.physics);
        total+=(f.fx.cursor-before+f.fx.capacity)%f.fx.capacity;peakAlive=Math.max(peakAlive,f.fx.alive);
        if(frame===119)totalFirstTwoSeconds=total;
      }
      validateArrays(f.fx);counts.push({speed,total,totalFirstTwoSeconds,peakAlive,seconds:4,history:f.fx.history.length,propLevel:f.fx.propLevel});
    }
    assert.equal(counts[0].total,0,'flat still water does not spray');
    assert.ok(counts[1].totalFirstTwoSeconds>200,'full speed creates hundreds of drops in two seconds');
    assert.ok(counts[1].peakAlive>100,'abundant simultaneous droplets');
    assert.ok(counts[1].history>=10,'moving stern leaves world-space wake history');
    assert.ok(counts[1].propLevel>.65,'full throttle develops shaft wash');
    return {runs:counts};
  }));
  check(`${vessel.id}: dry/submerged sections have no emitters`,()=>{
    const f=fixture(vessel),field=new WaveField();f.physics.velocity.x=20;f.physics.throttle=1;f.physics.slam=4;
    const states=[];
    for(const y of [100,-100]){f.fx.reset();f.ship.position.y=y;f.physics.position.copy(f.ship.position);f.fx.update(0,.1,field,f.ship,f.physics);assert.equal(f.fx.cursor,0);assert.equal(f.fx.alive,0);states.push({hullY:y,born:f.fx.cursor});validateArrays(f.fx);}
    return {states};
  });
  check(`${vessel.id}: exact gravitational arc and sea-contact removal`,()=>{
    const f=fixture(vessel,64),field=new WaveField(),dt=1/120,g=9.81,y0=.16,vy0=8;
    f.fx.sprayPosition[1]=y0;f.fx.sprayVelocity[1]=vy0;f.fx.sprayLife[0]=f.fx.sprayDuration[0]=10;f.fx.spraySize[0]=.5;
    let errorY=0,errorV=0,apex=0,descending=false,removedAt=null;
    const analyticImpact=(vy0+Math.sqrt(vy0**2+2*g*y0))/g;
    for(let frame=1;frame<=300;frame++){
      const t=frame*dt;field.time=t;f.fx.update(t,dt,field,f.ship,f.physics);
      if(f.fx.sprayLife[0]>0){errorY=Math.max(errorY,Math.abs(f.fx.sprayPosition[1]-(y0+vy0*t-.5*g*t*t)));errorV=Math.max(errorV,Math.abs(f.fx.sprayVelocity[1]-(vy0-g*t)));apex=Math.max(apex,f.fx.sprayPosition[1]);if(f.fx.sprayVelocity[1]<0)descending=true;}
      else {removedAt=t;assert.equal(f.fx.sprayAlpha[0],0);break;}
    }
    assert.ok(descending,'droplet falls after apex');near(apex,y0+vy0**2/(2*g),.001,'apex');
    near(errorY,0,5e-5,'float32 gravitational position');near(errorV,0,5e-5,'float32 gravitational velocity');
    assert.ok(removedAt>=analyticImpact&&removedAt<=analyticImpact+dt,'droplet removed at sea crossing, not arbitrary expiry');validateArrays(f.fx);
    return {gravity:g,dt,errorY,errorV,apex,analyticImpact,removedAt,descending};
  });
  check(`${vessel.id}: event spray/foam finite through expiry`,()=>seeded(936,()=>{
    const f=fixture(vessel,4800),field=sea(642);f.physics.velocity.x=13;f.physics.throttle=1;f.physics.slam=.8;
    let peakAlive=0;
    for(const tier of Object.values(TSUNAMI_TIERS)){
      field.replacePackets([{x:0,z:0,dirX:1,dirZ:0,height:tier.hMax,thickness:tier.thickness,lateralWidth:tier.lateralWidth,speed:tier.speed}]);
      for(let frame=0;frame<60;frame++){const dt=1/30;field.update(dt);f.ship.quaternion.setFromEuler(new THREE.Euler(.18*Math.sin(field.time),.5,.045*Math.cos(field.time)));f.physics.position.set(...vessel.cg).applyQuaternion(f.ship.quaternion).add(f.ship.position);f.fx.update(field.time,dt,field,f.ship,f.physics);validateArrays(f.fx);peakAlive=Math.max(peakAlive,f.fx.alive);}
    }
    field.clearPackets();f.physics.velocity.set(0,0,0);f.physics.throttle=0;f.physics.slam=0;f.ship.position.y=100;
    for(let frame=0;frame<400;frame++){field.update(.1);f.fx.update(field.time,.1,field,f.ship,f.physics);if(frame%20===0)validateArrays(f.fx);}
    validateArrays(f.fx);assert.equal(f.fx.alive,0);assert.equal(f.fx.history.length,0);assert.ok(peakAlive>20);
    f.fx.reset();assert.equal(f.fx.geometry.drawRange.count,0);assert.ok(f.fx.sprayAlpha.every(v=>v===0));
    return {tiers:Object.keys(TSUNAMI_TIERS),peakAlive,simulationSeconds:46,aliveAfterExpiry:0,wakeAfterExpiry:0};
  }));
  check(`${vessel.id}: baked five-blade solid propulsion`,()=>{
    const prop=buildPropulsion(vessel),expected=vessel.id==='carrier'?4:1;assert.equal(prop.rotors.length,expected);
    prop.group.updateMatrixWorld(true);const rotors=[];
    for(const {rotor,shaft} of prop.rotors){
      assert.equal(shaft.blades,5);assert.equal(rotor.children.length,1,'one baked bronze mesh per rotating hub');assert.equal(rotor.userData.dynamic,true);
      const mesh=rotor.children[0],g=mesh.geometry;assert.ok(g.attributes.position.count>1000);assert.equal(g.attributes.uv.count,g.attributes.position.count);assert.equal(g.attributes.normal.count,g.attributes.position.count);
      for(const attr of Object.values(g.attributes))for(const v of attr.array)assert.ok(Number.isFinite(v),'merged rotor geometry finite');
      const passes=[];
      for(const side of [-1,1]){
        const hits=[],ray=new THREE.Raycaster();
        for(let n=0;n<720;n++){
          const angle=n*Math.PI*2/720,origin=new THREE.Vector3(side*shaft.radius*2,Math.cos(angle)*shaft.radius*.65,Math.sin(angle)*shaft.radius*.65).add(rotor.position);
          ray.set(origin,new THREE.Vector3(-side,0,0));hits.push(ray.intersectObject(mesh,false).length>0);
        }
        const lobes=hits.reduce((n,h,i)=>n+Number(h&&!hits[(i+719)%720]),0),occupied=hits.filter(Boolean).length;
        assert.equal(lobes,5,'five separate blade silhouettes at 65% radius from both sides');assert.ok(occupied>40&&occupied<650,'blades have finite chord with visible gaps');passes.push({side,lobes,occupied});
      }
      const before=rotor.rotation.x;prop.update(.1,1,12,.2);assert.notEqual(rotor.rotation.x,before,'rotor animates independently of static mesh bake');
      rotors.push({position:shaft.position,radius:shaft.radius,vertices:g.attributes.position.count,rayPasses:passes});
    }
    assert.equal(prop.rudders.length,vessel.propulsion.rudders.length);for(const rudder of prop.rudders)near(rudder.rotation.y,.2,1e-12,'rudder pivots');
    return {shafts:expected,rudderCount:prop.rudders.length,rotors};
  });
}
for(const vessel of [HOUBEI,SPIRIT])check(`${vessel.id}: each water contact belongs to a real hull`,()=>{
  const f=fixture(vessel),field=new WaveField(),shell=f.loft.buildMesh(new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  shell.position.copy(f.ship.position);shell.updateMatrixWorld(true);
  assert.equal(f.fx.sides.length,vessel.hulls.length*2);
  const roots=contactRoots(f,field),ray=new THREE.Raycaster();let error=0;
  for(const {p,normal} of roots){
    ray.set(p.clone().addScaledVector(normal,2),normal.clone().negate());
    const hits=ray.intersectObject(shell,true);assert.ok(hits.length,'actual visible hull supports this water contact');
    // A ray towards an inner sponson may enter another hull first. Contact
    // support requires an intersection at the source, not first-hit order.
    error=Math.max(error,Math.min(...hits.map(hit=>Math.abs(hit.distance-2))));
  }
  assert.ok(roots.length>20);assert.ok(error<.035,'water contacts follow the tessellated hull, not its outer envelope');
  f.physics.velocity.set(20,0,0);f.physics.throttle=1;f.fx.update(0,.1,field,f.ship,f.physics);validateArrays(f.fx);assert.ok(f.fx.cursor>0);
  shell.traverse(m=>{if(m.isMesh)m.geometry.dispose();});
  return {hulls:vessel.hulls.length,foamContours:f.fx.sides.length,wetSources:roots.length,meshContactError:error,born:f.fx.cursor};
});
fs.mkdirSync(outDir,{recursive:true});fs.writeFileSync(path.join(outDir,'water-fx-check.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({status:report.status,checks:report.checks.length,output:path.join(outDir,'water-fx-check.json')}));
if(report.status!=='passed')process.exitCode=1;
