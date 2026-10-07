import * as THREE from 'three';
import {bakeStatic} from './mesh-bake.js';

/** A surface-running boat has one moving optical mast, no dive/station mode.
 * The lens anchor is shared by the exterior model and its first-person eye. */
export class Periscope {
  constructor(spec){
    this.spec=spec;this.group=new THREE.Group();this.group.name='Retractable optical periscope';this.group.userData.dynamic=true;
    this.group.position.set(...spec.position);
    const steel=new THREE.MeshStandardMaterial({color:0x909a9b,metalness:.72,roughness:.26});
    const rubber=new THREE.MeshStandardMaterial({color:0x20282b,roughness:.64});
    const glass=new THREE.MeshPhysicalMaterial({color:0x143847,metalness:.36,roughness:.08,clearcoat:1});
    const add=(parent,geometry,material,x,y,z)=>{const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
    add(this.group,new THREE.CylinderGeometry(spec.radius*1.5,spec.radius*2.1,.3,20),rubber,0,.15,0);
    this.mast=new THREE.Group();this.mast.userData.dynamic=true;this.group.add(this.mast);
    add(this.mast,new THREE.CylinderGeometry(spec.radius,spec.radius,spec.travel,20),steel,0,-spec.travel/2,0);
    add(this.mast,new THREE.CylinderGeometry(spec.radius*1.35,spec.radius*1.1,.55,20),steel,0,.12,0);
    const hood=add(this.mast,new THREE.CylinderGeometry(spec.radius*1.3,spec.radius*1.3,.5,20),steel,.19,.28,0);hood.rotation.z=-Math.PI/2;
    const lens=add(this.mast,new THREE.CircleGeometry(spec.radius*.96,20),glass,.445,.28,0);lens.rotation.y=Math.PI/2;
    this.eye=new THREE.Object3D();this.eye.position.copy(lens.position);this.eye.position.x+=.015;this.mast.add(this.eye);
    bakeStatic(this.mast);this.reset();
  }
  reset(){this.raised=false;this.extension=0;this.update(0);}
  toggle(){this.raised=!this.raised;}
  update(dt){
    const target=Number(this.raised),step=dt/2.2;
    this.extension+=Math.max(-step,Math.min(step,target-this.extension));
    this.mast.position.y=.18+this.extension*this.spec.travel;
  }
  mirrorView(mode){return this.raised&&this.extension>=.99&&mode==='bridge';}
  localEye(ship,out){this.eye.getWorldPosition(out);return ship.worldToLocal(out);}
}
