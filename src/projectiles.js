import * as THREE from 'three';
import {G} from './waves.js';

export const TRACER={speed:1100,life:2.2,length:34,minCadence:.5};
const r=new THREE.Vector3(),delta=new THREE.Vector3();
/** Equal gravitational acceleration cancels in projectile/target motion.
 * Targets in this game move slower than the interceptor, so the positive
 * intercept root is unique. This form avoids quadratic cancellation. */
export function interceptPoint(origin,target,out){
  r.copy(target.position).sub(origin);
  const a=target.velocity.lengthSq()-TRACER.speed**2,b=2*r.dot(target.velocity),c=r.lengthSq();
  const time=2*c/(-b+Math.sqrt(b*b-4*a*c));
  return out.copy(target.position).addScaledVector(target.velocity,time);
}
/** First sphere entry in relative space; common gravity cancels exactly.
 * Active targets are slower than the interceptor, so dt>0 gives a>0. */
export function relativeHit(start,end,target){
  r.copy(start).sub(target.previous);delta.copy(end).sub(target.position).sub(r);
  const a=delta.lengthSq(),b=r.dot(delta),c=r.lengthSq()-target.radius**2;
  if(c<=0)return 0;
  const discriminant=b*b-a*c;
  if(b>=0||discriminant<0)return null;
  const fraction=c/(-b+Math.sqrt(discriminant));
  return fraction<=1?fraction:null;
}
export class Tracers {
  constructor(specs){
    this.bullets=[];
    const capacity=specs.reduce((n,s)=>n+(s.type==='ciws'?Math.ceil(TRACER.life/(s.cooldown*TRACER.minCadence))+2:0),0);
    const positions=new Float32Array(Math.max(1,capacity)*6),geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setDrawRange(0,0);
    this.geometry=geometry;this.positions=positions;
    this.material=new THREE.LineBasicMaterial({color:0xffd998,transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
    this.mesh=new THREE.LineSegments(geometry,this.material);this.mesh.frustumCulled=false;this.mesh.name='Ballistic CIWS tracers';
  }
  spawn(position,direction){
    this.bullets.push({position:position.clone(),previous:position.clone(),velocity:direction.clone().multiplyScalar(TRACER.speed),age:0});
  }
  reset(){this.bullets.length=0;this.geometry.setDrawRange(0,0);}
  warmup(on){this.geometry.setDrawRange(0,on?2:0);this.material.opacity=on?1:0;}
  update(dt,night,targets,onIntercept,field){
    this.material.opacity=.1+.9*night;
    const contacts=[],consumed=new Set();
    for(const bullet of this.bullets){
      bullet.previous.copy(bullet.position);bullet.position.addScaledVector(bullet.velocity,dt);bullet.position.y-=.5*G*dt*dt;
      bullet.velocity.y-=G*dt;bullet.age+=dt;
      for(const target of targets){
        if(!target.active)continue;
        const hit=relativeHit(bullet.previous,bullet.position,target);
        if(hit!==null&&hit<=(target.impactFraction??1))contacts.push({bullet,target,fraction:hit});
      }
    }
    // Resolve the frame's collision timeline, independent of bullet order.
    contacts.sort((a,b)=>a.fraction-b.fraction);
    for(const {bullet,target,fraction} of contacts){
      if(consumed.has(bullet)||!target.active)continue;
      const point=target.previous.clone().lerp(target.position,fraction);
      point.y+=.5*G*dt*dt*fraction*(1-fraction);
      onIntercept(target,point);consumed.add(bullet);
    }
    this.bullets=this.bullets.filter(b=>!consumed.has(b)&&b.age<TRACER.life&&b.position.y>=field.heightAt(b.position.x,b.position.z));
    this.sync();
  }
  sync(){
    for(let i=0;i<this.bullets.length;i++){
      const b=this.bullets[i],length=Math.min(TRACER.length,b.age*TRACER.speed),speed=b.velocity.length();
      const k=i*6;this.positions[k]=b.position.x;this.positions[k+1]=b.position.y;this.positions[k+2]=b.position.z;
      this.positions[k+3]=b.position.x-b.velocity.x/speed*length;
      this.positions[k+4]=b.position.y-b.velocity.y/speed*length;
      this.positions[k+5]=b.position.z-b.velocity.z/speed*length;
    }
    this.geometry.setDrawRange(0,this.bullets.length*2);this.geometry.attributes.position.needsUpdate=true;
  }
}
