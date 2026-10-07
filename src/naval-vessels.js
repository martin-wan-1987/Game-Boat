import * as THREE from 'three';
import {DESTROYER,BATTLESHIP,PILOT} from './new-vessel-layout.js';
import {createHullLoft} from './hull-loft.js';
import {ringSolid,chamferPlan} from './solid.js';
import {buildPropulsion} from './propulsion.js';
import {WeaponBattery} from './weapons.js';
import {bakeStatic} from './mesh-bake.js';
import {drawFlightDeck} from './flight-deck.js';
import {insideOutline} from './deck-surface.js';
const TAU=Math.PI*2,UP=new THREE.Vector3(0,1,0);
function mesh(g,geo,mat,x=0,y=0,z=0){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;g.add(m);return m;}
const box=(g,m,x,y,z,l,h,w)=>mesh(g,new THREE.BoxGeometry(l,h,w),m,x,y,z);
function tube(g,m,a,b,r=.06){const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),part=mesh(g,new THREE.CylinderGeometry(r,r,d.length(),10),m,...A.add(B).multiplyScalar(.5).toArray());part.quaternion.setFromUnitVectors(UP,d.normalize());return part;}
function tex(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;}
function paintTexture(rust=0){return tex(512,512,(g,w,h)=>{
  g.fillStyle='#e4e6e4';g.fillRect(0,0,w,h);
  for(let i=0;i<1500;i++){g.fillStyle=i%2?'rgba(34,40,43,.055)':'rgba(245,239,221,.04)';g.fillRect((i*.6180339%1)*w,(i*.4142135%1)*h,1+i%5,1+i%8);}
  g.strokeStyle='rgba(30,40,45,.13)';g.lineWidth=1;for(let x=0;x<w;x+=128)g.strokeRect(x,0,128,512);
  for(let i=0;i<32;i++){g.fillStyle=`rgba(122,65,36,${rust*.6})`;g.fillRect((i*.6180339%1)*w,(i*.4142135%1)*h,1+i%3,7+i%38);}
});}
function hullTexture(S,side){return tex(4096,512,(g,w,h)=>{
  const py=y=>(1-(y+S.draft+1)/(S.hullTopY+S.draft+2))*h;
  g.fillStyle=S.appearance.hull;g.fillRect(0,0,w,h);
  g.fillStyle=S.appearance.antifoul;g.fillRect(0,py(-.25),w,h-py(-.25));
  g.fillStyle='#20282b';g.fillRect(0,py(.35),w,py(-.25)-py(.35));
  for(let i=0;i<2100;i++){g.fillStyle=i%2?'rgba(21,30,35,.055)':'rgba(235,223,194,.035)';g.fillRect((i*.6180339%1)*w,(i*.4142135%1)*h,1+i%12,1+i%8);}
  g.strokeStyle='rgba(23,32,39,.14)';g.lineWidth=1;for(let i=0;i<80;i++)g.strokeRect(i*w/80,0,w/80,h);
  for(let i=0;i<95;i++){
    const x=(i*.6180339%1)*w,top=py(.45+(i%7)*.53),len=8+i%51;
    const gradient=g.createLinearGradient(0,top,0,top+len);gradient.addColorStop(0,`rgba(122,67,39,${S.appearance.rust*2})`);gradient.addColorStop(1,'rgba(122,67,39,0)');g.fillStyle=gradient;g.fillRect(x,top,1+i%4,len);
  }
  g.save();g.translate(w*.927,py(S.hullTopY*.54));if(side<0)g.scale(-1,1);g.font=`${S.length<30?'bold ':''}${S.length<30?50:95}px Arial`;g.textAlign='center';g.lineWidth=3;g.strokeStyle='#3d464a';g.strokeText(S.number,0,0);g.fillStyle='#e0e0d9';g.fillText(S.number,0,0);g.restore();
});}
function deckTexture(S){return tex(4096,1024,(g,w,h)=>{
  const px=x=>(.5+x/S.length)*w,pz=z=>(.5-z/(S.deckHalfWidth*2))*h;
  g.fillStyle=S.appearance.deck;g.fillRect(0,0,w,h);
  if(S.appearance.planks){
    for(let i=0;i<220;i++){const z=i*h/220;g.fillStyle=i%3?'#8c7c66':'#9d8b70';g.fillRect(0,z,w,Math.max(1,h/220-1));
      g.strokeStyle='rgba(38,28,22,.22)';g.lineWidth=.6;for(let x=(i%3)*91;x<w;x+=280){g.beginPath();g.moveTo(x,z);g.lineTo(x,z+h/220);g.stroke();}}
  }
  for(let i=0;i<1500;i++){g.fillStyle='rgba(20,23,25,.05)';g.fillRect((i*.6180339%1)*w,(i*.4142135%1)*h,8+i%15,1+i%5);}
  drawFlightDeck(g,S,w,h);
  if(S.helipad){
    const {x,radius:R}=S.helipad;g.strokeStyle='#d0cdc0';g.lineWidth=4;g.beginPath();g.arc(px(x),pz(0),R*h/(2*S.deckHalfWidth),0,TAU);g.stroke();
    g.fillStyle='#d0cdc0';g.font='bold 95px Arial';g.textAlign='center';g.fillText('H',px(x),pz(0)+28);
    g.strokeStyle='#bda74e';g.lineWidth=5;g.beginPath();g.moveTo(px(-88),pz(0));g.lineTo(px(-57),pz(0));g.stroke();
  }
});}
const materialCache=new WeakMap();
function camouflage(material,pattern){
  const colours=pattern.colours.map(c=>new THREE.Color(c));
  material.onBeforeCompile=shader=>{
    shader.uniforms.uCamoPalette={value:colours};shader.uniforms.uCamoScale={value:pattern.scale};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vPaintLocal;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvPaintLocal=position;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vPaintLocal;uniform vec3 uCamoPalette[4];uniform float uCamoScale;')
      .replace('#include <color_fragment>',`#include <color_fragment>
        vec3 p=vPaintLocal/uCamoScale;float paintRegion=sin(p.x*1.4+p.y*.8+sin(p.z*1.7))+.62*cos(p.y*2.1-p.x*.7)+.48*sin(p.z*2.3+p.x*.5);
        vec3 camo=paintRegion<-.55?uCamoPalette[1]:paintRegion<.2?uCamoPalette[2]:paintRegion<.8?uCamoPalette[0]:uCamoPalette[3];
        diffuseColor.rgb=camo;`);
  };
  material.customProgramCacheKey=()=> 'naval-camouflage-v2';
}
function materials(S){
  if(materialCache.has(S))return materialCache.get(S);
  const paint=paintTexture(S.appearance.rust);
  const result={hull:new THREE.MeshPhysicalMaterial({name:S.name+' hull',map:hullTexture(S,1),roughness:.48,metalness:.16,clearcoat:.32,clearcoatRoughness:.22}),
    port:new THREE.MeshPhysicalMaterial({name:S.name+' port hull',map:hullTexture(S,-1),roughness:.48,metalness:.16,clearcoat:.32,clearcoatRoughness:.22}),
    grey:new THREE.MeshStandardMaterial({name:'Painted naval structure',color:S.appearance.paint,map:paint,roughness:.60,metalness:.14,flatShading:true}),
    deck:new THREE.MeshStandardMaterial({name:'Working deck',map:deckTexture(S),roughness:.79,metalness:S.appearance.planks?.02:.14,flatShading:true}),
    nonSkid:new THREE.MeshStandardMaterial({name:'Non-skid fittings',color:S.appearance.deck,roughness:.82,metalness:.08}),
    dark:new THREE.MeshStandardMaterial({name:'Dark machinery',color:0x323d45,roughness:.52,metalness:.45}),
    glass:new THREE.MeshPhysicalMaterial({name:'Marine windows',color:0x162c39,roughness:.12,metalness:.47,clearcoat:1}),
    steel:new THREE.MeshStandardMaterial({name:'Railings',color:0x7d878d,roughness:.38,metalness:.75}),
    white:new THREE.MeshStandardMaterial({name:'Domes and life rafts',color:0xbfc6c5,roughness:.65}),
    rubber:new THREE.MeshStandardMaterial({name:'Rubber fendering',color:0x181d23,roughness:.82}),
    orange:new THREE.MeshStandardMaterial({name:'Lifesaving gear',color:0xc85723,roughness:.66}),
  };
  if(S.appearance.camouflage)for(const key of ['hull','port','grey'])camouflage(result[key],S.appearance.camouflage);
  materialCache.set(S,result);return result;
}
function rail(g,M,points,y,{height=1.05,spacing=3,radius=.045}={}){
  for(let i=0;i<points.length-1;i++){
    const [a,b]=[points[i],points[i+1]],length=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(length/spacing);
    for(const h of [.5,1])tube(g,M,[a[0],y+height*h,a[1]],[b[0],y+height*h,b[1]],radius);
    for(let j=0;j<n;j++){const f=j/n,x=a[0]+f*(b[0]-a[0]),z=a[1]+f*(b[1]-a[1]);tube(g,M,[x,y,z],[x,y+height,z],radius*1.35);}
  }
}
function windows(g,M,S){
  for(const h of S.houses){
    const y=h.y1-.95;
    const t=(y-h.y0)/(h.y1-h.y0),width=h.w0+(h.w1-h.w0)*t,length=h.l0+(h.l1-h.l0)*t;
    const sideTilt=Math.atan2((h.w0-h.w1)/2,h.y1-h.y0),frontTilt=Math.atan2((h.l0-h.l1)/2,h.y1-h.y0);
    const W=S.windows??{spacing:2.2,width:1.5,height:.55,frontSpacing:1.4,frontWidth:1.15};
    for(const side of [-1,1])for(let x=h.x-h.l1*.40;x<=h.x+h.l1*.40;x+=W.spacing){
      box(g,M.dark,x,y,h.z+side*(width/2+.04),W.width,W.height,.09).rotation.x=-side*sideTilt;
      box(g,M.glass,x,y,h.z+side*(width/2+.10),W.width*.85,W.height*.78,.025).rotation.x=-side*sideTilt;
    }
    if(h.y1>=S.bridgeEye[1])for(let z=-h.w1*.34;z<h.w1*.4;z+=W.frontSpacing){
      box(g,M.dark,h.x+length/2+.04,y,h.z+z,.1,W.height*1.35,W.frontWidth).rotation.z=frontTilt;
      box(g,M.glass,h.x+length/2+.10,y,h.z+z,.025,W.height*1.08,W.frontWidth*.85).rotation.z=frontTilt;
    }
  }
}
function commonFittings(g,M,S,loft){
  const pilot=S.id==='pilot',r=pilot?.023:.065;
  rail(g,M.steel,[...S.deckOutline,S.deckOutline[0]],S.deckY,{height:pilot?.84:1.05,spacing:pilot?.85:3.5,radius:pilot?.023:.045});
  for(const side of [-1,1]){
    const anchor=loft.point(.93,.74,side),size=pilot?.14:.72;
    mesh(g,new THREE.CircleGeometry(size,12),M.dark,anchor.x,anchor.y,anchor.z+side*.03).rotation.y=side>0?0:Math.PI;
    tube(g,M.steel,[anchor.x,anchor.y,anchor.z+side*.1],[anchor.x,anchor.y-size*1.5,anchor.z+side*.1],size*.15);
    tube(g,M.steel,[anchor.x-size*.7,anchor.y-size*1.3,anchor.z+side*.1],[anchor.x+size*.7,anchor.y-size*1.3,anchor.z+side*.1],size*.2);
    for(let i=0;i<(pilot?4:18);i++){
      const x=-S.length*.4+i*S.length*.8/(pilot?4:18),z=side*(S.deckHalfWidthAt(x,side)-.45);
      box(g,M.dark,x,S.deckY+.13,z,pilot?.3:.9,pilot?.16:.25,pilot?.25:.6);
      for(const d of [-1,1])tube(g,M.steel,[x+d*(pilot?.1:.25),S.deckY,z],[x+d*(pilot?.1:.25),S.deckY+(pilot?.28:.65),z],r*2);
    }
    for(const x of pilot?[-3.5,-.4]:[-S.length*.22,0,S.length*.21]){
      const z=side*(S.deckHalfWidthAt(x,side)-.65),ring=mesh(g,new THREE.TorusGeometry(pilot?.23:.44,pilot?.07:.115,8,20),M.orange,x,S.deckY+(pilot?1:1.4),z);ring.rotation.y=0;
    }
  }
  for(const h of S.houses)for(const side of [-1,1]){
    for(let y=h.y0+.5;y<h.y1;y+=.34)tube(g,M.steel,[h.x-h.l0*.32,y,side*(h.w0/2+.13)],[h.x-h.l0*.32+.65,y,side*(h.w0/2+.13)],r*.6);
    box(g,M.dark,h.x-h.l0*.2,h.y0+1.05,side*(h.w0/2+.07),.75,1.65,.035);
  }
}
function vls(g,M,x,y,rows,cols){
  box(g,M.grey,x+(rows-1)*.68,y+.12,0,rows*1.36,.22,cols*1.12+.25);
  for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){
    const z=(j-(cols-1)/2)*1.12;
    box(g,M.dark,x+i*1.36,y+.25,z,1.15,.06,.94);box(g,M.grey,x+i*1.36,y+.30,z,1.03,.065,.82);
    box(g,M.steel,x+i*1.36+.32,y+.35,z+.27,.2,.04,.08);
  }
}
function destroyerDetails(g,M,S){
  const D=S.deckY;
  vls(g,M,43,D,8,8);vls(g,M,-26,D,6,8);
  const mastBase=S.bridgeRoof.y;
  mesh(g,ringSolid([{y:mastBase,points:chamferPlan(8,0,15,9,1.7)},{y:mastBase+14,points:chamferPlan(8,0,7,5,1.1)}]).geometry,M.grey);
  for(const side of [-1,1]){
    box(g,M.dark,8,23,side*4.65,6,.09,.10).rotation.x=side*.10;
    const panel=box(g,M.glass,9,20,side*4.97,5.5,4,.12);panel.rotation.x=side*.12;
    for(let x=-7;x<=20;x+=7)mesh(g,new THREE.SphereGeometry(.8,14,10),M.white,x,17.15,side*5.7);
    for(let x=-44;x<=-39;x+=2.6){const raft=mesh(g,new THREE.CylinderGeometry(.4,.4,1.75,12),M.white,x,D+2.3,side*8.25);raft.rotation.z=Math.PI/2;}
    box(g,M.dark,-55,8.5,side*4.1,.07,5.2,6.2).rotation.y=Math.PI/2;
  }
  for(const [x,top,l,w] of [[-9,22,13,12],[-37,16.7,9,11]]){
    mesh(g,ringSolid([{y:12,points:chamferPlan(x,0,l,w,2)},{y:top,points:chamferPlan(x-1,0,l*.7,w*.7,1.5)}]).geometry,M.grey);
    box(g,M.dark,x-1,top+.03,0,l*.68,.08,w*.68);
    for(let z=-w*.3;z<w*.35;z+=.9)box(g,M.steel,x-1,top+.1,z,l*.65,.13,.14);
  }
  const spin=new THREE.Group();spin.position.set(8,mastBase+16,0);spin.userData.dynamic=true;
  box(spin,M.dark,0,0,0,1.3,.45,4.5);tube(spin,M.steel,[0,-2,0],[0,1.5,0],.10);bakeStatic(spin);g.add(spin);
  for(const [x,z] of [[-43,-5.5],[-43,5.5],[18,-6.5],[18,6.5]])tube(g,M.steel,[x,16,z],[x,22,z],.06);
  return {spin};
}
function battleshipDetails(g,M,S){
  const parent=g;g=new THREE.Group();parent.add(g);g.position.y=S.deckLift??0;
  const D=S.deckY-(S.deckLift??0);
  for(const [x,y,l,w] of [[-4,27,12,9.5],[-40,23,10,9]]){
    mesh(g,ringSolid([{y:8.7,points:chamferPlan(x,0,l,w,2)},{y,points:chamferPlan(x-1,0,l*.8,w*.88,2)}]).geometry,M.grey);
    box(g,M.dark,x-1,y+.04,0,l*.65,.09,w*.62);
    for(const side of [-1,1])for(let h=10;h<y;h+=1.6)tube(g,M.steel,[x-l*.37,h,side*w*.46],[x+l*.30,h,side*w*.46],.045);
  }
  for(const side of [-1,1]){
    for(const [x,y,l] of [[26,13.35,33],[24,18.05,27],[24,23.9,23],[-29,10.7,52]])rail(g,M.steel,[[x-l/2,side*9],[x+l/2,side*9]],y);
    for(const x of S.historicalFit===1945?[]:[-38,-25])for(let j=0;j<4;j++){
      const launcher=box(g,M.grey,x,12,side*(7.4+j*.82),7,1.0,.75);launcher.rotation.z=.1;
      box(g,M.dark,x+3.55,12.33,side*(7.4+j*.82),.09,.75,.65);
    }
    const boat=mesh(g,new THREE.CapsuleGeometry(1,6,4,12),M.white,-54,10,side*9.4);boat.rotation.z=Math.PI/2;boat.scale.z=.62;
    tube(g,M.steel,[-56,10,side*10],[-56,16,side*10],.1);tube(g,M.steel,[-56,16,side*10],[-50,14,side*12],.08);
    for(let x=-49;x<48;x+=7.5){const raft=mesh(g,new THREE.CylinderGeometry(.45,.45,1.9,12),M.white,x,9.5,side*12.4);raft.rotation.z=Math.PI/2;}
  }
  // Lattice masts, radar dishes and yards; all stay on the same tower datum.
  for(const [x,y] of [[24,28],[-37,24]]){
    for(const z of [-2,2])tube(g,M.steel,[x-1,y,z],[x,48-(x<0?9:0),0],.17);
    for(let h=y;h<46-(x<0?9:0);h+=2.2){tube(g,M.steel,[x-1,h,-1.8],[x+1,h+2.2,1.8],.07);tube(g,M.steel,[x-1,h,1.8],[x+1,h+2.2,-1.8],.07);}
    for(const h of [y+4,y+10])tube(g,M.steel,[x,h,-8],[x,h,8],.12);
    for(const z of [-7,-4,4,7])tube(g,M.steel,[x,y+10,z],[x,y+14,z],.045);
  }
  const spin=new THREE.Group();spin.position.set(24,48,0);spin.userData.dynamic=true;
  box(spin,M.dark,0,0,0,.35,4.3,7.6);for(let z=-3.8;z<4;z+=.76)tube(spin,M.steel,[.19,-2,z],[.19,2,z],.045);bakeStatic(spin);g.add(spin);
  const dish=mesh(g,new THREE.SphereGeometry(1.8,16,12,0,TAU,0,Math.PI*.48),M.dark,33,31,0);dish.rotation.z=-Math.PI/2;
  for(let x=-115;x<115;x+=16)for(const side of [-1,1])box(g,M.grey,x,D+.4,side*Math.max(.5,S.deckHalfWidthAt(x,side)-1.5),1.1,.8,.75);
  return {spin};
}
function pilotDetails(g,M,S){
  const D=S.deckY;
  // Heavy shoulder fenders and diagonal rub strips, as on the real 48.
  for(const side of [-1,1]){
    const edge=S.deckOutline.filter(p=>p[1]*side>=0);
    for(let i=0;i<edge.length-1;i++)tube(g,M.rubber,[edge[i][0],D,edge[i][1]],[edge[i+1][0],D,edge[i+1][1]],.15);
    for(let x=-6;x<5;x+=1.2){const z=side*(S.deckHalfWidthAt(x,side)-.12);tube(g,M.rubber,[x+.35,D-.05,z],[x-.3,-.07,z],.09);}
    const label=tex(512,128,(c,w,h)=>{c.fillStyle='#d6a634';c.fillRect(0,0,w,h);c.fillStyle='#19252c';c.font='bold 90px Arial';c.textAlign='center';c.fillText('PILOT',w/2,98);});
    const plate=mesh(g,new THREE.PlaneGeometry(2,.5),new THREE.MeshStandardMaterial({map:label,roughness:.6}),-1,2.1,side*1.43);if(side<0)plate.rotation.y=Math.PI;
    box(g,M.dark,-3.5,2.45,side*1.32,.65,1.6,.06);
    for(const x of [-2.2,-.7,.8]){
      tube(g,M.steel,[x,2.9,side*1.46],[x+.23,3.25,side*1.46],.018);
      tube(g,M.steel,[x,3.08,side*1.46],[x+.42,3.08,side*1.46],.013);
    }
  }
  box(g,M.grey,3.2,1.62,0,2.4,.42,2.2);box(g,M.dark,3.1,1.86,0,1,.05,.9);
  tube(g,M.steel,[-1.8,3.75,0],[-1.8,6.25,0],.046);
  for(const z of [-.7,.7]){tube(g,M.steel,[-1.8,4.9,z],[-1.8,6.6,z],.017);tube(g,M.steel,[-2.3,4.9,z],[-1.3,4.9,z],.025);}
  const spin=new THREE.Group();spin.position.set(-1.8,4.55,0);spin.userData.dynamic=true;box(spin,M.white,0,0,0,.23,.18,1.2);bakeStatic(spin);g.add(spin);
  mesh(g,new THREE.SphereGeometry(.23,12,10),M.white,-2.5,3.96,0);
  box(g,M.dark,-6.9,1.02,0,1.25,.16,2.4);rail(g,M.steel,[[-7.35,-1.2],[-7.35,1.2]],1.1,{height:.72,spacing:.6,radius:.022});
  for(let i=0;i<5;i++)tube(g,M.steel,[-6.2,.3+i*.2,-1.9],[-6.2,.3+i*.2,-1.55],.026);
  return {spin};
}
const details={destroyer:destroyerDetails,battleship:battleshipDetails,pilot:pilotDetails};
export function createNavalVessel(S,{quality='high',decorate=details[S.id],glazing=windows,fittings=commonFittings}={}){
  const g=new THREE.Group();g.name=S.name;const M=materials(S),loft=createHullLoft(S);
  g.add(loft.buildMesh(M.hull,M.port,quality==='low'?72:128,quality==='low'?16:26));
  if(S.deckStructure!==false){
    const deck=ringSolid([{y:S.hullTopY,points:S.deckOutline},{y:S.deckY,points:S.deckOutline}]).geometry;
    const pos=deck.attributes.position,uv=deck.attributes.uv;
    for(let i=0;i<pos.count;i++)uv.setXY(i,.5+pos.getX(i)/S.length,.5+pos.getZ(i)/(S.deckHalfWidth*2));
    mesh(g,deck,M.deck);
  }
  const patches=loft.buildPatches(quality==='low'?18:26,quality==='low'?10:14);
  for(const h of S.houses){const solid=ringSolid(h.rings);mesh(g,solid.geometry,M.grey);}
  glazing(g,M,S);fittings(g,M,S,loft);const animated=decorate(g,M,S);
  for(const w of S.weapons){
    const [x,y,z]=w.position;
    const support=S.houses.filter(h=>h.y1<=y+.05&&insideOutline(h.rings.at(-1).points,x,z)).reduce((top,h)=>Math.max(top,h.y1),S.deckY);
    if(y>support+.1)mesh(g,new THREE.CylinderGeometry(w.width*.46,w.width*.48,y-support,20),M.grey,x,(y+support)/2,z);
    if(w.openMount){const tray=mesh(g,new THREE.CylinderGeometry(w.width*.7,w.width*.7,.18,20),M.grey,x,y-.09,z);tray.name=w.id+' gun platform';}
  }
  const propulsion=buildPropulsion(S);g.add(propulsion.group);const weapons=new WeaponBattery(S.weapons,S.battery);g.add(weapons.group);
  bakeStatic(g);g.userData={vessel:S,loft,patches,propulsion,weapons,...animated};return g;
}
export const createDestroyer=opts=>createNavalVessel(DESTROYER,opts);
export const createBattleship=opts=>createNavalVessel(BATTLESHIP,opts);
export const createPilot=opts=>createNavalVessel(PILOT,opts);
export {mesh,box,tube,rail,battleshipDetails};
