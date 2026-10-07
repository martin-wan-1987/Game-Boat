import * as THREE from 'three';
import {deckHeightAt,deckSlopeAt} from './deck-surface.js';
const UP=new THREE.Vector3(0,1,0);

/** One accelerating-deck frame for all independent deck payloads. These
 * derivatives are physical history; position/orientation remain the hull's. */
export class DeckMotion {
  constructor(){
    for(const key of ['previousVelocity','previousOmega','linear','angular','omega','r','cross','scratch'])this[key]=new THREE.Vector3();
    this.inverse=new THREE.Quaternion();
  }
  reset(physics){this.previousVelocity.copy(physics.velocity);this.previousOmega.copy(physics.omega);this.linear.set(0,0,0);this.angular.set(0,0,0);}
  update(dt,ship,physics){
    this.inverse.copy(ship.quaternion).invert();
    this.linear.copy(physics.velocity).sub(this.previousVelocity).divideScalar(dt).applyQuaternion(this.inverse);
    this.angular.copy(physics.omega).sub(this.previousOmega).divideScalar(dt).applyQuaternion(this.inverse);
    this.omega.copy(physics.omega).applyQuaternion(this.inverse);
    this.previousVelocity.copy(physics.velocity);this.previousOmega.copy(physics.omega);this.cg=physics.cg;
  }
  acceleration(local,velocity,out){
    this.r.copy(local).sub(this.cg);out.set(0,-9.81,0).applyQuaternion(this.inverse).sub(this.linear);
    out.sub(this.cross.crossVectors(this.angular,this.r));
    out.sub(this.cross.crossVectors(this.omega,this.scratch.crossVectors(this.omega,this.r)));
    return out.sub(this.cross.crossVectors(this.omega,velocity).multiplyScalar(2));
  }
}
const acceleration=new THREE.Vector3(),normal=new THREE.Vector3(),lever=new THREE.Vector3(),cross=new THREE.Vector3();
const rotation=new THREE.Quaternion();
export function stepDeckPayload(body,dt,S,motion,{friction,height,drive=0,speedLimit=Infinity}={}){
  motion.acceleration(body.local,body.relativeVelocity,acceleration);
  normal.set(-deckSlopeAt(S,body.local.x),1,0).normalize();const contactAcceleration=acceleration.dot(normal);
  acceleration.addScaledVector(normal,-contactAcceleration);acceleration.z+=drive;
  body.relativeVelocity.addScaledVector(acceleration,dt);
  const speed=body.relativeVelocity.length(),deceleration=friction*Math.max(0,-contactAcceleration)*dt;
  if(speed>0)body.relativeVelocity.multiplyScalar(Math.min(speedLimit,Math.max(0,speed-deceleration))/speed);
  body.local.addScaledVector(body.relativeVelocity,dt);body.local.y=deckHeightAt(S,body.local.x)+height;
  return contactAcceleration;
}
export function placeDeckPayload(body,ship){
  body.position.copy(body.local).applyQuaternion(ship.quaternion).add(ship.position);
  body.quaternion.copy(ship.quaternion).multiply(body.localQuaternion);
}
export function releaseDeckPayload(body,ship,physics){
  placeDeckPayload(body,ship);body.velocity.copy(body.relativeVelocity).applyQuaternion(ship.quaternion).add(physics.velocity);
  body.velocity.add(cross.crossVectors(physics.omega,lever.copy(body.position).sub(physics.position)));body.spin.copy(physics.omega);body.state='air';
}
export function stepAirPayload(body,dt){
  body.velocity.y-=9.81*dt;body.velocity.multiplyScalar(Math.exp(-.035*dt));body.position.addScaledVector(body.velocity,dt);
  const angle=body.spin.length()*dt;
  if(angle>0)body.quaternion.premultiply(rotation.setFromAxisAngle(normal.copy(body.spin).normalize(),angle));
}
const sea={},targetRotation=new THREE.Quaternion(),yaw=new THREE.Quaternion();
export function stepFloatingPayload(body,dt,field,freeboard){
  field.sampleWorld(body.position.x,body.position.z,sea);
  // Critically damped heave around a partially submerged sealed container;
  // horizontal velocity relaxes to the actual local wave/current sample.
  body.velocity.x+=(sea.vx-body.velocity.x)*(1-Math.exp(-dt*.55));
  body.velocity.z+=(sea.vz-body.velocity.z)*(1-Math.exp(-dt*.55));
  body.velocity.y+=(16*(sea.y+freeboard-body.position.y)-8*(body.velocity.y-sea.vy))*dt;
  body.position.addScaledVector(body.velocity,dt);
  targetRotation.setFromUnitVectors(UP,normal.set(sea.nx,sea.ny,sea.nz));
  targetRotation.multiply(yaw.setFromAxisAngle(UP,body.floatHeading));body.quaternion.slerp(targetRotation,1-Math.exp(-dt*2));
}
