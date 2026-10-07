import * as THREE from 'three';
import {bakeStatic} from './mesh-bake.js';
import {ringSolid,chamferPlan} from './solid.js';
import {Tracers,interceptPoint,TRACER} from './projectiles.js';
import {muzzleBlast} from './muzzle-blast.js';
const UP=new THREE.Vector3(0,1,0),TAU=2*Math.PI;
const grey=new THREE.MeshStandardMaterial({name:'Weapon haze grey',color:0x8c959b,roughness:.52,metalness:.23});
const black=new THREE.MeshStandardMaterial({name:'Gun barrels',color:0x333c43,roughness:.37,metalness:.7});
const white=new THREE.MeshStandardMaterial({name:'CIWS radome',color:0xb9bfc0,roughness:.62});
const turretGeometry=new Map();
function mesh(g,geo,mat,x=0,y=0,z=0){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;g.add(m);return m;}
function tube(g,mat,a,b,r){const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),m=mesh(g,new THREE.CylinderGeometry(r,r,d.length(),12),mat,...A.add(B).multiplyScalar(.5).toArray());m.quaternion.setFromUnitVectors(UP,d.normalize());return m;}

/** One turret generator for decorative and operable guns. Muzzle anchors
 * belong to the same elevation/yaw hierarchy as the physical barrels. */
export function buildTurret(S){
  const root=new THREE.Group();root.position.set(...S.position);root.rotation.y=S.heading??0;root.userData.dynamic=true;
  const yaw=new THREE.Group();root.add(yaw);
  mesh(yaw,new THREE.CylinderGeometry(S.width*.36,S.width*.43,.65,24),grey,0,.33,0);
  const body=ringSolid([{y:.6,points:chamferPlan(0,0,S.bodyLength,S.width,S.width*.16)},
    {y:.6+S.height,points:chamferPlan(-S.bodyLength*.04,0,S.bodyLength*.83,S.width*.75,S.width*.14)}]);
  mesh(yaw,body.geometry,grey);
  if(S.type==='ciws'&&!S.openMount){
    const r=S.width*.27,h=S.height*.72;
    mesh(yaw,new THREE.CylinderGeometry(r,r,h,16),white,-S.bodyLength*.16,S.height+h*.37,0);
    mesh(yaw,new THREE.SphereGeometry(r,16,12),white,-S.bodyLength*.16,S.height+h*.87,0);
    for(const sign of [-1,1])mesh(yaw,new THREE.BoxGeometry(.8,.55,.3),grey,.25,S.height*.62,sign*S.width*.47);
  }
  const pitch=new THREE.Group();pitch.userData.dynamic=true;pitch.position.set(S.bodyLength*.27,S.height*.69+.65,0);yaw.add(pitch);
  pitch.rotation.z=S.type==='ciws'?.08:.055;
  const muzzles=[],barrelRotor=new THREE.Group();barrelRotor.userData.dynamic=true;pitch.add(barrelRotor);
  for(let i=0;i<S.barrels;i++){
    const ring=S.type==='ciws'&&S.barrelPattern!=='line',angle=i*TAU/S.barrels;
    const z=ring?Math.sin(angle)*.21:(i-(S.barrels-1)/2)*S.width*.265;
    const y=ring?Math.cos(angle)*.21:0;
    tube(barrelRotor,black,[0,y,z],[S.length,y,z],S.radius);
    tube(barrelRotor,grey,[0,y,z],[S.length*.30,y,z],S.radius*1.7);
    const bore=mesh(barrelRotor,new THREE.CircleGeometry(S.radius*.74,12),black,S.length+.004,y,z);bore.rotation.y=Math.PI/2;
    const anchor=new THREE.Group();anchor.position.set(S.length,y,z);barrelRotor.add(anchor);muzzles.push(anchor);
  }
  if(S.type==='ciws'&&S.rotating!==false)for(const x of [.4,S.length*.75])tube(barrelRotor,grey,[x,-.27,0],[x,.27,0],.10);
  bakeStatic(barrelRotor);bakeStatic(yaw);
  const parts=[];root.traverse(node=>{if(node.isMesh)parts.push(node);});
  const key=JSON.stringify([S.type,S.width,S.height,S.bodyLength,S.length,S.radius,S.barrels,S.openMount,S.barrelPattern,S.rotating]);
  const cached=turretGeometry.get(key);
  if(cached)parts.forEach((part,i)=>{part.geometry.dispose();part.geometry=cached[i];});
  else turretGeometry.set(key,parts.map(part=>part.geometry));
  return {root,yaw,pitch,barrelRotor,muzzles,parts,spec:S};
}
/** Joint-space aiming shared by meteor defence and ship combat. */
export function aimTurret(m,point,dt,rate=4.5){
  m.root.updateWorldMatrix(true,true);
  m.localAim.copy(point);m.root.worldToLocal(m.localAim);
  const yaw=-Math.atan2(m.localAim.z,m.localAim.x);
  const pitch=Math.atan2(m.localAim.y-m.pitch.position.y,Math.hypot(m.localAim.x,m.localAim.z)-m.pitch.position.x);
  const error=Math.atan2(Math.sin(yaw-m.yaw.rotation.y),Math.cos(yaw-m.yaw.rotation.y));
  m.yaw.rotation.y+=THREE.MathUtils.clamp(error,-rate*dt,rate*dt);
  m.pitch.rotation.z+=THREE.MathUtils.clamp(pitch-m.pitch.rotation.z,-rate*dt,rate*dt);
  m.root.updateWorldMatrix(true,true);m.muzzles[0].getWorldPosition(m.origin);
  m.pitch.getWorldQuaternion(m.rotation);m.direction.set(1,0,0).applyQuaternion(m.rotation);
  return Math.abs(error)<.025&&Math.abs(pitch-m.pitch.rotation.z)<.025;
}
export function animateTurret(m,time,dt,firing){
  const age=m.shots?time-m.lastShot:Infinity;
  for(const flame of m.flames)flame.update(age);
  if(m.spec.type!=='ciws')m.barrelRotor.position.x=-m.spec.radius*4*Math.exp(-Math.max(0,age)/.24);
  if(m.spec.type==='ciws'&&m.spec.rotating!==false&&firing)m.barrelRotor.rotation.x+=dt*55;
}
export class WeaponBattery {
  constructor(specs,options={}){
    this.options=options;this.selectedSide=1;this.aimOffset=0;this.salvoPending=false;this.mainPending=false;
    this.group=new THREE.Group();this.group.name='Main gun and CIWS battery';
    this.mounts=specs.map(S=>{
      const turret=buildTurret(S),flames=turret.muzzles.map(a=>muzzleBlast(a,S.radius*2));
      this.group.add(turret.root);return {...turret,flames,lastShot:-Infinity,shots:0,
        cadence:1,nextCadence:0,aim:new THREE.Vector3(),localAim:new THREE.Vector3(),origin:new THREE.Vector3(),direction:new THREE.Vector3(),rotation:new THREE.Quaternion()};
    });
    this.group.userData.dynamic=true;this.elapsed=0;
    // Independent gun joints and muzzle anchors remain the authoritative
    // pose. Repeated geometry is drawn through one instance buffer per part,
    // avoiding hundreds of draw calls for full historical AA batteries.
    const buckets=new Map();
    for(const m of this.mounts)for(const part of m.parts){
      const key=part.geometry.id+' / '+part.material.id;
      if(!buckets.has(key))buckets.set(key,{geometry:part.geometry,material:part.material,parts:[]});
      buckets.get(key).parts.push(part);part.visible=false;
    }
    this.renderBatches=[...buckets.values()].map(({geometry,material,parts})=>{
      const mesh=new THREE.InstancedMesh(geometry,material,parts.length);mesh.name='Independent weapon poses';mesh.userData.dynamic=true;
      mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;this.group.add(mesh);return {mesh,parts};
    });
    this.renderInverse=new THREE.Matrix4();this.renderMatrix=new THREE.Matrix4();this.syncTransforms();
    this.tracers=new Tracers(specs);
  }
  syncTransforms(){
    this.group.updateWorldMatrix(true,true);this.renderInverse.copy(this.group.matrixWorld).invert();
    for(const {mesh,parts} of this.renderBatches){
      parts.forEach((part,i)=>mesh.setMatrixAt(i,this.renderMatrix.multiplyMatrices(this.renderInverse,part.matrixWorld)));
      mesh.instanceMatrix.needsUpdate=true;
    }
  }
  get hasMain(){return this.mounts.some(m=>m.spec.type==='main'&&m.spec.operable!==false);}
  get hasCIWS(){return this.mounts.some(m=>m.spec.type==='ciws');}
  get hasSalvo(){return !!this.options.broadside;}
  setSide(side){this.selectedSide=side;this.aimOffset=0;this.salvoPending=false;}
  requestSalvo(){if(this.hasSalvo)this.salvoPending=true;}
  requestMain(){if(this.hasMain)this.mainPending=true;}
  reset(){this.elapsed=0;this.tracers.reset();this.selectedSide=1;this.salvoPending=false;this.mainPending=false;this.aimOffset=0;for(const m of this.mounts){m.yaw.rotation.y=0;m.pitch.rotation.z=m.spec.type==='ciws'?.08:.055;m.barrelRotor.position.x=0;m.lastShot=-Infinity;m.shots=0;m.cadence=1;m.nextCadence=0;for(const f of m.flames)f.update(100);}}
  warmup(on){for(const m of this.mounts)for(const f of m.flames)f.warmup(on);this.tracers.warmup(on);}
  shoot(m,interval=m.spec.cooldown){
    if(this.elapsed-m.lastShot<interval)return false;
    m.lastShot=this.elapsed;m.shots++;return true;
  }
  update(dt,{main=false,ciws=false,rotate=0,night=0,targets=[],onIntercept=()=>{},onShot=()=>{},field=null}={}){
    this.elapsed+=dt;
    this.aimOffset=THREE.MathUtils.clamp(this.aimOffset+rotate*dt*.4,-Math.PI*.2,Math.PI*.2);
    if(dt>0)this.tracers.update(dt,night,targets,onIntercept,field);
    const conventional=this.mounts.filter(m=>m.spec.type!=='ciws'&&m.spec.operable!==false&&(!m.spec.side||m.spec.side===this.selectedSide));
    if(this.hasSalvo)for(const m of conventional){
      const wanted=-this.selectedSide*Math.PI/2-this.aimOffset-m.root.rotation.y;
      const error=Math.atan2(Math.sin(wanted-m.yaw.rotation.y),Math.cos(wanted-m.yaw.rotation.y));
      m.yaw.rotation.y+=THREE.MathUtils.clamp(error,-dt*.65,dt*.65);m.aligned=Math.abs(error)<.025;
    }
    const salvo=this.salvoPending&&conventional.every(m=>m.aligned&&this.elapsed-m.lastShot>=m.spec.cooldown);
    if(salvo)this.salvoPending=false;
    const mainCommand=main||this.mainPending;let mainFired=false;
    for(const m of this.mounts){
      const firing=m.spec.type==='ciws'?ciws:(mainCommand&&m.spec.type==='main'||salvo)&&conventional.includes(m)&&(!this.hasSalvo||m.aligned);
      if(m.spec.type!=='ciws'){
        if(firing&&this.shoot(m)){
          if(m.spec.type==='main')mainFired=true;
          m.root.updateWorldMatrix(true,true);m.pitch.getWorldQuaternion(m.rotation);m.direction.set(1,0,0).applyQuaternion(m.rotation);
          for(const muzzle of m.muzzles){muzzle.getWorldPosition(m.origin);onShot({spec:m.spec,origin:m.origin,direction:m.direction,recoilScale:this.options.recoilScale??0});}
        }
      }
      else if(firing){
        m.root.updateWorldMatrix(true,true);m.muzzles[0].getWorldPosition(m.origin);
        let target=null,distance=1800**2;
        for(const candidate of targets){const d=m.origin.distanceToSquared(candidate.position);if(candidate.active&&d<distance){target=candidate;distance=d;}}
        if(target)interceptPoint(m.origin,target,m.aim);
        else{m.aim.set(1000,1000,0);m.root.localToWorld(m.aim);}
        const aligned=aimTurret(m,m.aim,dt);
        if(this.elapsed>=m.nextCadence){m.cadence=TRACER.minCadence+Math.random()*1.35;m.nextCadence=this.elapsed+.7+Math.random()*.7;}
        if(aligned&&this.shoot(m,m.spec.cooldown*m.cadence))this.tracers.spawn(m.origin,m.direction);
      }
      animateTurret(m,this.elapsed,dt,firing);
    }
    if(mainFired)this.mainPending=false;
    this.syncTransforms();
    this.tracers.sync();
  }
}
