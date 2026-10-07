import * as THREE from 'three';
import {combatProfile,COMBAT_RULES,wrapAngle} from './combat-rules.js';
import {aimTurret,animateTurret} from './weapons.js';
import {STANDARD_STEERING} from './physics.js';
const UP=new THREE.Vector3(0,1,0),ray=new THREE.Raycaster();

/** Positive intercept root: target speed is bounded below weapon speed. */
export function leadPoint(origin,position,velocity,speed,out=new THREE.Vector3()){
  const r=position.clone().sub(origin),c=r.lengthSq(),b=r.dot(velocity);
  const time=c===0?0:c/(Math.sqrt(b*b+(speed*speed-velocity.lengthSq())*c)-b);
  return out.copy(position).addScaledVector(velocity,time);
}
export class HeatCycle{
  constructor(){this.heat=0;this.locked=false;}
  reset(){this.heat=0;this.locked=false;}
  get remaining(){return this.locked?this.heat/COMBAT_RULES.ciws.hotSeconds*COMBAT_RULES.ciws.coolSeconds:0;}
  step(dt,trigger){
    const r=COMBAT_RULES.ciws,windows=[];
    for(let elapsed=0;elapsed<dt;){
      const firing=trigger&&!this.locked;
      if(!firing&&this.heat===0)break;
      const rate=firing?1:-r.hotSeconds/r.coolSeconds,boundary=firing?r.hotSeconds:0;
      const remaining=(boundary-this.heat)/rate,span=Math.min(dt-elapsed,remaining);
      if(firing&&span>0)windows.push([elapsed,elapsed+span]);
      this.heat=span===remaining?boundary:this.heat+span*rate;elapsed+=span;
      if(this.heat===r.hotSeconds)this.locked=true;
      if(this.heat===0)this.locked=false;
    }
    return windows;
  }
}
export class Combatant{
  constructor(entry,definition,side){
    this.entry=entry;this.definition=definition;this.side=side;this.profile=combatProfile(definition);
    this.hp=this.profile.health;this.missiles=this.profile.missiles??0;this.lastMissile=-Infinity;
    this.thermal=new HeatCycle();this.mainAuto=!this.profile.salvo;this.salvoRequested=false;this.lockedTarget=null;
    this.aimYaw=0;this.aimPitch=0;this.hits=0;this.damageDealt=0;this.shots={shell:0,ciws:0,missile:0};
    this.collider=entry.mesh.userData.loft.buildMesh(new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    entry.physics.steering=COMBAT_RULES.steering;
    const battery=this.battery;battery.reset();
    for(const m of battery.mounts)m.lastShot=-(m.spec.type==='ciws'?COMBAT_RULES.ciws.interval:this.profile.main.interval);
    this.previous=new THREE.Vector3();this.sync();this.previous.copy(this.physics.position);
  }
  get physics(){return this.entry.physics;}
  get spec(){return this.definition.spec;}
  get battery(){return this.entry.mesh.userData.weapons;}
  get alive(){return this.hp>0;}
  sync(){
    this.physics.localToWorld(new THREE.Vector3(),this.entry.mesh.position);
    this.entry.mesh.quaternion.copy(this.physics.quaternion);this.entry.mesh.updateMatrixWorld(true);
    this.collider.position.copy(this.entry.mesh.position);this.collider.quaternion.copy(this.entry.mesh.quaternion);this.collider.updateMatrixWorld(true);
  }
  targetPoint(){return this.physics.localToWorld(new THREE.Vector3(0,this.spec.hullTopY-.6,0),new THREE.Vector3());}
  damage(amount){const actual=Math.min(this.hp,amount);this.hp=Math.max(0,this.hp-amount);return actual;}
  dispose(){
    this.physics.steering=STANDARD_STEERING;this.battery.reset();
    this.collider.traverse(m=>{if(m.isMesh){m.geometry.dispose();m.material.dispose();}});
  }
}

/** AI produces the same helm/trigger commands as the player, with a reaction
 * clock, range management, broadside circulation and incoming-fire evasion. */
export class NavalAI{
  constructor(random=Math.random){this.random=random;this.nextDecision=.45;this.flank=random()<.5?-1:1;this.command={throttle:.65,rudder:0,main:false,ciws:false};}
  update(time,self,target,shots){
    if(time>=this.nextDecision){
      const delta=target.physics.position.clone().sub(self.physics.position),distance=delta.length();
      const desiredRange=self.profile.mainBarrels?1100:self.profile.missiles?1250:650;
      const bearing=Math.atan2(delta.z,delta.x),orbit=this.flank*Math.atan2(desiredRange,Math.max(1,distance-desiredRange));
      const incoming=shots.some(s=>s.target===self&&s.position.distanceTo(self.physics.position)<300);
      const heading=bearing+(distance>desiredRange*1.8?0:orbit)+(incoming?this.flank*.55:0);
      const error=wrapAngle(heading-self.physics.heading);
      this.command={throttle:distance<desiredRange*.5?.35:.75,rudder:THREE.MathUtils.clamp(error*2,-1,1),
        main:true,ciws:distance<COMBAT_RULES.ciws.range,missile:true,
        aimYaw:(this.random()-.5)*.025,aimPitch:(this.random()-.5)*.014};
      self.lockedTarget=target;
      this.nextDecision=time+.35+this.random()*.45;
    }
    return this.command;
  }
}

/** Half-open fire intervals preserve cadence across frame partitions. */
export function fireWindow(m,start,end,interval,emit){
  for(let at=Math.max(start,m.lastShot+interval);at<end-1e-10;at+=interval){
    m.lastShot=at;m.shots++;emit(at);
  }
}
export class CombatSession{
  constructor(playerEntry,playerDefinition,enemyEntry,enemyDefinition,{random=Math.random,onShot=()=>{},onHit=()=>{},onPhysics=()=>{}}={}){
    this.player=new Combatant(playerEntry,playerDefinition,'player');
    this.enemy=new Combatant(enemyEntry,enemyDefinition,'enemy');this.actors=[this.player,this.enemy];
    this.ai=new NavalAI(random);this.time=0;this.projectiles=[];this.onShot=onShot;this.onHit=onHit;this.onPhysics=onPhysics;
  }
  get outcome(){
    if(!this.player.alive&&!this.enemy.alive)return 'draw';
    if(!this.player.alive)return 'defeat';if(!this.enemy.alive)return 'victory';return null;
  }
  lock(actor,target){if(actor.alive&&target.alive&&actor!==target){actor.lockedTarget=target;return true;}return false;}
  fireMissile(actor){
    const r=COMBAT_RULES.missile,target=actor.lockedTarget;
    if(!actor.alive||!target?.alive||!actor.missiles||this.time-actor.lastMissile<r.interval)return false;
    if(actor.physics.position.distanceTo(target.physics.position)>r.range)return false;
    actor.missiles--;actor.lastMissile=this.time;
    const origin=actor.physics.localToWorld(new THREE.Vector3(0,actor.spec.hullTopY+5,0),new THREE.Vector3());
    this.launch(actor,target,'missile',origin,new THREE.Vector3(0,1,0),r,this.time);return true;
  }
  launch(actor,target,kind,origin,direction,rule,at){
    const shot={actor,target,kind,position:origin.clone(),previous:origin.clone(),velocity:direction.clone().multiplyScalar(rule.speed),
      age:0,range:rule.range,speed:rule.speed,damage:rule.damage,at};
    this.projectiles.push(shot);actor.shots[kind]++;
    this.onShot({actor,kind,spec:kind==='missile'?null:rule.spec,origin:origin.clone(),direction:direction.clone(),recoilScale:kind==='shell'?actor.battery.options.recoilScale??0:0});
  }
  weapons(actor,target,command,start,end){
    const {profile,battery}=actor,dt=end-start;battery.elapsed=end;
    actor.aimYaw=wrapAngle(actor.aimYaw+(command.yaw??0)*dt*.8);
    actor.aimPitch=THREE.MathUtils.clamp(actor.aimPitch+(command.pitch??0)*dt*.6,-.6,.9);
    const ciwsWindows=actor.thermal.step(dt,!!command.ciws&&profile.ciwsMounts>0);
    const mainMounts=battery.mounts.filter(m=>m.spec.type==='main');
    const aligned=new Map();
    for(const m of battery.mounts.filter(m=>m.spec.type==='main'||m.spec.type==='ciws')){
      m.root.updateWorldMatrix(true,true);m.muzzles[0].getWorldPosition(m.origin);
      const type=m.spec.type==='ciws'?'ciws':'shell',r=type==='ciws'?COMBAT_RULES.ciws:profile.main;
      const point=leadPoint(m.origin,target.targetPoint(),target.physics.velocity,r.speed);
      const yaw=type==='ciws'?actor.aimYaw+(command.aimYaw??0):command.aimYaw??0;
      const pitch=type==='ciws'?actor.aimPitch+(command.aimPitch??0):command.aimPitch??0;
      const direction=point.clone().sub(m.origin).applyAxisAngle(UP,-yaw);
      const right=new THREE.Vector3().crossVectors(direction,UP).normalize();direction.applyAxisAngle(right,pitch);
      aligned.set(m,aimTurret(m,m.origin.clone().add(direction),dt,type==='ciws'?4.5:1.4));
    }
    const ready=mainMounts.every(m=>aligned.get(m)&&start>=m.lastShot+profile.main.interval-1e-8);
    const fireMain=(command.main||actor.mainAuto||actor.salvoRequested)&&(!profile.salvo||ready);
    for(const m of battery.mounts){
      const ciws=m.spec.type==='ciws',main=m.spec.type==='main';
      const r=ciws?COMBAT_RULES.ciws:profile.main;
      const firing=actor.alive&&target.alive&&(ciws?ciwsWindows.length>0:main&&fireMain&&aligned.get(m))&&m.origin.distanceTo(target.targetPoint())<=r.range;
      if(firing){
        const damage=ciws?r.damagePerSecond*r.interval/profile.ciwsMounts:profile.salvo?r.damage/profile.mainBarrels:r.damage;
        for(const [from,to] of ciws?ciwsWindows:[[0,dt]])fireWindow(m,start+from,start+to,r.interval,at=>{
          const muzzles=ciws?[m.muzzles[0]]:m.muzzles;
          for(const muzzle of muzzles){muzzle.getWorldPosition(m.origin);this.launch(actor,target,ciws?'ciws':'shell',m.origin,m.direction,{...r,damage,spec:m.spec},at);}
        });
      }
      animateTurret(m,end,dt,firing);
    }
    if(fireMain&&ready)actor.salvoRequested=false;
    if(command.missile)this.fireMissile(actor);
  }
  step(dt,playerCommand,field){
    if(this.outcome)return;
    const start=this.time,end=start+dt,enemyCommand=this.ai.update(start,this.enemy,this.player,this.projectiles);
    const commands=[playerCommand,enemyCommand];
    for(let i=0;i<this.actors.length;i++){
      const a=this.actors[i],c=commands[i];a.previous.copy(a.physics.position);
      a.physics.throttle=c.throttle;a.physics.rudder=c.rudder;a.physics.step(dt,field);this.onPhysics(a,dt);a.sync();
    }
    this.time=end;
    this.weapons(this.player,this.enemy,playerCommand,start,end);this.weapons(this.enemy,this.player,enemyCommand,start,end);
    const contacts=[];
    for(const s of this.projectiles){
      const travel=Math.min(dt,end-s.at);s.previous.copy(s.position);
      if(s.kind==='missile'){
        const point=leadPoint(s.position,s.target.targetPoint(),s.target.physics.velocity,s.speed);
        const distance=s.position.distanceTo(point);point.y+=Math.min(90,distance*.18);
        const wanted=point.sub(s.position).normalize(),heading=s.velocity.clone().normalize();
        const q=new THREE.Quaternion().setFromUnitVectors(heading,wanted),angle=heading.angleTo(wanted);
        q.slerp(new THREE.Quaternion(),1-Math.min(1,COMBAT_RULES.missile.turnRate*travel/Math.max(angle,1e-12)));
        s.velocity.applyQuaternion(q);
      }
      s.position.addScaledVector(s.velocity,travel);s.age+=travel;
      // Translate the start into the target's current frame: exact swept
      // translation for the integrator's piecewise-linear collision model.
      const from=s.previous.clone().addScaledVector(s.target.physics.position.clone().sub(s.target.previous),travel/dt),delta=s.position.clone().sub(from),length=delta.length();
      if(length>0&&s.target.alive){
        ray.set(from,delta.multiplyScalar(1/length));ray.near=0;ray.far=length;
        const hit=ray.intersectObject(s.target.collider,true)[0];
        if(hit)contacts.push({s,point:hit.point,at:end-travel+hit.distance/length*travel});
      }
    }
    contacts.sort((a,b)=>a.at-b.at);
    const consumed=new Set();
    for(const {s,point} of contacts){
      const amount=s.target.damage(s.damage);s.actor.damageDealt+=amount;s.actor.hits++;consumed.add(s);
      this.onHit({shot:s,point,amount,target:s.target});
    }
    this.projectiles=this.projectiles.filter(s=>!consumed.has(s)&&s.age*s.speed<s.range);
  }
  dispose(){for(const a of this.actors)a.dispose();this.projectiles.length=0;}
}
