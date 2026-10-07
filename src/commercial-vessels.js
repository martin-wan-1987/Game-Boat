import * as THREE from 'three';
import {createNavalVessel,mesh,box,tube,rail} from './naval-vessels.js';
import {modelLabel,latticeMast,liferafts,funnel,gallery} from './model-fittings.js';
import {ContainerCargo} from './container-cargo.js';
import {ringSolid,chamferPlan} from './solid.js';
function containerDetails(g,M,S){
  for(const side of [-1,1]){
    modelLabel(g,S.cargo.brand,10,S.deckY*.57,side*S.beamWater*.5005,S.cargo.brand==='EVERGREEN'?116:86,8,side<0?Math.PI:0,S.cargo.brand==='OOCL'?'#ac3237':'#e3e5d9');
    for(const h of S.houses.filter((_,i)=>i%3===1))gallery(g,M,{x:h.x,y:h.y1,z:side*(h.w1/2+.6),length:h.l1,width:1.1});
    liferafts(g,M,{x:S.bridgeX-8,y:S.deckY+8,z:side*S.beamWater*.38,count:5});
    const boat=mesh(g,new THREE.CapsuleGeometry(1.6,5.2,5,18),M.orange,S.bridgeX-17,S.deckY+10,side*S.beamWater*.38);boat.rotation.z=Math.PI/2;boat.scale.z=.70;
    for(const x of [S.bridgeX-20,S.bridgeX-14])tube(g,M.steel,[x,S.deckY+8,side*S.beamWater*.37],[x,S.deckY+13,side*S.beamWater*.44],.15);
  }
  const funnelBottom=S.deckY+4;
  box(g,M.grey,S.funnelX,S.deckY+3,0,28,6,S.beamWater*.62);
  funnel(g,M,{x:S.funnelX-2,z:0,bottom:funnelBottom,top:S.deckY+32,length:13,width:10});
  for(const side of [-1,1])modelLabel(g,S.cargo.brand==='MSC'?'MSC':S.cargo.brand==='OOCL'?'OOCL':'E',S.funnelX-2,S.deckY+27,side*5.02,8,5,side<0?Math.PI:0);
  for(const stack of S.cargo.stacks){
    // Hatch covers, lashing bridges and corner supports remain when boxes
    // leave; these structures are static and are baked with the ship.
    box(g,M.dark,stack.x,S.deckY+.08,stack.z,12.3,.15,2.46);
    for(const dx of [-5.8,5.8])box(g,M.steel,stack.x+dx,S.deckY+.25,stack.z,.20,.35,2.2);
  }
  for(let x=-S.length*.43;x<S.length*.4;x+=25.36)for(const side of [-1,1]){
    const z=side*(S.beamWater/2-1.5);tube(g,M.steel,[x,S.deckY,z],[x,S.deckY+7,z],.15);
    for(let y=1;y<7;y+=1.2)tube(g,M.steel,[x-3,S.deckY+y,z],[x+3,S.deckY+y,z],.10);
  }
  for(const x of [-S.length*.43,S.length*.43]){
    const z=0;box(g,M.grey,x,S.deckY+.5,z,10,1,14);
    for(const sign of [-1,1])mesh(g,new THREE.CylinderGeometry(1.2,1.2,1,18),M.steel,x,S.deckY+1.3,sign*4.0);
  }
  return {spin:latticeMast(g,M,{x:S.bridgeX-1,y:S.bridgeRoof.y,z:0,height:10,width:5,radarWidth:4.8})};
}
function cruiseWindows(g,M,S){
  for(const h of S.houses){
    const y=h.y0+1.6,f=(y-h.y0)/(h.y1-h.y0),w=h.w0+(h.w1-h.w0)*f;
    for(const side of [-1,1])for(let x=h.x-h.l1*.47;x<h.x+h.l1*.47;x+=2.55){
      const z=h.z+side*(w/2+.035);
      box(g,M.dark,x,y,z,1.82,1.83,.065);box(g,M.glass,x,y,z+side*.045,1.63,1.64,.020);
      if(h.y0>S.deckY+14){
        box(g,M.grey,x,h.y0+.17,z+side*.40,2.46,.23,.94);
        box(g,M.glass,x,h.y0+1.0,z+side*.83,2.42,.72,.035);
        tube(g,M.steel,[x-1.22,h.y0+1.42,z+side*.84],[x+1.22,h.y0+1.42,z+side*.84],.027);
      }
    }
    const front=h.x+(h.l0+(h.l1-h.l0)*f)/2;
    for(let z=-h.w1*.4;z<h.w1*.41;z+=2.3)box(g,M.glass,front+.04,y,h.z+z,.03,1.15,1.52);
  }
}
function pool(g,M,x,y,z,length,width){
  const blue=new THREE.MeshPhysicalMaterial({color:0x287e92,roughness:.11,metalness:.22,clearcoat:1});
  box(g,M.white,x,y-.45,z,length+1.8,.9,width+1.8);box(g,blue,x,y+.015,z,length,.055,width);
  for(const side of [-1,1])tube(g,M.steel,[x+length/2-1,y+.2,z+side*width*.25],[x+length/2-1,y-1,z+side*width*.25],.055);
}
function cruiseDetails(g,M,S){
  const {topY,well}=S.hotel;
  const teak=new THREE.MeshStandardMaterial({name:'Promenade teak',color:0xb2a079,roughness:.82});
  const blue=new THREE.MeshPhysicalMaterial({name:'Cruise observation glazing',color:0x45828e,metalness:.34,roughness:.12,clearcoat:1});
  const yellow=new THREE.MeshStandardMaterial({color:0xdca72c,roughness:.55});
  box(g,teak,well.x,well.y,0,well.length,.22,well.width);
  for(let x=well.x-well.length/2+7;x<well.x+well.length/2-8;x+=12){
    for(const side of [-1,1]){
      const trunk=mesh(g,new THREE.CylinderGeometry(.17,.30,3.1,10),M.dark,x,well.y+1.7,side*4.3);
      const crown=mesh(g,new THREE.IcosahedronGeometry(2.2,1),new THREE.MeshStandardMaterial({color:0x425c31,roughness:.92}),x,well.y+4.2,side*4.3);crown.scale.y=1.35;
    }
  }
  for(const side of [-1,1]){
    modelLabel(g,S.name.toUpperCase(),30,5.6,side*(S.beamWater/2+.04),132,5.6,side<0?Math.PI:0,'#315c73');
    for(let x=-115;x<100;x+=14){
      const z=side*(S.beamWater/2+3.8),y=S.deckY+4.5;
      const lifeboat=mesh(g,new THREE.CapsuleGeometry(1.3,8.3,6,20),yellow,x,y,z);lifeboat.rotation.z=Math.PI/2;lifeboat.scale.y=.70;
      box(g,M.glass,x,y+.83,z,7.7,.9,1.6);
      for(const xx of [x-4,x+4]){tube(g,M.white,[xx,S.deckY+2,side*S.beamWater/2],[xx,S.deckY+7,z],.16);tube(g,M.steel,[xx,S.deckY+7,z],[xx,y+1,z],.055);}
    }
    gallery(g,M,{x:-18,y:S.deckY+3,z:side*(S.beamWater/2+1.2),length:267,width:2.1});
    for(let x=-125;x<108;x+=3.8)for(const z of [side*(S.beamWater/2-2),side*(S.beamWater/2-5)]){
      const chair=box(g,M.white,x,topY+.38,z,1.9,.10,.57);chair.rotation.z=.12;
      for(const d of [-.6,.6])tube(g,M.steel,[x+d,topY,z],[x+d,topY+.36,z],.035);
    }
  }
  // Bridge wings and the forward window band are modelled independently
  // from the hotel decks; no low-resolution window atlas is enlarged.
  mesh(g,ringSolid([{y:S.deckY+18.3,points:chamferPlan(139,0,28,S.beamWater+6,4)},
    {y:S.deckY+22,points:chamferPlan(140,0,27,S.beamWater+5,4)}]).geometry,M.grey);
  for(let z=-S.beamWater*.48;z<S.beamWater*.49;z+=1.9)box(g,M.glass,153.6,S.deckY+21,z,.035,1.1,1.6);
  for(const side of [-1,1])box(g,M.glass,139,S.deckY+21,side*(S.beamWater/2+2.8),22,1.1,.035);
  for(const x of [-22,-44]){
    funnel(g,M,{x,bottom:topY,top:topY+8,length:11,width:10});
    for(const z of [-3,0,3])mesh(g,new THREE.CylinderGeometry(.9,.9,2.0,16),M.dark,x,topY+8,z);
  }
  pool(g,M,35,topY+.4,0,18,10);pool(g,M,-76,topY+.4,0,16,11);pool(g,M,-121,topY+.2,0,10,8);
  const slideColours=[0x3b92b0,0xd45749,0xd9b342,0x745d99];
  for(let i=0;i<(S.iconClass?6:3);i++){
    const points=Array.from({length:60},(_,j)=>{const t=j/59,a=t*Math.PI*(S.iconClass?4:3)+i*1.25;
      return new THREE.Vector3(-118+Math.cos(a)*(8+i*.7),topY+12*(1-t)+1.0,Math.sin(a)*(5+i*.7));});
    mesh(g,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),90,.62,10,false),new THREE.MeshStandardMaterial({color:slideColours[i%4],roughness:.31,metalness:.10}));
  }
  for(const x of [-126,-118,-108])tube(g,M.white,[x,topY,0],[x,topY+12,0],.23);
  if(S.iconClass){
    // Icon's glass AquaDome and suspended aft sphere are its main features.
    const dome=mesh(g,new THREE.SphereGeometry(24,48,28,0,Math.PI*2,0,Math.PI/2),blue,100,topY,0);dome.scale.set(1.32,.83,.92);
    for(let i=0;i<11;i++){
      const a=i*Math.PI/10;const points=Array.from({length:30},(_,j)=>{const t=j/29*Math.PI;return new THREE.Vector3(100+Math.cos(t)*31.8,topY+Math.sin(t)*19.9*Math.sin(a),Math.sin(t)*22*Math.cos(a));});
      mesh(g,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),40,.075,6,false),M.white);
    }
    const sphere=mesh(g,new THREE.SphereGeometry(6.8,32,22),blue,-143,topY-6,0);sphere.scale.y=.92;
    for(const side of [-1,1])tube(g,M.white,[-153,topY+1,side*5],[-143,topY-10,side*2],.38);
  }else{
    // Oasis-class open stern amphitheatre and twin dry slides are different
    // geometry; Symphony is not a renamed Icon hull/superstructure.
    for(let i=0;i<7;i++)box(g,teak,-149+i*1.9,S.deckY+6+i*.52,0,1.85,.40,18-i*.9);
    pool(g,M,-142,S.deckY+6,0,11,7);
    for(const side of [-1,1]){
      const path=Array.from({length:60},(_,i)=>{const t=i/59;return new THREE.Vector3(-137+Math.sin(t*Math.PI*4)*3,topY-1-t*24,side*(4+Math.cos(t*Math.PI*3)*2));});
      mesh(g,new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path),90,.73,10,false),new THREE.MeshStandardMaterial({color:0x654783,roughness:.42}));
    }
  }
  for(const [x,z] of [[58,-10],[58,10],[-55,-10],[-55,10]])mesh(g,new THREE.SphereGeometry(2.0,24,16),M.white,x,topY+2,z);
  return {spin:latticeMast(g,M,{x:124,y:topY,z:0,height:8,width:4.0,radarWidth:4.2})};
}
export function createContainerShip(spec,options){
  const model=createNavalVessel(spec,{...options,decorate:containerDetails});
  const cargo=new ContainerCargo(spec);model.add(cargo.group);model.userData.cargo=cargo;return model;
}
export const createCruiseShip=(spec,options)=>createNavalVessel(spec,{...options,decorate:cruiseDetails,glazing:cruiseWindows});
