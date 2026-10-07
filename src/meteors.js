import * as THREE from 'three';
import {G,rand} from './waves.js';
import {hullExtent} from './tsunami.js';

export function meteorWave(height){return {id:'meteor',label:'陨石冲击海啸',hMin:height,hMax:height,danger:1,
  thickness:Math.max(230,height*6),spacing:Math.max(230,height*6)*1.5,speed:32,lateralWidth:14000,
  count:3,decay:.82,storm:.95,warn:'环形浪由陨石落点向外传播'};}

function stoneGeometry(){
  const geometry=new THREE.IcosahedronGeometry(1,2),p=geometry.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),shape=.74+.18*Math.sin(x*11.3+y*7.7+z*13.1)+.08*Math.cos(x*19.9-z*9.3);
    p.setXYZ(i,x*shape,y*shape,z*shape);
  }
  geometry.computeVertexNormals();return geometry;
}
const up=new THREE.Vector3(0,1,0),direction=new THREE.Vector3(),matrix=new THREE.Matrix4(),point=new THREE.Vector3();
/** Ballistic rocks, with one irregular visible surface and real swept hull
 * intersections. Impact resolution follows projectile interception so the
 * earliest collision in a step decides whether the fragment reaches a hull. */
export class Meteors {
  constructor(){
    this.rocks=[];this.sequence=0;this.elapsed=0;this.stats={launched:0,intercepted:0,hullHits:0,seaHits:0};
    this.group=new THREE.Group();this.group.name='Meteor shower';this.group.userData.dynamic=true;
    const max=18,rockMaterial=new THREE.MeshStandardMaterial({color:0x4d453d,roughness:.94,metalness:.04,
      emissive:0x87391b,emissiveIntensity:.32});
    this.stones=new THREE.InstancedMesh(stoneGeometry(),rockMaterial,max);this.stones.count=0;this.stones.frustumCulled=false;
    this.stones.castShadow=true;this.group.add(this.stones);
    this.tailMaterial=new THREE.ShaderMaterial({uniforms:{uMeteorTime:{value:0}},transparent:true,depthWrite:false,
      blending:THREE.AdditiveBlending,side:THREE.DoubleSide,toneMapped:false,
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}',
      fragmentShader:`varying vec2 vUv;uniform float uMeteorTime;void main(){
        float flame=pow(1.0-vUv.y,1.6),noise=.7+.3*sin(vUv.y*45.0-uMeteorTime*27.0+vUv.x*19.0);
        vec3 colour=mix(vec3(3.2,2.0,.9),vec3(1.7,.17,.025),vUv.y);
        gl_FragColor=vec4(colour,flame*noise*.65);
      }`});
    this.tails=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,12,6,true),this.tailMaterial,max);
    this.tails.count=0;this.tails.frustumCulled=false;this.group.add(this.tails);
    this.ray=new THREE.Raycaster();
  }
  get active(){return this.rocks.some(r=>r.active);}
  get fragments(){return this.rocks.filter(r=>r.active&&r.kind==='fragment');}
  reset(){this.rocks.length=0;this.elapsed=0;this.stones.count=this.tails.count=0;this.stats={launched:0,intercepted:0,hullHits:0,seaHits:0};}
  add(kind,start,end,duration,radius,waveHeight=0){
    // end = start + v*T - g*T²/2, hence v_y includes +g*T/2.
    const velocity=end.clone().sub(start).divideScalar(duration);velocity.y+=.5*G*duration;
    const rock={id:++this.sequence,kind,position:start.clone(),previous:start.clone(),velocity,radius,waveHeight,
      active:true,age:0,rotation:new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0,6),rand(0,6),rand(0,6))),
      spin:new THREE.Vector3(rand(-.7,.7),rand(-.7,.7),rand(-.7,.7)),impactFraction:null,pending:null};
    this.rocks.push(rock);return rock;
  }
  launch(ship,height,time){
    if(this.active)throw new Error('A meteor shower is already in flight');
    this.rocks.length=0;const wave=meteorWave(height),angle=ship.heading+rand(-Math.PI,Math.PI),dx=Math.cos(angle),dz=Math.sin(angle);
    const distance=wave.thickness*1.35+hullExtent(ship,dx,dz)+100;
    const impact=new THREE.Vector3(ship.position.x+dx*distance,0,ship.position.z+dz*distance),duration=rand(12,16);
    const start=impact.clone().add(new THREE.Vector3(-dx*900,rand(1600,2100),-dz*900));
    this.add('main',start,impact,duration,rand(13,22),height);
    if(ship.vessel.weapons.some(w=>w.type==='ciws')){
      const count=10+Math.floor(rand(0,7));
      for(let i=0;i<count;i++){
        const flight=rand(8,13),x=rand(-.36,.36)*ship.vessel.length,z=rand(-.32,.32)*ship.vessel.beamWater;
        const end=ship.localToWorld(new THREE.Vector3(x,ship.vessel.deckY+1,z),new THREE.Vector3()).addScaledVector(ship.velocity,flight);
        const from=end.clone().add(new THREE.Vector3(rand(-190,190),rand(560,950),rand(-190,190)));
        this.add('fragment',from,end,flight,rand(.65,1.5));
      }
    }
    this.stats.launched++;this.sync(time);return {height,count:this.fragments.length,impact:impact.toArray()};
  }
  prepare(dt,field,shipMesh){
    this.elapsed+=dt;shipMesh.updateWorldMatrix(true,true);
    for(const rock of this.rocks){
      if(!rock.active)continue;
      rock.previous.copy(rock.position);rock.position.addScaledVector(rock.velocity,dt);rock.position.y-=.5*G*dt*dt;
      rock.velocity.y-=G*dt;rock.age+=dt;rock.pending=null;rock.impactFraction=null;
      rock.rotation.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rock.spin.x*dt,rock.spin.y*dt,rock.spin.z*dt))).normalize();
      direction.copy(rock.position).sub(rock.previous);const length=direction.length();direction.divideScalar(length);
      if(rock.kind==='fragment'){
        this.ray.set(rock.previous,direction);this.ray.near=0;this.ray.far=length;
        const hit=this.ray.intersectObject(shipMesh,true).find(h=>!h.object.material.transparent);
        if(hit){rock.impactFraction=hit.distance/length;rock.pending={kind:'hull',point:hit.point};}
      }
      const before=rock.previous.y-field.heightAt(rock.previous.x,rock.previous.z),after=rock.position.y-field.heightAt(rock.position.x,rock.position.z);
      if(after<=0){
        let low=0,high=1;
        if(before>0)for(let i=0;i<12;i++){
          const mid=(low+high)/2;point.copy(rock.previous).lerp(rock.position,mid);point.y+=.5*G*dt*dt*mid*(1-mid);
          if(point.y>field.heightAt(point.x,point.z))low=mid;else high=mid;
        }
        const fraction=before>0?(low+high)/2:0;
        if(rock.impactFraction===null||fraction<rock.impactFraction){
          const contact=rock.previous.clone().lerp(rock.position,fraction);contact.y=field.heightAt(contact.x,contact.z);
          rock.impactFraction=fraction;rock.pending={kind:'sea',point:contact};
        }
      }
    }
  }
  intercept(rock,particles,position=rock.position){
    if(!rock.active)return;
    rock.active=false;this.stats.intercepted++;
    for(let i=0;i<8;i++)particles.spawn(position.x,position.y,position.z,rand(-12,12),rand(-5,12),rand(-12,12),.6,rand(.6,1.4),2);
  }
  resolve({onSea,onHull,particles,time}){
    for(const rock of this.rocks){
      if(!rock.active||!rock.pending)continue;
      rock.active=false;const impact=rock.pending.point;
      if(rock.pending.kind==='hull'){this.stats.hullHits++;onHull(rock,impact);}
      else {
        this.stats.seaHits++;
        if(rock.kind==='main'){
          onSea(rock,impact);
          for(let i=0;i<220;i++){
            const angle=rand(0,Math.PI*2),out=rand(12,36),vy=rand(18,48);
            particles.spawn(impact.x+rand(-15,15),impact.y+1,impact.z+rand(-15,15),Math.cos(angle)*out,vy,Math.sin(angle)*out,2*vy/G+1,rand(3,8),0);
          }
        }
      }
    }
    this.sync(time);
  }
  warmup(on){
    if(on){const transform=new THREE.Matrix4().makeTranslation(0,1500,0);this.stones.setMatrixAt(0,transform);this.tails.setMatrixAt(0,transform);this.stones.count=this.tails.count=1;}
    else this.stones.count=this.tails.count=0;
  }
  sync(time){
    this.tailMaterial.uniforms.uMeteorTime.value=time;
    let count=0;
    for(const rock of this.rocks){
      if(!rock.active)continue;
      matrix.compose(rock.position,rock.rotation,point.set(rock.radius,rock.radius*.86,rock.radius*.73));this.stones.setMatrixAt(count,matrix);
      direction.copy(rock.velocity).normalize().negate();const length=rock.kind==='main'?210:Math.min(38,rock.radius*20);
      point.copy(rock.position).addScaledVector(direction,length*.48);
      const q=new THREE.Quaternion().setFromUnitVectors(up,direction);
      matrix.compose(point,q,new THREE.Vector3(rock.radius*1.35,length,rock.radius*1.35));this.tails.setMatrixAt(count,matrix);count++;
    }
    this.stones.count=this.tails.count=count;this.stones.instanceMatrix.needsUpdate=this.tails.instanceMatrix.needsUpdate=true;
  }
}
