import * as THREE from 'three';
import {createNavalVessel,mesh,box,tube,rail} from './naval-vessels.js';
import {modelLabel,latticeMast,vlsBank,radarFaces,liferafts,funnel} from './model-fittings.js';
import {ringSolid,chamferPlan} from './solid.js';
function decorate(g,M,S){
  for(const bank of S.launchBanks)vlsBank(g,M,bank);
  for(const f of S.funnels)funnel(g,M,f);
  if(S.radar)radarFaces(g,M,S.radar);
  const spin=S.mast?latticeMast(g,M,S.mast):null;
  for(const side of [-1,1]){
    liferafts(g,M,{x:-45,y:S.deckY+3,z:side*(S.beamWater*.42),count:5,spacing:2.5});
    modelLabel(g,S.number,S.length*.36,S.deckY*.55,side*S.deckHalfWidthAt(S.length*.36,side),7.5,2.8,side<0?Math.PI:0);
    const x=-S.length*.15,z=side*(S.beamWater*.36);
    const boat=mesh(g,new THREE.CapsuleGeometry(.7,4.6,5,14),M.white,x,S.deckY+2,z);boat.rotation.z=Math.PI/2;boat.scale.z=.67;
    for(const xx of [x-2,x+2])tube(g,M.steel,[xx,S.deckY,z],[xx,S.deckY+3,z],.10);
    for(let xx=-S.length*.19;xx<S.length*.13;xx+=8)mesh(g,new THREE.SphereGeometry(.75,14,10),M.white,xx,S.bridgeRoof.y+.8,side*4);
  }
  const hangar=S.houses.at(-1),doorX=hangar.x-hangar.l0/2-.10;
  for(const side of [-1,1]){
    box(g,M.dark,doorX,S.deckY+3,side*3,.06,5.3,5.4);
    for(let y=S.deckY+.5;y<S.deckY+5.7;y+=.4)box(g,M.steel,doorX-.04,y,side*3,.03,.055,5.3);
  }
  if(!S.mast){
    // Zumwalt's enclosed faceted deckhouse, flush doors, sensor apertures and
    // sharply raked aft hangar distinguish it from conventional destroyers.
    for(const side of [-1,1]){
      for(const [x,y,width,height] of [[-33,21,5.6,3.2],[-7,21,5.6,3.2],[-16,27,4.5,1.9]]){
        const h=S.houses[1],f=(y-h.y0)/(h.y1-h.y0),z=side*(h.w0+(h.w1-h.w0)*f)/2;
        const sensor=box(g,M.dark,x,y,z+side*.04,width,height,.055);sensor.rotation.x=side*Math.atan2((h.w0-h.w1)/2,h.y1-h.y0);
      }
      rail(g,M.steel,[[-92,side*6],[-64,side*6]],S.deckY,{height:.9});
    }
    for(const x of [-14,-22]){
      mesh(g,ringSolid([{y:31,points:chamferPlan(x,0,4,3,.3)},{y:35,points:chamferPlan(x-.5,0,1.7,1.7,.2)}]).geometry,M.grey);
      box(g,M.dark,x-.5,35.02,0,1.6,.06,1.5);
    }
  }
  return {spin};
}
export const createModernWarship=(spec,options)=>createNavalVessel(spec,{...options,decorate});
