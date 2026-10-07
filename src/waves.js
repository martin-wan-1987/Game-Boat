/** Metres, seconds. One differentiable surface for geometry and hydrodynamics.
 * Ambient Gerstner spectrum plus finite C2 wave packets from any direction.
 * The packet basis and its derivatives below generate the JS and GLSL forms.
 */
export const G = 9.81;
export const MAX_SEA = 24;
export const MAX_PACKETS = 32;
const TAU = Math.PI * 2;
const POWER = 3;
const RING_GROWTH=2;
const LOBES = [{offset:0,width:1,weight:1},{offset:1.25,width:.45,weight:-.04}];
const FRONT = -Math.min(...LOBES.map(l=>l.offset-l.width));
const BACK = Math.max(...LOBES.map(l=>l.offset+l.width));
export const rand = (min,max)=>min+Math.random()*(max-min);
export const omegaOfK = k=>Math.sqrt(G*k);
export const phaseSpeed = length=>Math.sqrt(G*length/TAU);

function basis(x) {
  const q=Math.max(0,1-x*x);
  return [q**POWER,-2*POWER*x*q**(POWER-1)];
}
function profile(s,width) {
  let y=0,slope=0;
  for(const l of LOBES){
    const [f,d]=basis((s/width-l.offset)/l.width);
    y+=l.weight*f;slope+=l.weight*d/(width*l.width);
  }
  return [y,slope];
}

export class WavePacket {
  constructor({x,z,dirX,dirZ,height,thickness,lateralWidth,speed,t0=0,kind='plane'}) {
    const n=Math.hypot(dirX,dirZ);
    this.dx=dirX/n;this.dz=dirZ/n;this.x=x;this.z=z;
    this.height=height;this.width=thickness/2;this.lateral=lateralWidth/2;
    this.speed=speed;this.t0=t0;
    this.radial=kind==='radial';
  }
  get leadingExtent(){return FRONT*this.width;}
  get trailingExtent(){return BACK*this.width;}
  coordinates(x,z,t){
    const px=x-this.x,pz=z-this.z;
    if(this.radial)return [this.trailingExtent+this.speed*(t-this.t0)-Math.hypot(px,pz),0];
    return [px*this.dx+pz*this.dz+this.speed*(t-this.t0),-px*this.dz+pz*this.dx];
  }
  distanceToCrest(x,z,t){return -this.coordinates(x,z,t)[0];}
  sample(x,z,t,out){
    out.y=out.dx=out.dz=out.vy=0;
    if(this.radial&&t<this.t0)return out;
    const px=x-this.x,pz=z-this.z,radius=this.radial?Math.hypot(px,pz):0;
    const s=this.radial?this.trailingExtent+this.speed*(t-this.t0)-radius:px*this.dx+pz*this.dz+this.speed*(t-this.t0);
    const r=this.radial?0:-px*this.dz+pz*this.dx;
    if(s<=-this.leadingExtent||s>=this.trailingExtent||Math.abs(r)>=this.lateral)return out;
    const [eta,ds]=profile(s,this.width),[cross,dr]=basis(r/this.lateral);
    // An emitted ring starts with its rear support outside the origin.
    // Every active point therefore has radius > 0, including at birth.
    const dx=this.radial?-px/radius:this.dx,dz=this.radial?-pz/radius:this.dz;
    const u=Math.max(0,Math.min(1,(t-this.t0)/RING_GROWTH));
    const strength=this.radial?u**3*(10-15*u+6*u*u):1;
    const growth=this.radial?30*u*u*(1-u)**2/RING_GROWTH:0;
    const along=this.height*ds*cross*strength,across=this.radial?0:this.height*eta*dr/this.lateral;
    out.y=this.height*eta*cross*strength;out.dx=along*dx-across*dz;out.dz=along*dz+across*dx;out.vy=along*this.speed+this.height*eta*cross*growth;
    return out;
  }
}

/** H(b) = b + sum(Q A d cos(phi)), with its analytic Jacobian.
 * The jet is scratch for one query, never a time/position-keyed cache.
 * Its phase terms also generate the vertical surface, so a Newton inverse
 * and its final surface evaluation do not repeat trigonometric work. */
function horizontalSea(field,bx,bz,jet) {
  let px=bx,pz=bz,txx=1,txz=0,tzx=0,tzz=1;
  for(let i=0;i<field.sea.length;i++){
    const w=field.sea[i],A=w.amp*field.agitation,QA=w.steep*A;
    const f=w.k*(w.dx*bx+w.dz*bz)-w.omega*field.time+w.phase,S=Math.sin(f),C=Math.cos(f);
    jet.phases[i*3]=A;jet.phases[i*3+1]=S;jet.phases[i*3+2]=C;
    px+=QA*w.dx*C;pz+=QA*w.dz*C;
    txx-=QA*w.k*w.dx*w.dx*S;txz-=QA*w.k*w.dx*w.dz*S;
    tzx-=QA*w.k*w.dx*w.dz*S;tzz-=QA*w.k*w.dz*w.dz*S;
  }
  jet.x=px;jet.z=pz;jet.txx=txx;jet.txz=txz;jet.tzx=tzx;jet.tzz=tzz;
  jet.jac=txx*tzz-txz*tzx;
  return jet;
}

/** Complete the same surface from its horizontal jet. Packets contribute
 * only vertically; their height, slopes and velocity are evaluated once. */
function surfaceFromJet(field,bx,bz,out,jet) {
  const {x:px,z:pz,txx,txz,tzx,tzz}=jet;
  let py=0,vx=0,vy=0,vz=0,txy=0,tzy=0,eventY=0;
  for(let i=0;i<field.sea.length;i++){
    const w=field.sea[i],A=jet.phases[i*3],S=jet.phases[i*3+1],C=jet.phases[i*3+2],QA=w.steep*A;
    py+=A*S;txy+=A*w.k*w.dx*C;tzy+=A*w.k*w.dz*C;
    vx+=QA*w.dx*w.omega*S;vz+=QA*w.dz*w.omega*S;vy-=A*w.omega*C;
  }
  for(const p of field.packets){
    const pulse=p.sample(bx,bz,field.time,field._pulse);
    py+=pulse.y;eventY+=pulse.y;txy+=pulse.dx;tzy+=pulse.dz;vy+=pulse.vy;
  }
  const nx=tzy*txz-tzz*txy,ny=tzz*txx-tzx*txz,nz=tzx*txy-tzy*txx;
  const length=Math.hypot(nx,ny,nz);
  Object.assign(out,{x:px,y:py,z:pz,nx:nx/length,ny:ny/length,nz:nz/length,vx,vy,vz,
    jac:txx*tzz-txz*tzx,txx,txz,tzx,tzz,eventY});return out;
}

export class WaveField {
  constructor(){this.sea=[];this.packets=[];this.time=0;this.agitation=1;this._seaJet={phases:new Float64Array(MAX_SEA*3)};this._pulse={};}
  /** Direction weights partition spectrum energy, not wave height. */
  buildSea(hs,dirX,dirZ,spread=.5,peakLen=90,directions=[{angle:0,weight:1}]) {
    this.sea.length=0;
    const wp=Math.sqrt(TAU*G/peakLen),base=Math.atan2(dirZ,dirX);
    const n=MAX_SEA/directions.length,ratio=(3.4/.34)**(1/(n-1));
    for(const sector of directions)for(let i=0;i<n;i++) {
      const omega=wp*.34*ratio**i,dw=omega*(ratio-1)*.9;
      const spectrum=.0081*G*G/omega**5*Math.exp(-1.25*(wp/omega)**4);
      const angle=base+sector.angle+rand(-spread,spread),k=omega*omega/G;
      this.sea.push({dx:Math.cos(angle),dz:Math.sin(angle),amp:Math.sqrt(2*spectrum*dw*sector.weight),
        k,omega,phase:rand(0,TAU),steep:rand(.5,.8),len:TAU/k});
    }
    this.calibrateSea(hs);return this;
  }
  calibrateSea(hs){
    const m0=this.sea.reduce((sum,w)=>sum+w.amp*w.amp/2,0);
    if(m0===0)return;
    const scale=hs/(4*Math.sqrt(m0));for(const w of this.sea)w.amp*=scale;
    // A contraction bound for the horizontal map, so its inverse is unique.
    const contraction=this.sea.reduce((sum,w)=>sum+w.steep*w.amp*w.k,0);
    const horizontal=Math.min(1,.42/contraction);
    for(const w of this.sea)w.steep*=horizontal;
  }
  get significantSeaHeight(){return 4*Math.sqrt(this.sea.reduce((s,w)=>s+w.amp*w.amp/2,0))*this.agitation;}
  replacePackets(inputs){
    if(inputs.length>MAX_PACKETS)throw new RangeError(`Wave packet capacity ${MAX_PACKETS}`);
    this.packets=inputs.map(o=>new WavePacket({...o,t0:this.time+(o.delay??0)}));return this.packets;
  }
  clearPackets(){this.packets.length=0;}
  /** Normalized local encounter with an event of at least minHeight. */
  encounterAt(x,z,minHeight){
    let peak=0;for(const packet of this.packets)peak=Math.max(peak,packet.height);
    if(peak<minHeight||peak===0)return 0;
    const q=Math.max(0,Math.min(1,this.sampleWorld(x,z,this._encounter??(this._encounter={})).eventY/peak));
    return q*q*(3-2*q);
  }
  distanceToCrest(x,z){return this.packets.length?this.packets[0].distanceToCrest(x,z,this.time):Infinity;}
  eventHeightAt(x,z,t=this.time){
    let y=0;
    for(const p of this.packets)y+=p.sample(x,z,t,this._pulse).y;
    return y;
  }
  update(dt){this.time+=dt;}

  sampleBase(bx,bz,out){
    return surfaceFromJet(this,bx,bz,out,horizontalSea(this,bx,bz,this._seaJet));
  }
  /** Newton inverse of H. The injective horizontal Gerstner map excludes
   * the purely vertical packets; complete their surface only at H^-1(x,z). */
  sampleWorld(x,z,out){
    let bx=x,bz=z;const jet=horizontalSea(this,bx,bz,this._seaJet);
    for(let i=0;i<8;i++){
      const ex=jet.x-x,ez=jet.z-z;
      if(Math.abs(ex)+Math.abs(ez)<.0001)break;
      bx-=(jet.tzz*ex-jet.txz*ez)/jet.jac;bz-=(-jet.tzx*ex+jet.txx*ez)/jet.jac;
      horizontalSea(this,bx,bz,jet);
    }
    return surfaceFromJet(this,bx,bz,out,jet);
  }
  heightAt(x,z){return this.sampleWorld(x,z,this._height??(this._height={})).y;}
}

const PULSE_GLSL=LOBES.map(l=>`{
  float u=(s/width-${l.offset.toFixed(8)})/${l.width.toFixed(8)};
  float q=max(0.0,1.0-u*u);
  eta+=${l.weight.toFixed(8)}*pow(q,${POWER.toFixed(1)});
  ds+=${(-2*POWER*l.weight).toFixed(8)}*u*pow(q,${(POWER-1).toFixed(1)})/(width*${l.width.toFixed(8)});
}`).join('\n');
export function glslWaves(){return /* glsl */`
#define MAX_SEA ${MAX_SEA}
#define MAX_PACKETS ${MAX_PACKETS}
uniform int uSeaCount,uPacketCount;
uniform vec4 uSeaA[MAX_SEA],uSeaB[MAX_SEA];
uniform vec4 uPacketA[MAX_PACKETS]; // origin XZ, direction XZ
uniform vec4 uPacketB[MAX_PACKETS]; // height, half thickness, half lateral width, speed
uniform float uPacketT0[MAX_PACKETS];
uniform float uPacketMode[MAX_PACKETS];
uniform float uTime,uCamDist,uAgit;
struct WaveSample {vec3 pos;vec3 nrm;vec3 vel;float jac;};
WaveSample sampleWaves(vec2 p){
  vec3 pos=vec3(p.x,0.0,p.y),vel=vec3(0.0);
  float txx=1.0,txz=0.0,txy=0.0,tzx=0.0,tzz=1.0,tzy=0.0;
  for(int i=0;i<MAX_SEA;i++){
    if(i>=uSeaCount)break;
    vec4 A=uSeaA[i],B=uSeaB[i];float amp=A.z*uAgit,QA=A.w*amp;
    float f=B.x*dot(A.xy,p)-B.y*uTime+B.z,S=sin(f),C=cos(f);
    pos.xz+=QA*A.xy*C;pos.y+=amp*S;
    txx-=QA*B.x*A.x*A.x*S;txz-=QA*B.x*A.x*A.y*S;
    tzx-=QA*B.x*A.x*A.y*S;tzz-=QA*B.x*A.y*A.y*S;
    txy+=amp*B.x*A.x*C;tzy+=amp*B.x*A.y*C;
    vel.xz+=QA*A.xy*B.y*S;vel.y-=amp*B.y*C;
  }
  for(int i=0;i<MAX_PACKETS;i++){
    if(i>=uPacketCount)break;
    if(uPacketMode[i]>.5&&uTime<uPacketT0[i])continue;
    vec4 A=uPacketA[i],B=uPacketB[i];vec2 d=A.zw,side=vec2(-d.y,d.x),delta=p-A.xy;
    bool radial=uPacketMode[i]>.5;float radius=radial?length(delta):0.0,width=B.y;
    float s=radial?${BACK.toFixed(8)}*width+B.w*(uTime-uPacketT0[i])-radius:dot(delta,d)+B.w*(uTime-uPacketT0[i]);
    float r=radial?0.0:dot(delta,side);
    if(s<=-${FRONT.toFixed(8)}*width || s>=${BACK.toFixed(8)}*width || abs(r)>=B.z)continue;
    if(radial){d=-delta/radius;side=vec2(-d.y,d.x);}
    float eta=0.0,ds=0.0;
    ${PULSE_GLSL}
    float v=r/B.z,q=max(0.0,1.0-v*v),crossProfile=pow(q,${POWER.toFixed(1)});
    float dr=-${(2*POWER).toFixed(1)}*v*pow(q,${(POWER-1).toFixed(1)})/B.z;
    float growthTime=clamp((uTime-uPacketT0[i])/${RING_GROWTH.toFixed(1)},0.0,1.0);
    float strength=radial?pow(growthTime,3.0)*(10.0-15.0*growthTime+6.0*growthTime*growthTime):1.0;
    float growth=radial?30.0*growthTime*growthTime*pow(1.0-growthTime,2.0)/${RING_GROWTH.toFixed(1)}:0.0;
    float along=B.x*ds*crossProfile*strength,across=radial?0.0:B.x*eta*dr;
    pos.y+=B.x*eta*crossProfile*strength;txy+=along*d.x+across*side.x;tzy+=along*d.y+across*side.y;
    vel.y+=along*B.w+B.x*eta*crossProfile*growth;
  }
  WaveSample o;o.pos=pos;o.vel=vel;o.nrm=normalize(cross(vec3(tzx,tzy,tzz),vec3(txx,txy,txz)));
  o.jac=txx*tzz-txz*tzx;return o;
}`;}
export function makeWaveUniforms(THREE){
  const arr=n=>Array.from({length:n},()=>new THREE.Vector4());
  return {uSeaCount:{value:0},uSeaA:{value:arr(MAX_SEA)},uSeaB:{value:arr(MAX_SEA)},
    uPacketCount:{value:0},uPacketA:{value:arr(MAX_PACKETS)},uPacketB:{value:arr(MAX_PACKETS)},
    uPacketT0:{value:new Float32Array(MAX_PACKETS)},uPacketMode:{value:new Float32Array(MAX_PACKETS)},uTime:{value:0},uCamDist:{value:0},uAgit:{value:1}};
}
export function applyWaveUniforms(u,field){
  u.uSeaCount.value=field.sea.length;
  field.sea.forEach((w,i)=>{u.uSeaA.value[i].set(w.dx,w.dz,w.amp,w.steep);u.uSeaB.value[i].set(w.k,w.omega,w.phase,0);});
  u.uPacketCount.value=field.packets.length;
  field.packets.forEach((p,i)=>{u.uPacketA.value[i].set(p.x,p.z,p.dx,p.dz);u.uPacketB.value[i].set(p.height,p.width,p.lateral,p.speed);u.uPacketT0.value[i]=p.t0;u.uPacketMode.value[i]=Number(p.radial);});
  u.uTime.value=field.time;u.uAgit.value=field.agitation;
}
