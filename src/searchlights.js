import * as THREE from 'three';

const COUNT=2,POWER=300000,ANGLE=.16,COLOUR=new THREE.Color(0xcbe5ff);
const forward=new THREE.Vector3(),position=new THREE.Vector3();
export function makeSearchlightUniforms(){
  return {uSearchPosition:{value:Array.from({length:COUNT},()=>new THREE.Vector4())},
    uSearchDirection:{value:Array.from({length:COUNT},()=>new THREE.Vector4(1,0,0,200))},
    uSearchColour:{value:COLOUR},uSearchCone:{value:new THREE.Vector2(Math.cos(ANGLE),Math.cos(ANGLE*.55))}};
}
/** The same finite emitter illuminates PBR geometry, sea and scattering. */
export function searchlightGLSL(){return /* glsl */`
uniform vec4 uSearchPosition[${COUNT}],uSearchDirection[${COUNT}];
uniform vec3 uSearchColour;uniform vec2 uSearchCone;
vec3 searchRadiance(vec3 p){
  vec3 result=vec3(0.0);
  for(int i=0;i<${COUNT};i++){
    vec3 delta=p-uSearchPosition[i].xyz;float distance=length(delta);
    float cone=smoothstep(uSearchCone.x,uSearchCone.y,dot(delta/max(distance,.45),uSearchDirection[i].xyz));
    float range=pow(clamp(1.0-pow(distance/uSearchDirection[i].w,4.0),0.0,1.0),2.0);
    result+=uSearchColour*uSearchPosition[i].w*cone*range/max(dot(delta,delta),.2025);
  }
  return result;
}
vec3 searchSurface(vec3 p,vec3 n,vec3 view){
  vec3 result=vec3(0.0);
  for(int i=0;i<${COUNT};i++){
    vec3 delta=uSearchPosition[i].xyz-p;float distance=length(delta);
    vec3 light=delta/max(distance,.45),halfway=normalize(light+view);
    float cone=smoothstep(uSearchCone.x,uSearchCone.y,dot(-light,uSearchDirection[i].xyz));
    float range=pow(clamp(1.0-pow(distance/uSearchDirection[i].w,4.0),0.0,1.0),2.0);
    float incidence=max(dot(n,light),0.0),shine=pow(max(dot(n,halfway),0.0),120.0);
    result+=uSearchColour*uSearchPosition[i].w*cone*range*(.022*incidence+.12*shine)/max(dot(delta,delta),.2025);
  }
  return result;
}`;}

export class Searchlights {
  constructor(vessel){
    this.group=new THREE.Group();this.group.name='Night searchlights';this.group.userData.dynamic=true;
    const roof=vessel.bridgeRoof,radius=Math.min(.7,roof.width*.065);
    const metal=new THREE.MeshStandardMaterial({color:0x7a8790,roughness:.4,metalness:.5});
    this.lensMaterial=new THREE.MeshBasicMaterial({color:COLOUR,transparent:true,opacity:0,toneMapped:false});
    this.lamps=[-1,1].map(side=>{
      const mount=new THREE.Group();mount.position.set(roof.x+roof.length*.35,roof.y+radius*1.35,roof.z+side*roof.width*.31);
      const pedestal=new THREE.Mesh(new THREE.CylinderGeometry(radius*.35,radius*.45,radius*.85,12),metal);
      pedestal.position.y=-radius*.925;mount.add(pedestal);
      const housing=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,radius*1.45,16),metal);
      housing.rotation.z=-Math.PI/2;mount.add(housing);
      const lens=new THREE.Mesh(new THREE.CircleGeometry(radius*.85,16),this.lensMaterial);
      lens.position.x=radius*.74;lens.rotation.y=Math.PI/2;mount.add(lens);
      const light=new THREE.SpotLight(COLOUR,0,Math.max(200,vessel.length*2.8),ANGLE,.45,2);
      light.position.x=radius*.8;
      const target=new THREE.Object3D();target.position.set(light.position.x+1,-.13,side*.055);mount.add(light,target);light.target=target;
      // Intensity, rather than visibility, changes at night, keeping the
      // light count and compiled material variant constant in both modes.
      light.castShadow=false;this.group.add(mount);return {mount,light,target};
    });
  }
  update(night,uniforms){
    this.lensMaterial.opacity=night;
    this.group.updateWorldMatrix(true,true);
    this.lamps.forEach(({mount,light,target},i)=>{
      light.intensity=POWER*night;
      light.getWorldPosition(position);target.getWorldPosition(forward);forward.sub(position).normalize();
      uniforms.uSearchPosition.value[i].set(position.x,position.y,position.z,light.intensity);
      uniforms.uSearchDirection.value[i].set(forward.x,forward.y,forward.z,light.distance);
    });
  }
}
