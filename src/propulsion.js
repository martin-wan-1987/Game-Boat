import * as THREE from 'three';
import {bakeStatic} from './mesh-bake.js';
const TAU=Math.PI*2;

/** Swept, pitched solid blades on an X-axis hub. Radial sections share the
 * same pitch function; their two skins and perimeter form a closed solid. */
function bladeGeometry(radius,hand) {
  const positions=[],uvs=[],indices=[],rows=16,cols=10;
  for(const skin of [-1,1])for(let i=0;i<=rows;i++)for(let j=0;j<=cols;j++) {
    const u=i/rows,v=2*j/cols-1,r=radius*(.23+.77*u);
    const skew=hand*(.18+.50*u*u),pitch=hand*(.84-.48*u);
    const chord=radius*(.14+.38*Math.sin(Math.PI*(.12+.88*u)))*Math.sqrt(Math.max(.03,1-u*u));
    const offset=chord*v*.5,thickness=skin*radius*.027*(1-v*v)*(.8-.45*u);
    positions.push(offset*Math.sin(pitch)+thickness*Math.cos(pitch),
      r*Math.cos(skew)-offset*Math.cos(pitch)*Math.sin(skew)+thickness*Math.sin(pitch)*Math.sin(skew),
      r*Math.sin(skew)+offset*Math.cos(pitch)*Math.cos(skew)-thickness*Math.sin(pitch)*Math.cos(skew));
    uvs.push(j/cols,u);
  }
  const layer=(rows+1)*(cols+1);
  for(let k=0;k<2;k++)for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){
    const a=k*layer+i*(cols+1)+j,b=a+1,c=a+cols+1,d=c+1;
    indices.push(...(k?[a,c,b,b,c,d]:[a,b,c,b,d,c]));
  }
  const edge=[];for(let j=0;j<=cols;j++)edge.push(j);
  for(let i=1;i<=rows;i++)edge.push(i*(cols+1)+cols);
  for(let j=cols-1;j>=0;j--)edge.push(rows*(cols+1)+j);
  for(let i=rows-1;i>0;i--)edge.push(i*(cols+1));
  for(let i=0;i<edge.length;i++){const a=edge[i],b=edge[(i+1)%edge.length];indices.push(a,a+layer,b,b,a+layer,b+layer);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
function cylinder(group,material,a,b,r1,r2=r1){
  const va=new THREE.Vector3(...a),vb=new THREE.Vector3(...b),d=vb.clone().sub(va);
  const m=new THREE.Mesh(new THREE.CylinderGeometry(r2,r1,d.length(),16),material);
  m.position.copy(va).add(vb).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());
  m.castShadow=m.receiveShadow=true;group.add(m);return m;
}
export function buildPropulsion(spec) {
  const group=new THREE.Group(),rotors=[],rudders=[];group.name='Shafts, propellers and rudders';
  const bronze=new THREE.MeshPhysicalMaterial({name:'Marine bronze propellers',color:0x967b48,metalness:.84,roughness:.26,clearcoat:.32});
  const steel=new THREE.MeshStandardMaterial({name:'Propeller shafts',color:0x525858,metalness:.7,roughness:.32});
  const red=new THREE.MeshStandardMaterial({name:'Underwater appendages',color:0x5e2b24,roughness:.63,metalness:.09});
  for(const shaft of spec.propulsion.shafts){
    if(shaft.kind==='jet')continue;
    const [x,y,z]=shaft.position,R=shaft.radius;
    cylinder(group,steel,[x+R*8.75,y+R*.9375,z*.82],[x,y,z],R*.12);
    for(const sign of [-1,1])cylinder(group,red,[x+R*1.56,y+R*.45,z],[x+R*2.81,y+R*1.8,z+sign*R*.8],R*.13);
    const rotor=new THREE.Group();rotor.position.set(x,y,z);rotor.userData.dynamic=true;
    cylinder(rotor,bronze,[-R*.42,0,0],[R*.38,0,0],R*.24,R*.2);
    for(let i=0;i<shaft.blades;i++){
      const blade=new THREE.Mesh(bladeGeometry(R,shaft.hand),bronze);blade.rotation.x=i*TAU/shaft.blades;rotor.add(blade);
    }
    bakeStatic(rotor);group.add(rotor);rotors.push({rotor,shaft});
  }
  for(const r of spec.propulsion.rudders){
    const pivot=new THREE.Group();pivot.position.set(...r.position);pivot.userData.dynamic=true;
    const shape=new THREE.Shape();shape.moveTo(-r.length*.45,-r.height*.5);shape.lineTo(r.length*.45,-r.height*.4);
    shape.lineTo(r.length*.55,r.height*.5);shape.lineTo(-r.length*.36,r.height*.5);shape.closePath();
    const thickness=r.height*.065;
    const g=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:true,bevelSize:r.height*.021,bevelThickness:r.height*.024,bevelSegments:2,steps:1});g.translate(0,0,-thickness/2);
    const m=new THREE.Mesh(g,red);m.castShadow=m.receiveShadow=true;pivot.add(m);group.add(pivot);rudders.push(pivot);
  }
  return {group,rotors,rudders,update(dt,throttle,speed,rudder){
    for(const {rotor,shaft} of rotors)rotor.rotation.x+=dt*shaft.hand*TAU*shaft.rpm/60*Math.sign(throttle||speed)*Math.sqrt(Math.abs(throttle));
    for(const pivot of rudders)pivot.rotation.y=rudder;
  }};
}
