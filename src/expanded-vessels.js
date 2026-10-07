import * as THREE from 'three';
import {HOUBEI,LIAONING,SPIRIT,YAMATO,IOWA,TYPHOON} from './expanded-vessel-layout.js';
import {createNavalVessel,mesh,box,tube,rail,battleshipDetails} from './naval-vessels.js';
import {ringSolid,chamferPlan} from './solid.js';
import {bakeStatic} from './mesh-bake.js';
import {deckHeightAt,deckSlopeAt} from './deck-surface.js';
import {Periscope} from './submarine.js';
import {createHullLoft} from './hull-loft.js';
import {carrierFittings} from './nuclear-carriers.js';
import {modelLabel,latticeMast,radarFaces,funnel,gallery} from './model-fittings.js';
const TAU=2*Math.PI;
function label(g,text,x,y,z,w,h,rotation=0){
  const c=document.createElement('canvas');c.width=1024;c.height=256;const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle='#d8dedb';ctx.font='bold 165px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,135);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
  const m=mesh(g,new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map:texture,transparent:true,roughness:.7,depthWrite:false}),x,y,z);m.rotation.y=rotation;
}
function mast(g,M,x,y,z,height,width){
  for(const side of [-1,1])tube(g,M.steel,[x,y,z+side*width*.25],[x,y+height,z],Math.max(.055,width*.017));
  for(let h=1;h<height;h+=2.2)tube(g,M.steel,[x,y+h,z-width*.25*(1-h/height)],[x,y+h+2,z+width*.25*(1-h/height)],.06);
  tube(g,M.steel,[x,y+height*.65,z-width/2],[x,y+height*.65,z+width/2],.1);
  const spin=new THREE.Group();spin.userData.dynamic=true;spin.position.set(x,y+height,z);
  box(spin,M.dark,0,0,0,.5,1.1,width*.85);bakeStatic(spin);g.add(spin);return spin;
}
function houbeiDetails(g,M,S){
  // Twin hulls leave an open tunnel under the continuous cross deck.
  for(const side of [-1,1])for(let i=0;i<4;i++){
    const unit=box(g,M.grey,-10,4.15,side*(2.0+i*.75),8.8,1.1,.68);unit.rotation.z=.13;
    box(g,M.dark,-5.6,4.7,side*(2.0+i*.75),.07,.8,.54);
  }
  const spin=mast(g,M,-2,8.1,0,8.2,4.5);
  label(g,S.number,12,2.5,5.5,5,1.5);label(g,S.number,12,2.5,-5.5,5,1.5,Math.PI);
  return {spin};
}
function liaoningDetails(g,M,S){
  const segments=48,positions=[],indices=[];
  for(let i=0;i<=segments;i++){
    const x=S.ramp.start+(S.length/2-S.ramp.start)*i/segments,y=deckHeightAt(S,x);
    positions.push(x,y,-S.deckHalfWidthAt(x,-1),x,y,S.deckHalfWidthAt(x,1));
    if(i<segments){const a=2*i;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  const uvFor=vertices=>vertices.flatMap((_,i)=>i%3===0?[.5+vertices[i]/S.length,.5+vertices[i+2]/(S.deckHalfWidth*2)]:[]);
  const ramp=new THREE.BufferGeometry();ramp.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));ramp.setAttribute('uv',new THREE.Float32BufferAttribute(uvFor(positions),2));ramp.setIndex(indices);ramp.computeVertexNormals();
  mesh(g,ramp,M.deck);for(const side of [-1,1]){
    const wall=[];for(let i=0;i<=segments;i++){const k=i*6+(side>0?3:0);wall.push(positions[k],positions[k+1],positions[k+2],positions[k],S.deckY,positions[k+2]);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(wall,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvFor(wall),2));geo.setIndex(side>0?indices:indices.map((v,i)=>indices[i-i%3+2-i%3]));geo.computeVertexNormals();mesh(g,geo,M.grey);
  }
  const k=positions.length-6,front=[positions[k],S.deckY,positions[k+2],positions[k],positions[k+1],positions[k+2],positions[k+3],S.deckY,positions[k+5],positions[k+3],positions[k+4],positions[k+5]],cap=new THREE.BufferGeometry();
  cap.setAttribute('position',new THREE.Float32BufferAttribute(front,3));cap.setAttribute('uv',new THREE.Float32BufferAttribute(uvFor(front),2));cap.setIndex([0,1,2,1,3,2]);cap.computeVertexNormals();mesh(g,cap,M.grey);
  carrierFittings(g,M,S);
  for(const h of S.houses)gallery(g,M,{x:h.x,y:h.y1+.12,z:20-h.w1/2-1,length:h.l1*.9,width:1.4});
  for(const side of [-1,1])modelLabel(g,'16',-26,30.0,20+side*8.1,10,5,side<0?Math.PI:0);
  funnel(g,M,{x:-47,z:20,bottom:36,top:49,length:13,width:9});
  for(const x of [-31,-54])mesh(g,new THREE.SphereGeometry(1.5,20,14),M.white,x,44.5,24);
  radarFaces(g,M,{x:-6,y:47,z:20,width:4.2,height:3.4,offsetX:4.2,offsetZ:3.5,tilt:.14});
  box(g,M.grey,-6,43,20,9,8,7);
  const spin=latticeMast(g,M,{x:-6,y:48,z:20,height:16,width:6.5,radarWidth:7.5});
  for(const side of [-1,1])for(const x of [-66,-43,-19])tube(g,M.steel,[x,36,20+side*5.7],[x,43,20+side*5.7],.09);
  return {spin};
}
function spiritDetails(g,M,S){
  M.hull.map=M.port.map=null;M.hull.color.set(0xdddccf);M.port.color.set(0xdddccf);M.grey.color.set(0xe2e0d5);
  const yellow=new THREE.MeshPhysicalMaterial({color:0xe0dfd3,roughness:.35,metalness:.16,clearcoat:.6});
  for(const side of [-1,1]){
    box(g,yellow,.2,.79,side*.96,6.6,.20,.59);
    tube(g,yellow,[-1,.75,side*.1],[-.8,.79,side*1.2],.12);
    label(g,'SPIRIT',.4,.98,side*1.27,2.2,.36,side<0?Math.PI:0);
  }
  const engine=mesh(g,new THREE.CylinderGeometry(.38,.43,2.8,24),M.steel,-1.7,1.15,0);engine.rotation.z=Math.PI/2;
  for(const side of [-1,1]){const intake=mesh(g,new THREE.SphereGeometry(1,18,12),M.dark,-.9,1.48,side*.43);intake.scale.set(.7,.47,.05);}
  const nozzle=mesh(g,new THREE.CylinderGeometry(.25,.34,.35,20),M.dark,-3.2,1.15,0);nozzle.rotation.z=Math.PI/2;
  box(g,yellow,-2,1.0,0,3.6,.42,.75);
  const canopy=mesh(g,new THREE.SphereGeometry(1,20,16),M.glass,.6,1.45,0);canopy.scale.set(1.15,.48,.38);
  box(g,yellow,-3.1,1.8,0,.9,1.25,.055);box(g,yellow,-3.1,2.5,0,.92,.12,2.1);
  return {};
}
function yamatoDetails(g,M,S){
  for(const [y,l,w] of [[18.5,32,19],[24.6,25,16],[29.5,21,15],[33.1,20,13]]){
    box(g,M.grey,20,y,0,l,.3,w);rail(g,M.steel,[[20-l/2,-w/2],[20+l/2,-w/2],[20+l/2,w/2],[20-l/2,w/2]],y+.15);
  }
  const funnel=mesh(g,ringSolid([{y:11,points:chamferPlan(-12,0,17,12,2)},{y:29,points:chamferPlan(-18,0,15,10,2)}]).geometry,M.grey);
  box(g,M.dark,-18,29.1,0,13,.2,8);
  for(const side of [-1,1])for(let x=-48;x<45;x+=11){const raft=mesh(g,new THREE.CapsuleGeometry(.65,3.5,4,12),M.grey,x,12,side*15.5);raft.rotation.z=Math.PI/2;}
  const spin=mast(g,M,20,33,0,18,11);mast(g,M,-46,13,0,23,7);
  for(const side of [-1,1])label(g,'大和',-109,5.5,side*11.5,7,2,side<0?Math.PI:0);
  return {spin};
}
function typhoonDetails(g,M,S){
  const loft=createHullLoft(S);
  for(const side of [-1,1])for(let i=0;i<10;i++){
    const x=13+i*4.8,z=side*4.5,geo=new THREE.CircleGeometry(2.4,32),p=geo.attributes.position;
    for(let v=0;v<p.count;v++){const xx=x+p.getX(v),zz=z-p.getY(v);p.setXYZ(v,xx,loft.topHeightAt(xx,zz)+.055,zz);}
    geo.computeVertexNormals();mesh(g,geo,M.dark);
    tube(g,M.steel,[x,loft.topHeightAt(x,z-2.1)+.08,z-2.1],[x,loft.topHeightAt(x,z+2.1)+.08,z+2.1],.026);
  }
  for(const x of [-17,-13])tube(g,M.steel,[x,13.1,0],[x,16.1,0],.25);
  const periscope=new Periscope(S.periscope);g.add(periscope.group);
  for(const side of [-1,1]){
    const plane=box(g,M.grey,-20,6.0,side*7.3,9,.4,5.7);plane.rotation.z=.045;
    box(g,M.grey,-78,-1,side*12,7,.5,9);
  }
  for(let i=0;i<12;i++)box(g,M.dark,-15+i*1.2,13.15,-2,.38,.03,.3);
  label(g,'941',-14,9.1,3.7,4,2);label(g,'941',-14,9.1,-3.7,4,2,Math.PI);
  return {periscope};
}
const none=()=>{};
export const createHoubei=o=>createNavalVessel(HOUBEI,{...o,decorate:houbeiDetails});
export const createLiaoning=o=>createNavalVessel(LIAONING,{...o,decorate:liaoningDetails});
export const createSpirit=o=>createNavalVessel(SPIRIT,{...o,decorate:spiritDetails,glazing:none,fittings:none});
export const createYamato=o=>createNavalVessel(YAMATO,{...o,decorate:yamatoDetails});
export const createIowa=o=>createNavalVessel(IOWA,{...o,decorate:battleshipDetails});
export const createTyphoon=o=>createNavalVessel(TYPHOON,{...o,decorate:typhoonDetails,glazing:none,fittings:none});
