import * as THREE from 'three';
import {deckHeightAt,insideOutline} from './deck-surface.js';
/** Gravity projection of the real deck polygon. Water remains the shared
 * incident wave field for pressure; rendering excludes the solid footprint.
 * World-space edges avoid an inverse deck-plane singularity at 90° heel. */
export class SolidWater {
  constructor(maxEdges,maxActors=1){
    this.maxEdges=maxEdges;this.maxActors=maxActors;this.data=new Float32Array(maxEdges*maxActors*4);
    this.texture=new THREE.DataTexture(this.data,maxEdges*maxActors,1,THREE.RGBAFormat,THREE.FloatType);
    this.texture.minFilter=this.texture.magFilter=THREE.NearestFilter;
    this.uniforms={uSolidEdges:{value:this.texture},uSolidActors:{value:0},uSolidCount:{value:Array(maxActors).fill(0)},
      uSolidMin:{value:Array.from({length:maxActors},()=>new THREE.Vector2())},uSolidMax:{value:Array.from({length:maxActors},()=>new THREE.Vector2())},
      uSolidInverse:{value:Array.from({length:maxActors},()=>new THREE.Matrix4())},uSolidDeck:{value:Array.from({length:maxActors},()=>new THREE.Vector4())}};
    this.point=new THREE.Vector3();this.outlines=[];
  }
  update(ships){
    this.outlines.length=ships.length;this.uniforms.uSolidActors.value=ships.length;
    for(let actor=0;actor<ships.length;actor++){
      const ship=ships[actor];ship.updateWorldMatrix(true,false);const S=ship.userData.vessel,points=S.deckOutline,n=points.length;
      const min=this.uniforms.uSolidMin.value[actor].set(Infinity,Infinity),max=this.uniforms.uSolidMax.value[actor].set(-Infinity,-Infinity);
      const outline=this.outlines[actor]??(this.outlines[actor]=[]);outline.length=n;
      this.uniforms.uSolidInverse.value[actor].copy(ship.matrixWorld).invert();
      this.uniforms.uSolidDeck.value[actor].set(S.deckY,S.ramp?.start??S.length/2,S.ramp?.rise??0,S.length/2-(S.ramp?.start??0));
      for(let i=0;i<n;i++){
        const [x,z]=points[i],p=this.point.set(x,deckHeightAt(S,x),z).applyMatrix4(ship.matrixWorld);
        outline[i]=[p.x,p.z];min.x=Math.min(min.x,p.x);min.y=Math.min(min.y,p.z);max.x=Math.max(max.x,p.x);max.y=Math.max(max.y,p.z);
      }
      for(let i=0;i<n;i++){const a=outline[i],b=outline[(i+1)%n];this.data.set([a[0],a[1],b[0],b[1]],(actor*this.maxEdges+i)*4);}
      this.uniforms.uSolidCount.value[actor]=n;
    }
    this.texture.needsUpdate=true;
  }
  contains(x,z){return this.outlines.some(outline=>insideOutline(outline,x,z));}
}
export const solidWaterGLSL=(maxEdges,maxActors=1)=>`
uniform sampler2D uSolidEdges;uniform int uSolidActors,uSolidCount[${maxActors}];uniform vec2 uSolidMin[${maxActors}],uSolidMax[${maxActors}];uniform mat4 uSolidInverse[${maxActors}];uniform vec4 uSolidDeck[${maxActors}];
bool solidWater(vec3 world){
  vec2 p=world.xz;
  for(int actor=0;actor<${maxActors};actor++){
    if(actor>=uSolidActors)break;
    if(any(lessThan(p,uSolidMin[actor]))||any(greaterThan(p,uSolidMax[actor])))continue;
    vec3 local=(uSolidInverse[actor]*vec4(world,1.0)).xyz;
    float ramp=max(0.0,(local.x-uSolidDeck[actor].y)/uSolidDeck[actor].w);
    if(local.y<uSolidDeck[actor].x+uSolidDeck[actor].z*ramp*ramp)continue;
    bool inside=false;
    for(int i=0;i<${maxEdges};i++){
      if(i>=uSolidCount[actor])break;
      vec4 edge=texture2D(uSolidEdges,vec2((float(actor*${maxEdges}+i)+.5)/${maxEdges*maxActors}.0,.5));
      if((edge.y>p.y)!=(edge.w>p.y)){
        if(p.x<(edge.z-edge.x)*(p.y-edge.y)/(edge.w-edge.y)+edge.x)inside=!inside;
      }
    }
    if(inside)return true;
  }
  return false;
}`;
