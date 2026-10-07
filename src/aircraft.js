import * as THREE from 'three';
import {bakeStatic} from './mesh-bake.js';
import {ringSolid} from './solid.js';
import {deckHeightAt,insideOutline} from './deck-surface.js';
import {stepDeckPayload,placeDeckPayload,releaseDeckPayload,stepAirPayload} from './deck-payload.js';
const AIRFRAMES={f18:{length:18.3,span:12.3,body:1.4},j15:{length:21.9,span:14.7,body:1.7}};
function fighter(kind){
  const S=AIRFRAMES[kind],g=new THREE.Group(),grey=new THREE.MeshStandardMaterial({color:0x8b969c,roughness:.66,metalness:.18}),dark=new THREE.MeshStandardMaterial({color:0x29363d,roughness:.38,metalness:.45});
  const add=(geo,mat,x,y,z)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;g.add(m);return m;};
  const fuselage=add(new THREE.CapsuleGeometry(S.body*.46,S.length*.60,6,16),grey,-.2,.3,0);fuselage.rotation.z=-Math.PI/2;fuselage.scale.z=.84;
  const nose=add(new THREE.ConeGeometry(S.body*.40,S.length*.20,16),grey,S.length*.39,.3,0);nose.rotation.z=-Math.PI/2;
  const canopy=add(new THREE.SphereGeometry(1,16,12),new THREE.MeshPhysicalMaterial({color:0x33566d,roughness:.1,metalness:.6,clearcoat:1}),S.length*.16,.95,0);canopy.scale.set(S.length*.13,.68,.57);
  for(const side of [-1,1]){
    const wing=[[S.length*.12,side*.3],[-S.length*.16,side*S.span*.5],[-S.length*.29,side*S.span*.5],[-S.length*.26,side*.5]];
    add(ringSolid([{y:.05,points:wing},{y:.24,points:wing}]).geometry,grey,0,0,0);
    const tail=[[-S.length*.32,side*.35],[-S.length*.48,side*S.span*.27],[-S.length*.50,side*S.span*.27],[-S.length*.46,side*.4]];
    add(ringSolid([{y:.5,points:tail},{y:.63,points:tail}]).geometry,grey,0,0,0);
    const fin=add(new THREE.BoxGeometry(S.length*.12,2.9,.12),grey,-S.length*.35,1.6,side*.85);fin.rotation.x=side*.21;fin.rotation.z=-.23;
    const engine=add(new THREE.CylinderGeometry(.48,.56,S.length*.28,16),dark,-S.length*.34,.3,side*.55);engine.rotation.z=Math.PI/2;
    const intake=add(new THREE.BoxGeometry(2.1,.65,.85),dark,S.length*.025,.0,side*.85);intake.rotation.y=-side*.08;
  }
  for(const [x,z] of [[S.length*.2,0],[-S.length*.12,-1.0],[-S.length*.12,1.0]]){
    add(new THREE.CylinderGeometry(.065,.065,.72,8),dark,x,-.42,z);
    const wheel=add(new THREE.CylinderGeometry(.3,.3,.18,12),dark,x,-.8,z);wheel.rotation.x=Math.PI/2;
  }
  bakeStatic(g);g.userData.dynamic=true;return g;
}
/** Aircraft move relative to an accelerating deck. Friction is an impulse
 * projected onto a Coulomb disk; release inherits the hull's point velocity.
 * Airborne aircraft then obey gravity and splash on the shared wave surface. */
export class CarrierAircraft {
  constructor(spec){
    this.spec=spec;this.group=new THREE.Group();this.group.name='Movable carrier aircraft';
    this.planes=Array.from({length:spec.aircraft?.countMax??0},(_,i)=>{
      const mesh=fighter(spec.aircraft.kind);mesh.scale.setScalar(spec.aircraft.scale);this.group.add(mesh);
      return {mesh,position:mesh.position,quaternion:mesh.quaternion,localQuaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),(i-2)*.06),
        local:new THREE.Vector3(),relativeVelocity:new THREE.Vector3(),velocity:new THREE.Vector3(),spin:new THREE.Vector3(),state:'inactive',
        friction:.22+i*.045,tieStrength:2.6+i*.7,tied:true};
    });
    this.force=new THREE.Vector3();
  }
  reset(ship,physics){
    const cfg=this.spec.aircraft;this.splashed=0;
    if(!cfg)return;
    const count=cfg.countMin+Math.floor(Math.random()*(cfg.countMax-cfg.countMin+1)),frame=AIRFRAMES[cfg.kind],slots=[];
    for(let x=-this.spec.length*.37;x<this.spec.length*.28;x+=frame.length*cfg.scale*1.3){
      const z=-this.spec.deckHalfWidthAt(x,-1)+frame.span*cfg.scale*.55+2;
      if(this.spec.deckBlocks.some(([x0,x1,z0,z1])=>x+frame.length/2>x0&&x-frame.length/2<x1&&z+frame.span/2>z0&&z-frame.span/2<z1))continue;
      if([[-1,-1],[-1,1],[1,-1],[1,1]].every(([a,b])=>insideOutline(this.spec.deckOutline,x+a*frame.length*cfg.scale*.45,z+b*frame.span*cfg.scale*.45)))slots.push([x,z]);
    }
    for(let i=0;i<this.planes.length;i++){
      const p=this.planes[i];p.mesh.visible=i<count;p.state=i<count?'deck':'inactive';p.relativeVelocity.set(0,0,0);p.tied=true;
      if(i<count){const [x,z]=slots[i];p.local.set(x,deckHeightAt(this.spec,x)+1.1*cfg.scale,z);placeDeckPayload(p,ship);}
    }
  }
  get onDeck(){return this.planes.filter(p=>p.state==='deck').length;}
  update(dt,ship,physics,field,particles,motion){
    for(const p of this.planes){
      if(p.state==='deck'){
        const a=motion.acceleration(p.local,p.relativeVelocity,this.force),normalLoad=a.y;
        // Each aircraft has its own lashing strength, wheel friction and
        // point acceleration. A failed tie never releases other aircraft.
        if(p.tied&&(Math.hypot(a.x,a.z)>p.tieStrength||normalLoad>p.tieStrength))p.tied=false;
        const contact=p.tied?-1:stepDeckPayload(p,dt,this.spec,motion,{friction:p.friction,height:1.1*this.spec.aircraft.scale});
        placeDeckPayload(p,ship);
        if(contact>0||!insideOutline(this.spec.deckOutline,p.local.x,p.local.z))releaseDeckPayload(p,ship,physics);
      }else if(p.state==='air'){
        stepAirPayload(p,dt);const pos=p.position,sea=field.heightAt(pos.x,pos.z);
        if(pos.y-1.1<=sea){
          for(let j=0;j<55;j++){const a=Math.random()*Math.PI*2,s=2+Math.random()*10;particles.spawn(pos.x,sea+.2,pos.z,Math.cos(a)*s,4+Math.random()*10,Math.sin(a)*s,3,1.5,0);}
          p.state='sea';p.mesh.visible=false;this.splashed++;
        }
      }
    }
  }
}
