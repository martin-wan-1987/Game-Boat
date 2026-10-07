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
export function shoreRadius(I,a){return I.radius*(1+.085*Math.sin(3*a+I.phase)+.045*Math.cos(5*a-I.phase));}
export function shoreDerivative(I,a){return I.radius*(.255*Math.cos(3*a+I.phase)-.225*Math.sin(5*a-I.phase));}
export function terrainHeight(I,x,z){
  const dx=x-I.x,dz=z-I.z,r=Math.hypot(dx,dz)/shoreRadius(I,Math.atan2(dz,dx));
  for(let i=1;i<profile.length;i++){
    const a=profile[i-1],b=profile[i];
    if(r>=b[1])return I.height*(a[0]+(b[0]-a[0])*(a[1]-r)/(a[1]-b[1]));
  }
  return I.height;
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
    const rock=new THREE.MeshStandardMaterial({name:'Weathered coastal rock',vertexColors:true,roughness:.94,metalness:.01,flatShading:true});
    const n=128,foamPos=[],foamUV=[],foamIndices=[];
    for(const I of ISLANDS){
      const positions=[],colours=[],indices=[];
      for(let j=0;j<profile.length;j++)for(let i=0;i<=n;i++){
        const a=i/n*TAU,r=shoreRadius(I,a)*profile[j][1],y=I.height*profile[j][0];
        positions.push(I.x+Math.cos(a)*r,y,I.z+Math.sin(a)*r);
        const moss=Math.max(0,Math.sin(a*7+I.phase)*Math.cos(a*13-I.phase))*Math.min(1,Math.max(0,y/15));
        const variation=.045*Math.sin(a*53+j*1.9)+.03*Math.cos(a*89-j*2.7),wet=1-(1-Math.min(1,Math.max(0,y/9)))*.26;
        colours.push((.34+variation-moss*.055)*wet,(.36+variation+moss*.015)*wet,(.34+variation-moss*.05)*wet);
        if(j<profile.length-1&&i<n){const b=j*(n+1)+i;indices.push(b,b+n+1,b+1,b+1,b+n+1,b+n+2);}
      }
      const centre=positions.length/3;positions.push(I.x,I.height,I.z);colours.push(.32,.34,.31);
      const top=(profile.length-1)*(n+1);for(let i=0;i<n;i++)indices.push(centre,top+i+1,top+i);
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colours,3));geo.setIndex(indices);geo.computeVertexNormals();
      const land=new THREE.Mesh(geo,rock);land.castShadow=land.receiveShadow=true;this.group.add(land);
      const base=foamPos.length/3;
      for(let i=0;i<=n;i++)for(const distance of [1.2,20]){
        const a=i/n*TAU,r=shoreRadius(I,a)+distance;
        foamPos.push(I.x+Math.cos(a)*r,0,I.z+Math.sin(a)*r);foamUV.push(a*I.radius/12,(distance-1.2)/18.8);
        if(i<n&&distance===1.2){const b=base+2*i;foamIndices.push(b,b+1,b+2,b+1,b+3,b+2);}
      }
    }
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
