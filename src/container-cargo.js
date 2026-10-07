import * as THREE from 'three';
import {mesh,box,tube} from './naval-vessels.js';
import {bakeStatic} from './mesh-bake.js';
import {insideOutline,deckHeightAt} from './deck-surface.js';
import {stepDeckPayload,placeDeckPayload,releaseDeckPayload,stepAirPayload,stepFloatingPayload} from './deck-payload.js';
export const CONTAINER=Object.freeze({length:12.192,width:2.438,height:2.896});
const palette=[0x1f715b,0x315d77,0x9c5142,0xcea34f,0x818e87,0x4d686e,0x477658,0x90573f];
const prototypes=new Map();
function texture(brand,bump=false){
  const c=document.createElement('canvas');c.width=2048;c.height=512;const ctx=c.getContext('2d');
  ctx.fillStyle=bump?'#848484':'#c3c8c2';ctx.fillRect(0,0,c.width,c.height);
  const pitch=c.width/44;
  for(let i=0;i<44;i++){
    const x=i*pitch;ctx.fillStyle=bump?'#bdbdbd':'#ccd0cb';ctx.fillRect(x,0,pitch*.50,512);
    ctx.fillStyle=bump?'#525252':'#909c98';ctx.fillRect(x+pitch*.52,0,pitch*.12,512);
  }
  if(!bump){
    ctx.fillStyle='#26352e';ctx.font='bold 122px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(brand,1024,238,1800);
    ctx.font='28px monospace';ctx.textAlign='left';ctx.fillText('40 HC  •  MAX GROSS 30,480 KG',90,452);
    ctx.strokeStyle='#747f79';ctx.lineWidth=5;ctx.strokeRect(12,12,2024,488);
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=bump?THREE.NoColorSpace:THREE.SRGBColorSpace;t.anisotropy=8;return t;
}
function containerPrototype(brand){
  if(prototypes.has(brand))return prototypes.get(brand);
  const paint=new THREE.MeshPhysicalMaterial({name:brand+' corrugated steel',map:texture(brand),bumpMap:texture(brand,true),bumpScale:.028,roughness:.67,metalness:.20,clearcoat:.10});
  const metal=new THREE.MeshStandardMaterial({name:'Container corner castings and door bars',color:0x596260,roughness:.44,metalness:.65});
  const recess=new THREE.MeshStandardMaterial({name:'Container door seams',color:0x29322e,roughness:.77});
  const g=new THREE.Group(),{length:L,width:W,height:H}=CONTAINER;
  box(g,paint,0,0,0,L,H,W);
  for(const side of [-1,1])for(const y of [-H/2,H/2])for(const z of [-W/2,W/2])box(g,metal,side*(L/2-.12),y,z,.27,.24,.22);
  for(const side of [-1,1]){
    box(g,recess,side*(L/2+.006),0,0,.02,H*.91,.025);
    for(const z of [-.78,-.26,.26,.78]){
      tube(g,metal,[side*(L/2+.035),-H*.41,z],[side*(L/2+.035),H*.41,z],.025);
      box(g,metal,side*(L/2+.055),-.26,z,.055,.055,.24);
      for(const y of [-.72,.64])box(g,metal,side*(L/2+.055),y,z,.05,.10,.12);
    }
  }
  bakeStatic(g);const parts=g.children.filter(c=>c.isMesh).map(m=>({geometry:m.geometry,material:m.material,paint:m.material===paint}));
  prototypes.set(brand,parts);return parts;
}
/** Top-down, outside-in order is a support partial order: a box never starts
 * through a still-stowed box above it or on its route to the ship's side. */
export function cargoSlots(S){
  return S.cargo.stacks.flatMap((stack,stackIndex)=>Array.from({length:stack.tiers},(_,tier)=>({
    ...stack,stackIndex,tier,position:[stack.x,deckHeightAt(S,stack.x)+(tier+.5)*CONTAINER.height,stack.z],
  }))).sort((a,b)=>b.tier-a.tier||Math.abs(b.z)-Math.abs(a.z)||a.bay-b.bay);
}
/** Failure budget and clock are the sole source of scheduled releases. */
export class CargoRelease {
  constructor(count,configuration){this.count=count;this.configuration=configuration;this.reset();}
  reset(){this.triggered=false;this.elapsed=0;this.released=0;}
  get budget(){return Math.floor(this.count*this.configuration.releaseFraction);}
  step(dt,waveHeight,release){
    this.triggered||=waveHeight>=this.configuration.largeWaveHeight;
    if(!this.triggered)return;
    this.elapsed+=dt;
    while(this.released<this.budget&&this.elapsed>=(this.released+1)*this.configuration.releaseInterval){release(this.released);this.released++;}
  }
}
/** Translational load bodies and contacts are independent of rendering.
 * Stowed slots form a spatial index; it contains references to the bodies,
 * never a second copy of their occupancy or pose. */
export class ContainerDynamics {
  constructor(S){
    this.spec=S;this.slots=cargoSlots(S);
    this.bodies=this.slots.map((slot,index)=>({slot,index,state:'stowed',local:new THREE.Vector3(...slot.position),localQuaternion:new THREE.Quaternion(),
      relativeVelocity:new THREE.Vector3(),position:new THREE.Vector3(),quaternion:new THREE.Quaternion(),velocity:new THREE.Vector3(),spin:new THREE.Vector3(),floatHeading:0}));
    this.cells=new Map();
    for(const b of this.bodies){const key=b.slot.bay*S.cargo.columns+b.slot.column;if(!this.cells.has(key))this.cells.set(key,[]);this.cells.get(key).push(b);}
    this.active=new Set();this.inverse=new THREE.Matrix4();this.localPosition=new THREE.Vector3();this.contactPoint=new THREE.Vector3();this.pointVelocity=new THREE.Vector3();this.inverseRotation=new THREE.Quaternion();
    this.splashed=0;this.retired=0;
    this.release=new CargoRelease(this.bodies.length,S.cargo);
  }
  reset(){
    this.active.clear();this.splashed=0;this.retired=0;this.release.reset();
    for(const b of this.bodies){b.state='stowed';b.local.set(...b.slot.position);b.relativeVelocity.set(0,0,0);b.localQuaternion.identity();b.velocity.set(0,0,0);b.spin.set(0,0,0);}
  }
  get onDeck(){return this.bodies.reduce((n,b)=>n+Number(b.state==='stowed'||b.state==='sliding'),0);}
  supportAt(body,x,z,ceiling){
    const S=this.spec,cfg=S.cargo;
    if(!insideOutline(S.deckOutline,x,z))return -Infinity;
    let top=deckHeightAt(S,x);
    const contact=other=>{
      if(other!==body&&Math.abs(other.local.x-x)<=CONTAINER.length/2&&Math.abs(other.local.z-z)<=CONTAINER.width/2){
        const y=other.local.y+CONTAINER.height/2;if(y<=ceiling+.025)top=Math.max(top,y);
      }
    };
    const b0=Math.ceil((x-CONTAINER.length/2-cfg.startX)/cfg.pitchX),b1=Math.floor((x+CONTAINER.length/2-cfg.startX)/cfg.pitchX);
    const c0=Math.ceil((z-CONTAINER.width/2)/cfg.pitchZ+(cfg.columns-1)/2),c1=Math.floor((z+CONTAINER.width/2)/cfg.pitchZ+(cfg.columns-1)/2);
    for(let bay=b0;bay<=b1;bay++)for(let column=Math.max(0,c0);column<=Math.min(cfg.columns-1,c1);column++)
      for(const other of this.cells.get(bay*cfg.columns+column)??[])if(other.state==='stowed')contact(other);
    for(const other of this.active)if(other.state==='sliding')contact(other);
    return top;
  }
  update(dt,ship,physics,field,particles,motion){
    const cfg=this.spec.cargo,waveHeight=Math.max(...[-.4,0,.4].map(f=>{
      this.localPosition.set(this.spec.length*f,0,0).applyQuaternion(ship.quaternion).add(ship.position);
      return field.heightAt(this.localPosition.x,this.localPosition.z);
    }));
    this.release.step(dt,waveHeight,index=>{
      const b=this.bodies[index];b.state='sliding';b.relativeVelocity.set(0,0,Math.sign(b.local.z)*cfg.slideSpeed*.25);this.active.add(b);
    });
    ship.updateWorldMatrix(true,false);this.inverse.copy(ship.matrixWorld).invert();this.inverseRotation.copy(ship.quaternion).invert();
    for(const b of this.active){
      if(b.state==='sliding'){
        const side=Math.sign(b.slot.z)||((b.index%2)*2-1);
        // The failed-lashing release mechanism advances each load slowly;
        // acceleration, deck tilt and friction still affect its own motion.
        const bottom=b.local.y-CONTAINER.height/2;
        stepDeckPayload(b,dt,this.spec,motion,{friction:.08,height:b.local.y-deckHeightAt(this.spec,b.local.x),drive:side*1.2,speedLimit:cfg.slideSpeed});
        placeDeckPayload(b,ship);
        const top=this.supportAt(b,b.local.x,b.local.z,bottom);
        // When a load clears its actual support it falls under gravity,
        // including into a lower tier. Its original slot height is no longer
        // used as a permanent, invisible support plane.
        if(top<bottom-.025)releaseDeckPayload(b,ship,physics);
      }else if(b.state==='air'){
        const previousBottom=this.localPosition.copy(b.position).applyMatrix4(this.inverse).y-CONTAINER.height/2;
        stepAirPayload(b,dt);this.localPosition.copy(b.position).applyMatrix4(this.inverse);
        const top=this.supportAt(b,this.localPosition.x,this.localPosition.z,previousBottom),sea=field.heightAt(b.position.x,b.position.z);
        if(b.position.y-CONTAINER.height/2<=sea){
          b.state='floating';b.position.y=sea+CONTAINER.height*.08;b.velocity.y*=.15;b.floatHeading=Math.atan2(2*(b.quaternion.w*b.quaternion.y+b.quaternion.x*b.quaternion.z),1-2*(b.quaternion.y**2+b.quaternion.z**2));this.splashed++;
          for(let i=0;i<10;i++){const a=i*Math.PI/5;particles.spawn(b.position.x,sea+.2,b.position.z,Math.cos(a)*3,4+i%3,Math.sin(a)*3,2,1,0);}
        }else if(this.localPosition.y-CONTAINER.height/2<=top&&previousBottom>=top-.025){
          b.state='sliding';b.local.copy(this.localPosition);b.local.y=top+CONTAINER.height/2;
          this.contactPoint.set(this.localPosition.x,top,this.localPosition.z).applyMatrix4(ship.matrixWorld);
          this.pointVelocity.crossVectors(physics.omega,this.contactPoint.sub(physics.position)).add(physics.velocity);
          b.relativeVelocity.copy(b.velocity).sub(this.pointVelocity).applyQuaternion(this.inverseRotation);b.relativeVelocity.y=0;
          b.localQuaternion.copy(this.inverseRotation).multiply(b.quaternion);placeDeckPayload(b,ship);
        }
      }else if(b.state==='floating')stepFloatingPayload(b,dt,field,CONTAINER.height*.08);
    }
  }
  retire(b){b.state='retired';this.active.delete(b);this.retired++;}
}
export class ContainerCargo extends ContainerDynamics {
  constructor(S){
    super(S);this.group=new THREE.Group();this.group.name='Independent container cargo';this.group.userData.dynamic=true;
    this.matrix=new THREE.Matrix4();this.unit=new THREE.Vector3(1,1,1);this.localRotation=new THREE.Quaternion();
    this.frustum=new THREE.Frustum();this.cameraMatrix=new THREE.Matrix4();this.bound=new THREE.Sphere();
    const parts=containerPrototype(S.cargo.brand),bounds=new THREE.Box3();
    for(const {geometry} of parts){geometry.computeBoundingBox();bounds.union(geometry.boundingBox);}
    this.localBound=bounds.getBoundingSphere(new THREE.Sphere());
    this.batches=parts.map(part=>{
      const instances=new THREE.InstancedMesh(part.geometry,part.material,this.bodies.length);instances.name='Individual '+S.cargo.brand+' containers';instances.frustumCulled=false;
      instances.castShadow=instances.receiveShadow=true;instances.userData.dynamic=true;this.group.add(instances);
      if(part.paint)this.bodies.forEach((b,i)=>instances.setColorAt(i,new THREE.Color(S.cargo.brand==='EVERGREEN'&&i%5!==0?0x3d8862:palette[(b.slot.bay*7+b.slot.column*3+b.slot.tier)%palette.length])));
      return instances;
    });this.reset();
  }
  reset(){
    super.reset();for(const b of this.bodies){this.matrix.compose(b.local,b.localQuaternion,this.unit);for(const batch of this.batches)batch.setMatrixAt(b.index,this.matrix);}
    for(const batch of this.batches)batch.instanceMatrix.needsUpdate=true;
  }
  update(dt,ship,physics,field,particles,motion){
    super.update(dt,ship,physics,field,particles,motion);
    for(const b of this.active)this.syncBody(b,ship);
    if(this.active.size)for(const batch of this.batches)batch.instanceMatrix.needsUpdate=true;
  }
  syncBody(b,ship){
    if(b.state==='sliding')this.matrix.compose(b.local,b.localQuaternion,this.unit);
    else this.matrix.compose(this.localPosition.copy(b.position).applyMatrix4(this.inverse),this.localRotation.copy(ship.quaternion).invert().multiply(b.quaternion),this.unit);
    for(const batch of this.batches)batch.setMatrixAt(b.index,this.matrix);
  }
  cull(camera){
    camera.updateMatrixWorld();this.cameraMatrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.cameraMatrix);
    for(const b of this.active)if(b.state==='floating'){
      this.bound.copy(this.localBound);this.bound.center.applyQuaternion(b.quaternion).add(b.position);
      if(!this.frustum.intersectsSphere(this.bound)){
        this.retire(b);this.matrix.makeScale(0,0,0);
        for(const batch of this.batches)batch.setMatrixAt(b.index,this.matrix);
      }
    }
    for(const batch of this.batches)batch.instanceMatrix.needsUpdate=true;
  }
}
