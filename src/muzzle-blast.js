import * as THREE from 'three';
import {bakeStatic} from './mesh-bake.js';
/** Short pressure-driven fireball; the longer smoke plume is emitted into
 * world-space particles at the muzzle, rather than carried by the turret. */
export function muzzleBlast(anchor,calibre){
  const scale=Math.max(.32,calibre*10),life=.075+calibre*.32,group=new THREE.Group();group.userData.dynamic=true;anchor.add(group);
  const uniforms={uBlastAge:{value:life},uBlastLife:{value:life},uBlastScale:{value:scale}};
  const mat=new THREE.ShaderMaterial({name:'Naval muzzle fireball',uniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false,
    vertexShader:'varying vec3 vBlast;void main(){vBlast=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`varying vec3 vBlast;uniform float uBlastAge,uBlastLife,uBlastScale;
      float hash(vec3 p){return fract(sin(dot(p,vec3(17.1,53.7,91.3)))*43758.5453);}
      float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      void main(){float age=uBlastAge/uBlastLife,alive=step(0.0,age)*(1.0-step(1.0,age));
        float n=noise(vBlast/uBlastScale*4.0-vec3(age*2.0,0,0));float heat=clamp(1.0-age*.85-n*.5,0.0,1.0);
        vec3 colour=mix(vec3(1.7,.075,.008),vec3(4.5,2.6,.55),smoothstep(.12,.7,heat));colour=mix(colour,vec3(7.0,6.3,4.8),smoothstep(.72,.96,heat));
        gl_FragColor=vec4(colour,alive*(1.0-age)*(.5+.5*n));
      }`});
  for(let i=0;i<9;i++){
    const p=new THREE.Mesh(new THREE.SphereGeometry(1,12,10),mat),angle=i*2.39996;
    p.position.set(scale*(.7+(i%3)*.37),Math.cos(angle)*scale*.34,Math.sin(angle)*scale*.34);
    p.scale.set(scale*(1.15+(i%2)*.35),scale*(.4+(i%3)*.12),scale*(.4+(i%3)*.12));group.add(p);
  }
  bakeStatic(group);
  group.visible=false;
  return {group,mat,update(age){const elapsed=Math.min(life,Math.max(0,age));uniforms.uBlastAge.value=elapsed;group.scale.setScalar(1+elapsed*2.1);group.visible=elapsed<life;},warmup(on){this.update(on?.04:life);}};
}
