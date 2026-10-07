import * as THREE from 'three';
import {glslWaves} from './waves.js';
const TAU=Math.PI*2,UP=new THREE.Vector3(0,1,0);
/** One terrain description drives the mesh, shore foam, land exclusion and
 * contact normals. Positions are shared by free and random sea modes. */
export const ISLANDS=[
  {x:900,z:-560,radius:275,height:92,phase:.7},
  {x:2200,z:920,radius:610,height:185,phase:2.1},
  {x:-1500,z:450,radius:340,height:115,phase:4.0},
  {x:350,z:-1810,radius:480,height:160,phase:1.6},
  {x:-1050,z:-1650,radius:160,height:55,phase:3.3},
  {x:3100,z:-1700,radius:360,height:118,phase:5.4},
  {x:-3250,z:1600,radius:690,height:210,phase:1.0},
  {x:650,z:2380,radius:205,height:72,phase:4.5},
];
const profile=[[-.08,1.08],[0,1],[.03,.997],[.10,.965],[.40,.85],[.75,.52],[1,.025]];
const fract=v=>v-Math.floor(v),hash=(x,z)=>fract(Math.sin(x*127.1+z*311.7)*43758.5453123);
function noise(x,z){
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,a=fx*fx*(3-2*fx),b=fz*fz*(3-2*fz);
  return (hash(ix,iz)*(1-a)+hash(ix+1,iz)*a)*(1-b)+(hash(ix,iz+1)*(1-a)+hash(ix+1,iz+1)*a)*b;
}
function relief(x,z,phase){
  let sum=0,weight=.57,frequency=1;
  for(let octave=0;octave<5;octave++){sum+=weight*(noise(x*frequency+phase*7,z*frequency-phase*3)-.5);frequency*=2.08;weight*=.47;}
  return sum;
}
export function shoreRadius(I,a){return I.radius*(1+.085*Math.sin(3*a+I.phase)+.045*Math.cos(5*a-I.phase));}
export function shoreDerivative(I,a){return I.radius*(.255*Math.cos(3*a+I.phase)-.225*Math.sin(5*a-I.phase));}
export function terrainHeight(I,x,z){
  const dx=x-I.x,dz=z-I.z,r=Math.hypot(dx,dz)/shoreRadius(I,Math.atan2(dz,dx));
  let height=I.height;
  for(let i=1;i<profile.length;i++){
    const a=profile[i-1],b=profile[i];
    if(r>=b[1]){height=I.height*(a[0]+(b[0]-a[0])*(a[1]-r)/(a[1]-b[1]));break;}
  }
  return height+I.height*.55*Math.max(0,1-r)**.75*relief(dx/I.radius*4,dz/I.radius*4,I.phase);
}
export const islandGLSL=()=>`
uniform vec4 uIslands[${ISLANDS.length}];uniform float uIslandPhases[${ISLANDS.length}];
bool islandWater(vec2 p){
  for(int i=0;i<${ISLANDS.length};i++){
    vec2 d=p-uIslands[i].xy;float r=uIslands[i].z;
    if(dot(d,d)>r*r*1.28)continue;
    float a=atan(d.y,d.x),edge=r*(1.0+.085*sin(3.0*a+uIslandPhases[i])+.045*cos(5.0*a-uIslandPhases[i]));
    if(dot(d,d)<edge*edge)return true;
  }
  return false;
}`;
export class Islands {
  constructor(waveUniforms,foamTexture){
    this.group=new THREE.Group();this.group.name='Rocky island archipelago';
    this.uniforms={uIslands:{value:ISLANDS.map(I=>new THREE.Vector4(I.x,I.z,I.radius,I.height))},uIslandPhases:{value:ISLANDS.map(I=>I.phase)}};
    const bumpPixels=new Uint8Array(256*256*4);
    for(let z=0;z<256;z++)for(let x=0;x<256;x++){const i=(z*256+x)*4,value=Math.round(110+70*relief(x/22,z/22,2));bumpPixels.set([value,value,value,255],i);}
    const bump=new THREE.DataTexture(bumpPixels,256,256);bump.wrapS=bump.wrapT=THREE.RepeatWrapping;bump.needsUpdate=true;
    const rock=new THREE.MeshStandardMaterial({name:'Eroded coastal terrain',vertexColors:true,roughness:.94,metalness:.01,bumpMap:bump,bumpScale:.45});
    const n=128,rings=56,foamPos=[],foamUV=[],foamIndices=[],treeSites=[],rockSites=[];
    for(const I of ISLANDS){
      const positions=[],colours=[],uvs=[],indices=[];
      for(let j=0;j<=rings;j++)for(let i=0;i<=n;i++){
        const a=i/n*TAU,r=shoreRadius(I,a)*(.012+1.068*(1-j/rings)),x=I.x+Math.cos(a)*r,z=I.z+Math.sin(a)*r,y=terrainHeight(I,x,z);
        positions.push(x,y,z);uvs.push(x/55,z/55);
        const slope=Math.hypot(terrainHeight(I,x+2,z)-terrainHeight(I,x-2,z),terrainHeight(I,x,z+2)-terrainHeight(I,x,z-2))/4;
        const moss=Math.max(0,1-slope*.95)*Math.min(1,Math.max(0,(y-6)/22))*(.55+.45*noise(x/25,z/25));
        const variation=.035*(noise(x/9,z/9)-.5),wet=1-(1-Math.min(1,Math.max(0,y/9)))*.28;
        colours.push((.36+variation-moss*.16)*wet,(.37+variation-moss*.05)*wet,(.34+variation-moss*.18)*wet);
        if(j<rings&&i<n){const b=j*(n+1)+i;indices.push(b,b+n+1,b+1,b+1,b+n+1,b+n+2);}
      }
      const centre=positions.length/3;positions.push(I.x,terrainHeight(I,I.x,I.z),I.z);colours.push(.32,.35,.27);uvs.push(I.x/55,I.z/55);
      const top=rings*(n+1);for(let i=0;i<n;i++)indices.push(centre,top+i+1,top+i);
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();
      const land=new THREE.Mesh(geo,rock);land.castShadow=land.receiveShadow=true;this.group.add(land);
      for(let k=0;k<Math.ceil(I.radius*I.radius*.006);k++){
        const a=hash(k,I.phase)*TAU,r=I.radius*Math.sqrt(hash(I.phase,k+21))*.97,x=I.x+Math.cos(a)*r,z=I.z+Math.sin(a)*r,y=terrainHeight(I,x,z);
        const slope=Math.hypot(terrainHeight(I,x+2,z)-y,terrainHeight(I,x,z+2)-y)/2;
        if(y>7&&y<I.height*.65&&slope<.72&&hash(k+12,I.phase)<.24)treeSites.push({x,y,z,scale:4.5+hash(k+15,I.phase)*4.5,angle:a});
        else if(y>1&&y<I.height*.8&&hash(k+16,I.phase)<.13)rockSites.push({x,y,z,scale:2.3+hash(k+17,I.phase)*6,angle:a});
      }
      const base=foamPos.length/3;
      for(let i=0;i<=n;i++)for(const distance of [1.2,20]){
        const a=i/n*TAU,r=shoreRadius(I,a)+distance;
        foamPos.push(I.x+Math.cos(a)*r,0,I.z+Math.sin(a)*r);foamUV.push(a*I.radius/12,(distance-1.2)/18.8);
        if(i<n&&distance===1.2){const b=base+2*i;foamIndices.push(b,b+1,b+2,b+1,b+3,b+2);}
      }
    }
    const trunkMat=new THREE.MeshStandardMaterial({color:0x5a4a36,roughness:.96}),leafMat=new THREE.MeshStandardMaterial({color:0x375032,roughness:.94}),boulderMat=new THREE.MeshStandardMaterial({color:0x65716b,roughness:.96,bumpMap:bump,bumpScale:.18});
    const matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),scale=new THREE.Vector3();
    const instances=(geometry,material,sites,transform)=>{
      const batch=new THREE.InstancedMesh(geometry,material,sites.length);sites.forEach((site,i)=>{
        transform(site,p,scale);q.setFromAxisAngle(UP,site.angle);matrix.compose(p,q,scale);batch.setMatrixAt(i,matrix);
        batch.setColorAt(i,new THREE.Color().setScalar(.78+hash(i,site.x)*.32));
      });batch.castShadow=batch.receiveShadow=true;this.group.add(batch);return batch;
    };
    instances(new THREE.CylinderGeometry(.035,.065,.70,9),trunkMat,treeSites,(s,p,k)=>{p.set(s.x,s.y+s.scale*.35,s.z);k.setScalar(s.scale);});
    for(let layer=0;layer<3;layer++)instances(new THREE.IcosahedronGeometry(.32,1),leafMat,treeSites,(s,p,k)=>{
      const angle=s.angle+layer*2.1;p.set(s.x+Math.cos(angle)*s.scale*.12,s.y+s.scale*(.60+layer*.11),s.z+Math.sin(angle)*s.scale*.12);k.set(s.scale*.95,s.scale*(1.08-layer*.09),s.scale*.82);
    });
    instances(new THREE.DodecahedronGeometry(1,1),boulderMat,rockSites,(s,p,k)=>{p.set(s.x,s.y+s.scale*.29,s.z);k.set(s.scale,s.scale*.7,s.scale*.84);});
    this.scenery={trees:treeSites.length,rocks:rockSites.length};
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(foamPos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(foamUV,2));geo.setIndex(foamIndices);
    const mat=new THREE.ShaderMaterial({name:'Wave wash at rock walls',uniforms:{...waveUniforms,uShoreFoam:{value:foamTexture},uShoreNight:{value:0}},transparent:true,depthWrite:false,side:THREE.DoubleSide,
      vertexShader:`${glslWaves()} varying vec2 vUV;varying float vWash;varying vec3 vShore;
      void main(){WaveSample s=sampleWaves(position.xz);vUV=uv;vWash=clamp(.25+max(0.0,s.pos.y)*.11+length(s.nrm.xz)*.8,0.0,1.0);vShore=s.pos;
        gl_Position=projectionMatrix*viewMatrix*vec4(s.pos+vec3(0,.09,0),1);}`,
      fragmentShader:`uniform sampler2D uShoreFoam;uniform float uShoreNight,uTime;varying vec2 vUV;varying float vWash;varying vec3 vShore;
      void main(){float wash=texture2D(uShoreFoam,vec2(vUV.x-uTime*.12,vUV.y*1.4+uTime*.08)).a;
        float fade=1.0-smoothstep(.08,.95,vUV.y);gl_FragColor=vec4(vec3(.82,.87,.88)*(1.0-uShoreNight*.68),wash*fade*vWash*.9);}`});
    this.foam=new THREE.Mesh(geo,mat);this.foam.frustumCulled=false;this.foam.renderOrder=2;this.group.add(this.foam);
    this._position=new THREE.Vector3();this._normal=new THREE.Vector3();this._lever=new THREE.Vector3();this._cross=new THREE.Vector3();this._velocity=new THREE.Vector3();this._impulse=new THREE.Vector3();
    this.sprayDebt=0;
  }
  /** Frictionless normal contact impulse with angular effective mass. A
   * penetration bias separates the hull without teleporting its transform. */
  collide(physics,dt){
    const S=physics.vessel,p=this._position;
    let depth=0;
    for(const I of ISLANDS){
      if(Math.hypot(physics.position.x-I.x,physics.position.z-I.z)>I.radius*1.13+S.length/2)continue;
      for(const [x,z] of S.deckOutline){
        physics.localToWorld(p.set(x,-S.draft*.2,z),p);
        const dx=p.x-I.x,dz=p.z-I.z,a=Math.atan2(dz,dx),r=shoreRadius(I,a),d=r-Math.hypot(dx,dz);
        if(d<=depth||p.y>terrainHeight(I,p.x,p.z))continue;
        depth=d;this._contact=p.clone();
        const derivative=shoreDerivative(I,a);this._normal.set(r*Math.cos(a)+derivative*Math.sin(a),0,r*Math.sin(a)-derivative*Math.cos(a)).normalize();
      }
    }
    if(depth===0)return 0;
    const point=this._contact,n=this._normal,lever=this._lever.copy(point).sub(physics.position);
    this._velocity.crossVectors(physics.omega,lever).add(physics.velocity);
    this._cross.crossVectors(lever,n).applyMatrix3(physics.updateWorldInertia()).multiplyScalar(1/(1+physics.addedMassAng)).cross(lever);
    const inverseMass=1/(physics.mass*(1+physics.addedMassLin))+n.dot(this._cross);
    const impulse=Math.max(0,depth*.12/dt-this._velocity.dot(n))/inverseMass;
    physics.applyImpulseAtPoint(this._impulse.copy(n).multiplyScalar(impulse),point);return impulse;
  }
  update(dt,field,ship,particles,night){
    this.foam.material.uniforms.uShoreNight.value=night;this.sprayDebt+=dt*240;
    const count=Math.floor(this.sprayDebt);this.sprayDebt-=count;
    const nearby=ISLANDS.filter(I=>Math.hypot(ship.position.x-I.x,ship.position.z-I.z)<I.radius+1000);
    if(!nearby.length)return;
    for(let k=0;k<count;k++){
      const I=nearby[k%nearby.length],toward=Math.atan2(ship.position.z-I.z,ship.position.x-I.x),a=toward+(Math.random()-.5)*2.1,r=shoreRadius(I,a),x=I.x+Math.cos(a)*(r+2),z=I.z+Math.sin(a)*(r+2),s=field.sampleWorld(x,z,{});
      const strength=Math.max(0,s.vy)*.65+Math.max(0,s.y)*.25;
      if(strength<.45)continue;
      const vx=Math.cos(a)*(2+Math.random()*4),vz=Math.sin(a)*(2+Math.random()*4),vy=3+Math.min(12,strength*2)+Math.random()*3;
      particles.spawn(x,s.y+.25,z,vx,vy,vz,3,.8+Math.random()*.9,0);
    }
  }
}
