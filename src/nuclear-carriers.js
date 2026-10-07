import * as THREE from 'three';
import {createNavalVessel,mesh,box,tube,rail} from './naval-vessels.js';
import {modelLabel,latticeMast,liferafts,gallery} from './model-fittings.js';
import {ringSolid,chamferPlan} from './solid.js';
import {flightFrame,flightWires} from './flight-deck.js';
import {deckHeightAt} from './deck-surface.js';

export function carrierFittings(g,M,S){
  const operations=S.flightOperations;
  for(const e of operations.elevators){
    box(g,M.nonSkid,e.x,S.deckY+.035,e.z,e.length,.09,e.width);
    for(let x=e.x-e.length/2;x<=e.x+e.length/2;x+=3.5)tube(g,M.steel,[x,S.deckY-4.7,e.z],[x,S.deckY-.17,e.z+e.side*e.width*.4],.15);
    for(const side of [-1,1])box(g,M.dark,e.x+side*(e.length/2-.3),S.deckY+.095,e.z,.18,.06,e.width*.8);
  }
  for(const [a,b] of flightWires(operations))tube(g,M.steel,[a[0],S.deckY+.09,a[1]],[b[0],S.deckY+.09,b[1]],.065);
  if(operations.catapults)for(const axis of operations.launch){
    const f=flightFrame(axis);
    for(const offset of [-.25,.25])tube(g,M.steel,[axis.start[0]+f.normal[0]*offset,S.deckY+.035,axis.start[1]+f.normal[1]*offset],
      [axis.end[0]+f.normal[0]*offset,S.deckY+.035,axis.end[1]+f.normal[1]*offset],.045);
    for(let panel=-2;panel<=2;panel++){
      const x=f.start[0]-f.tangent[0]*5+f.normal[0]*panel*2,z=f.start[1]-f.tangent[1]*5+f.normal[1]*panel*2;
      const deflector=box(g,M.grey,x,S.deckY+.12,z,5,.16,1.88);deflector.rotation.y=-Math.atan2(f.tangent[1],f.tangent[0]);
      for(let k=-1;k<=1;k++)tube(g,M.steel,[x+k*1.4,S.deckY+.21,z-.65],[x+k*1.4,S.deckY+.21,z+.65],.035);
    }
  }
  for(const side of [-1,1])for(let x=-S.length*.44;x<S.length*.42;x+=21){
    const z=side*(S.deckHalfWidthAt(x,side)-1.0),y=deckHeightAt(S,x)-.85;
    gallery(g,M,{x,y,z,length:14,width:1.5});liferafts(g,M,{x,y:y-1.1,z:z+side*.5,count:3,spacing:2.1});
    for(const xx of [x-4,x+4])tube(g,M.steel,[xx,S.hullTopY-4,side*(S.beamWater*.44)],[xx,y-.2,z],.14);
  }
  for(const w of S.weapons){
    const [x,y,z]=w.position;
    const points=chamferPlan(x,z,8,6,1);
    mesh(g,ringSolid([{y:y-.55,points},{y:y,points}]).geometry,M.grey);
    rail(g,M.steel,[...points,points[0]],y,{height:.75});
  }
  // Hangar ventilation, lifeboats and stern working galleries are geometry.
  for(const side of [-1,1])for(let x=-S.length*.40;x<S.length*.34;x+=12){
    const z=side*S.beamWater*.47;
    box(g,M.dark,x,S.deckY-5.4,z,6.3,1.4,.07);
    for(let y=-.5;y<=.5;y+=.22)box(g,M.steel,x,S.deckY-5.4+y,z+side*.06,6.15,.04,.035);
  }
  gallery(g,M,{x:-S.length/2+4,y:S.deckY-2,z:0,length:7,width:S.beamWater*.75});
}
function carrierDetails(g,M,S){
  carrierFittings(g,M,S);
  const ix=S.islandX,iz=25.2,roof=S.bridgeRoof.y;
  for(const h of S.houses){
    gallery(g,M,{x:h.x,y:h.y1+.13,z:iz-h.w1/2-1.1,length:h.l1*.86,width:1.6});
    for(const side of [-1,1])for(let x=h.x-h.l1*.35;x<h.x+h.l1*.37;x+=2.5){
      tube(g,M.steel,[x,h.y1-.8,iz+side*h.w1/2],[x,h.y1+.05,iz+side*h.w1/2],.055);
    }
  }
  for(const side of [-1,1])modelLabel(g,S.number,ix+3,32.2,iz+side*8.35,11,5,side<0?Math.PI:0);
  for(const [x,z,r] of S.domes){
    mesh(g,new THREE.CylinderGeometry(r*.8,r*.9,1.1,18),M.white,ix+x,roof+.55,iz+z);
    mesh(g,new THREE.SphereGeometry(r,24,16),M.white,ix+x,roof+1.45,iz+z);
  }
  for(const x of [ix-13,ix+9]){
    box(g,M.grey,x,roof+1.3,iz,4.5,2.6,4.0);box(g,M.dark,x,roof+2.61,iz,3.8,.07,3.3);
    for(let y=0;y<2;y+=.3)box(g,M.dark,x,roof+.4+y,iz+2.02,3.6,.055,.03);
  }
  let spin;
  if(S.radar==='integrated'){
    const bottom=roof+2,height=S.mastHeight;
    mesh(g,ringSolid([{y:bottom,points:chamferPlan(ix-3,iz,8,7,1.3)},
      {y:bottom+height*.62,points:chamferPlan(ix-4,iz,4,3.6,.7)}]).geometry,M.grey);
    for(const side of [-1,1]){
      box(g,M.glass,ix-3,roof+8,iz+side*3.0,3.1,3.2,.12).rotation.x=side*.18;
      box(g,M.glass,ix+side*3.6-3,roof+8,iz,.12,3.2,3.1).rotation.z=-side*.18;
    }
    spin=latticeMast(g,M,{x:ix-4,y:bottom+height*.6,z:iz,height:height*.4,width:3.0,radarWidth:3.5});
  }else spin=latticeMast(g,M,{x:ix-5,y:roof+1,z:iz,height:S.mastHeight,width:7.2,radarWidth:8.5});
  for(const [i,span] of S.yardSpans.entries()){
    const y=roof+S.mastHeight*(.50+i*.25);box(g,M.grey,ix-5,y,iz,1.5,.3,span);
    for(const side of [-1,1])for(let z=3;z<span/2;z+=2.2)tube(g,M.dark,[ix-5,y,iz+side*z],[ix-5,y+2,iz+side*z],.055);
  }
  // A separate SPS-48 panel sits forward on Nimitz; Ford carries integrated
  // fixed arrays. The aft move/three lifts/three wires are in its own layout.
  if(S.family==='nimitz'){
    const panel=box(g,M.grey,ix+15,roof+6,iz,4.8,6,.4);panel.rotation.z=-.15;
    tube(g,M.steel,[ix+15,roof,iz],[ix+15,roof+3,iz],.32);
    for(let y=-2.5;y<2.6;y+=.5)box(g,M.steel,ix+15,roof+6+y,iz+.24,4.6,.045,.035);
  }
  for(const side of [-1,1])for(const x of [ix-17,ix+12]){
    tube(g,M.steel,[x,roof,iz+side*6],[x,roof+5,iz+side*6],.07);
  }
  return {spin};
}
const edgeFittings=()=>{};
export const createNuclearCarrier=(spec,options)=>createNavalVessel(spec,{...options,decorate:carrierDetails,fittings:edgeFittings});
