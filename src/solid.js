import * as THREE from 'three';

/** A closed solid between matching planform rings. Triangles are the sole
 * source for its visible shell and sealed-volume hydrostatic quadrature. */
export function ringSolid(rings) {
  const count=rings[0].points.length,vertices=rings.flatMap(r=>r.points.flatMap(([x,z])=>[x,r.y,z]));
  const indices=[],v=i=>new THREE.Vector3(...vertices.slice(i*3,i*3+3));
  const centre=new THREE.Vector3();for(let i=0;i<vertices.length/3;i++)centre.add(v(i));centre.divideScalar(vertices.length/3);
  const tri=(a,b,c)=>{
    const A=v(a),B=v(b),C=v(c),normal=B.clone().sub(A).cross(C.clone().sub(A));
    const middle=A.clone().add(B).add(C).divideScalar(3);
    if(normal.dot(middle.sub(centre))<0)indices.push(a,c,b);else indices.push(a,b,c);
  };
  for(let k=0;k<rings.length-1;k++)for(let i=0;i<count;i++){
    const a=k*count+i,b=k*count+(i+1)%count,c=a+count,d=b+count;tri(a,b,c);tri(b,d,c);
  }
  for(const k of [0,rings.length-1]){
    const points=rings[k].points.map(([x,z])=>new THREE.Vector2(x,z));
    for(const [a,b,c] of THREE.ShapeUtils.triangulateShape(points,[]))tri(k*count+a,k*count+b,k*count+c);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(vertices.flatMap((_,i)=>i%3===0?[vertices[i],vertices[i+2]]:[]),2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  return {geometry,patches:trianglesToPatches(geometry,'sealed')};
}
export function trianglesToPatches(geometry,kind) {
  const p=geometry.attributes.position,index=geometry.index,patches=[];
  for(let i=0;i<index.count;i+=3){
    const [a,b,c]=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(p,index.getX(i+k)));
    const n=b.clone().sub(a).cross(c.clone().sub(a)),area=n.length()/2;
    if(area>1e-10)patches.push({pos:a.add(b).add(c).divideScalar(3),nrm:n.normalize(),area,kind});
  }
  return patches;
}
export function chamferPlan(x,z,length,width,corner=0) {
  const a=length/2,b=width/2,c=corner;
  return [[a-c,b],[a,b-c],[a,-b+c],[a-c,-b],[-a+c,-b],[-a,-b+c],[-a,b-c],[-a+c,b]].map(([u,v])=>[x+u,z+v]);
}
