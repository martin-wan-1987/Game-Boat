import * as THREE from 'three';
import {deckHeightAt,insideOutline} from './deck-surface.js';
/** Gravity projection of the real deck polygon. Water remains the shared
 * incident wave field for pressure; rendering excludes the solid footprint.
 * World-space edges avoid an inverse deck-plane singularity at 90° heel. */
export class SolidWater {
  constructor(maxEdges){
    this.maxEdges=maxEdges;this.data=new Float32Array(maxEdges*4);
    this.texture=new THREE.DataTexture(this.data,maxEdges,1,THREE.RGBAFormat,THREE.FloatType);
    this.texture.minFilter=this.texture.magFilter=THREE.NearestFilter;
    this.uniforms={uSolidEdges:{value:this.texture},uSolidCount:{value:0},
      uSolidMin:{value:new THREE.Vector2()},uSolidMax:{value:new THREE.Vector2()},
      uSolidInverse:{value:new THREE.Matrix4()},uSolidDeck:{value:new THREE.Vector4()}};
    this.point=new THREE.Vector3();this.outline=[];
  }
  update(ship){
    ship.updateWorldMatrix(true,false);const S=ship.userData.vessel,points=S.deckOutline,n=points.length;
    const min=this.uniforms.uSolidMin.value.set(Infinity,Infinity),max=this.uniforms.uSolidMax.value.set(-Infinity,-Infinity);
    this.outline.length=n;
    this.uniforms.uSolidInverse.value.copy(ship.matrixWorld).invert();
    this.uniforms.uSolidDeck.value.set(S.deckY,S.ramp?.start??S.length/2,S.ramp?.rise??0,S.length/2-(S.ramp?.start??0));
    for(let i=0;i<n;i++){
      const [x,z]=points[i],p=this.point.set(x,deckHeightAt(S,x),z).applyMatrix4(ship.matrixWorld);
      this.outline[i]=[p.x,p.z];min.x=Math.min(min.x,p.x);min.y=Math.min(min.y,p.z);max.x=Math.max(max.x,p.x);max.y=Math.max(max.y,p.z);
    }
    for(let i=0;i<n;i++){const a=this.outline[i],b=this.outline[(i+1)%n];this.data.set([a[0],a[1],b[0],b[1]],i*4);}
    this.uniforms.uSolidCount.value=n;this.texture.needsUpdate=true;
  }
  contains(x,z){return insideOutline(this.outline,x,z);}
}
export const solidWaterGLSL=maxEdges=>`
uniform sampler2D uSolidEdges;uniform int uSolidCount;uniform vec2 uSolidMin,uSolidMax;uniform mat4 uSolidInverse;uniform vec4 uSolidDeck;
bool solidWater(vec3 world){
  vec2 p=world.xz;
  if(any(lessThan(p,uSolidMin))||any(greaterThan(p,uSolidMax)))return false;
  vec3 local=(uSolidInverse*vec4(world,1.0)).xyz;
  float ramp=max(0.0,(local.x-uSolidDeck.y)/uSolidDeck.w);
  if(local.y<uSolidDeck.x+uSolidDeck.z*ramp*ramp)return false;
  bool inside=false;
  for(int i=0;i<${maxEdges};i++){
    if(i>=uSolidCount)break;
    vec4 edge=texture2D(uSolidEdges,vec2((float(i)+.5)/${maxEdges}.0,.5));
    if((edge.y>p.y)!=(edge.w>p.y)){
      if(p.x<(edge.z-edge.x)*(p.y-edge.y)/(edge.w-edge.y)+edge.x)inside=!inside;
    }
  }
  return inside;
}`;
