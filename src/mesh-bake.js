import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
export function bakeStatic(root) {
  root.updateMatrixWorld(true);
  const inverse=root.matrixWorld.clone().invert(),buckets=new Map(),originals=[];
  const walk=node=>{
    for(const child of node.children) {
      if(child.userData.dynamic)continue;
      if(child.isMesh){
        const geo=child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone();
        const transform=new THREE.Matrix4().multiplyMatrices(inverse,child.matrixWorld);geo.applyMatrix4(transform);
        if(transform.determinant()<0){flipWinding(geo);geo.computeVertexNormals();}
        const bucket=buckets.get(child.material)||[];bucket.push(geo);buckets.set(child.material,bucket);originals.push(child);
      }else walk(child);
    }
  };walk(root);
  // Every material bucket, including a singleton, produces exactly one mesh.
  for(const [material,geometries] of buckets) {
    const merged=mergeGeometries(geometries,false);merged.computeBoundingSphere();mesh(root,merged,material);
    for(const geo of geometries)geo.dispose();
  }
  for(const old of originals){old.parent.remove(old);old.geometry.dispose();}
}
function mesh(root,geometry,material){const m=new THREE.Mesh(geometry,material);m.castShadow=m.receiveShadow=true;root.add(m);return m;}
function flipWinding(geo) {
  const attrs = Object.values(geo.attributes);
  const count = geo.attributes.position.count;
  for (const a of attrs) {
    const it = a.itemSize;
    const arr = a.array;
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < it; k++) {
        const t = arr[(i + 2) * it + k];
        arr[(i + 2) * it + k] = arr[i * it + k];
        arr[i * it + k] = t;
      }
    }
  }
}


