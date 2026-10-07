/** Event placement, independent of wave sampling and vessel type. */
import * as THREE from 'three';
const PI=Math.PI;
export const SEA_STATE={hs:5.6,peakLength:92,spread:.52,
  directions:[{angle:0,weight:.42},{angle:PI,weight:.26},{angle:PI/2,weight:.16},{angle:-PI/2,weight:.16}]};
export const TSUNAMI_TIERS=Object.fromEntries(Object.entries({
  rogue:{label:'疯狗浪',hMin:4.7,hMax:5.3,danger:.4,thickness:76,spacing:98,speed:22,distance:100,lateralWidth:1300,storm:.68,
    groups:[{bearing:0,count:8,scale:1,decay:.97},{bearing:PI,count:6,scale:.95,decay:.97,phase:.5},{bearing:PI/2,count:6,scale:.82,decay:.97,phase:.25},{bearing:-PI/2,count:6,scale:.82,decay:.97,phase:.75}],
    warn:'四面密集碎浪，约 5 米浪头，保持舵效'},
  large:{label:'大型海啸',hMin:12,hMax:15,danger:.75,thickness:190,spacing:280,speed:24,distance:100,lateralWidth:2200,storm:.85,
    groups:[{bearing:0,count:3,scale:1,decay:.94},{bearing:PI,count:1,scale:.78,decay:1,phase:3},{bearing:PI/2,count:2,scale:.6,decay:.9,phase:-.5,stride:2},{bearing:-PI/2,count:2,scale:.6,decay:.9,phase:.5,stride:2}],
    warn:'十几米厚浪组成一组，侧后方伴随较低浪峰'},
  broad:{label:'30 米大浪',hMin:30,hMax:30,danger:.7,thickness:210,spacing:340,speed:18,distance:100,lateralWidth:2500,storm:.55,
    groups:[{bearing:0,count:3,scale:1,decay:.92},{bearing:PI,count:1,scale:.67,decay:1,phase:3},{bearing:PI/2,count:2,scale:.6,decay:.95,phase:-.5,stride:2},{bearing:-PI/2,count:2,scale:.6,decay:.95,phase:.5,stride:2}],
    warn:'210 米厚浪，前缘距船头 100 米；两侧伴随 17–18 米浪'},
}).map(([id,tier],i)=>[id,{id,key:String(i+1),...tier}]));

const forward=new THREE.Vector3(),side=new THREE.Vector3();
export function hullExtent(ship,dx,dz){
  forward.set(1,0,0).applyQuaternion(ship.quaternion);side.set(0,0,1).applyQuaternion(ship.quaternion);
  return Math.abs(forward.x*dx+forward.z*dz)*ship.vessel.length/2
    +Math.abs(side.x*dx+side.z*dz)*ship.vessel.beamWater/2;
}
export class TsunamiManager {
  constructor(field){this.field=field;this.state='idle';this.tier=null;this.height=0;this.dir=new THREE.Vector3(1,0,0);this.reset();}
  reset(){this.state='idle';this.peakRoll=0;this.peakPitch=0;this.worstUp=1;this.rollHistory=[];this.field.clearPackets();}
  get active(){return this.state==='inbound'||this.state==='active';}
  get danger(){return this.tier?.danger??0;}
  distanceToCrest(position){return this.active?this.field.distanceToCrest(position.x,position.z):Infinity;}
  trigger(id,ship,time){
    const tier=TSUNAMI_TIERS[id];if(!tier)return null;
    return this.triggerSpec(tier,ship,time);
  }
  triggerSpec(tier,ship,time,{height=tier.hMin+Math.random()*(tier.hMax-tier.hMin),heading=ship.heading,epicentre=null}={}){
    this.reset();this.tier=tier;this.height=height;
    this.dir.set(Math.cos(heading),0,Math.sin(heading));
    const origin=ship.localToWorld(new THREE.Vector3(),new THREE.Vector3());
    // Schedule secondary crests between primary crests. Opposing packets
    // must not coincide into an unintended 50+ m combined crest. The
    // first main front keeps its exact 100 m gap from the projected bow.
    const mainOffset=hullExtent(ship,this.dir.x,this.dir.z)+tier.thickness/2+tier.distance;
    const inputs=epicentre?Array.from({length:tier.count},(_,i)=>({kind:'radial',x:epicentre.x,z:epicentre.z,
      dirX:1,dirZ:0,height:height*tier.decay**i,thickness:tier.thickness,lateralWidth:tier.lateralWidth,speed:tier.speed,
      delay:i*tier.spacing/tier.speed})):tier.groups.flatMap(group=>Array.from({length:group.count},(_,index)=>{
      const angle=heading+group.bearing,dx=Math.cos(angle),dz=Math.sin(angle);
      const thickness=tier.thickness,offset=mainOffset+((group.phase??0)+index*(group.stride??1))*tier.spacing;
      return {x:origin.x+dx*offset,z:origin.z+dz*offset,dirX:dx,dirZ:dz,
        height:this.height*group.scale*group.decay**index,thickness,lateralWidth:tier.lateralWidth,speed:tier.speed};
    }));
    this.field.replacePackets(inputs);
    if(epicentre)this.dir.copy(epicentre).sub(origin).setY(0).normalize();
    this.state='inbound';this.tStart=time;return tier;
  }
  bearingFromBow(ship){
    forward.set(1,0,0).applyQuaternion(ship.quaternion);side.set(0,0,1).applyQuaternion(ship.quaternion);
    return Math.atan2(this.dir.dot(side),this.dir.dot(forward))*180/PI;
  }
  update(dt,time,ship,state){
    this.time=time;if(this.state==='idle')return;
    const origin=ship.localToWorld(new THREE.Vector3(),new THREE.Vector3());
    const distances=this.field.packets.map(p=>({p,d:p.distanceToCrest(origin.x,origin.z,this.field.time),
      extent:p.radial?Math.hypot(ship.vessel.length,ship.vessel.beamWater)/2:hullExtent(ship,p.dx,p.dz),
      outsideLateral:!p.radial&&Math.abs(p.coordinates(origin.x,origin.z,this.field.time)[1])>p.lateral+hullExtent(ship,-p.dz,p.dx)}));
    if(this.state==='inbound'&&distances.some(({p,d,extent})=>this.field.time>=p.t0&&d<p.leadingExtent+extent))this.state='active';
    if(this.state==='active'&&distances.every(({p,d,extent,outsideLateral})=>outsideLateral||d < -p.trailingExtent-extent)){this.state='clearing';this.clearingAt=time;}
    if(this.state==='clearing'&&time-this.clearingAt>4)this.state='idle';
    const a=state.attitude;this.peakRoll=Math.max(this.peakRoll,Math.abs(a.roll));this.peakPitch=Math.max(this.peakPitch,Math.abs(a.pitch));
    this.worstUp=Math.min(this.worstUp,a.up.y);this.rollHistory.push(a.roll);if(this.rollHistory.length>240)this.rollHistory.shift();
  }
}
