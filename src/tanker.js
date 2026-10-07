import * as THREE from 'three';
import {TANKER as S,CARGO_TANKS,PIPE_BANK} from './tanker-layout.js';
import {createHullLoft} from './hull-loft.js';
import {bakeStatic} from './mesh-bake.js';
import {buildPropulsion} from './propulsion.js';
import {WeaponBattery} from './weapons.js';

function texture(width,height,draw){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  draw(canvas.getContext('2d'),width,height);
  const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;
}
function mesh(g,geo,mat,x=0,y=0,z=0){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;g.add(m);return m;}
const box=(g,mat,x,y,z,l,h,w)=>mesh(g,new THREE.BoxGeometry(l,h,w),mat,x,y,z);
function tube(g,mat,a,b,r=.07){
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),dir=end.clone().sub(start);
  const m=mesh(g,new THREE.CylinderGeometry(r,r,dir.length(),10),mat,...start.clone().add(end).multiplyScalar(.5).toArray());
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());return m;
}
function rail(g,mat,points,y){
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],length=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(length/4.5);
    for(const h of [.55,1.05])tube(g,mat,[a[0],y+h,a[1]],[b[0],y+h,b[1]],.045);
    for(let j=0;j<n;j++){const f=j/n,x=a[0]+f*(b[0]-a[0]),z=a[1]+f*(b[1]-a[1]);tube(g,mat,[x,y,z],[x,y+1.06,z],.065);}
  }
}
function hullTexture(mirror){return texture(4096,512,(g,w,h)=>{
  const py=y=>(1-(y+S.draft+1)/(S.hullTopY+S.draft+2))*h;
  g.fillStyle='#75372e';g.fillRect(0,0,w,h);
  const colour=g.createLinearGradient(0,0,0,h);colour.addColorStop(0,'#8c4536');colour.addColorStop(.25,'#743b2f');colour.addColorStop(1,'#57302a');g.fillStyle=colour;g.fillRect(0,0,w,h);
  const antifouling=g.createLinearGradient(0,py(-.9),0,h);antifouling.addColorStop(0,'#965242');antifouling.addColorStop(.55,'#824031');antifouling.addColorStop(1,'#682f29');g.fillStyle=antifouling;g.fillRect(0,py(-.9),w,h-py(-.9));
  g.fillStyle='#26272b';g.fillRect(0,py(.65),w,py(-.9)-py(.65));
  for(let i=0;i<1700;i++){
    const x=(i*.6180339%1)*w,y=(i*.4142135%1)*h;
    g.strokeStyle=`rgba(${i%3?'47,42,29':'172,112,64'},${.03+(i%7)*.009})`;g.lineWidth=1+i%3;
    g.beginPath();g.moveTo(x,y);g.lineTo(x+Math.sin(i)*2,y+12+i%77);g.stroke();
  }
  g.strokeStyle='rgba(24,26,24,.19)';g.lineWidth=1;
  for(let x=0;x<w;x+=w/58){g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}
  for(let y=0;y<h;y+=h/13){g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();}
  g.save();g.translate(w*.923,py(2.9));if(mirror)g.scale(-1,1);g.font='bold 35px Arial';g.textAlign='center';g.fillStyle='#e5dccb';g.fillText(S.number,0,0);g.restore();
  // Draft numerals are measured up from the keel; the loaded boot stripe
  // stays exposed above the sea when the ship sails in ballast.
  for(const t of [.04,.86]){g.save();g.translate(w*t,0);if(mirror)g.scale(-1,1);g.fillStyle='#dcd7c6';g.font='13px monospace';for(let metres=2;metres<24;metres+=2)g.fillText(String(metres),0,py(metres-S.draft));g.restore();}
});}
function deckTexture(){return texture(4096,1024,(g,w,h)=>{
  g.fillStyle='#865244';g.fillRect(0,0,w,h);
  const px=x=>(x+S.length/2)/S.length*w,pz=z=>(.5-z/S.beamWater)*h;
  for(let x=-225;x<220;x+=5){g.strokeStyle='rgba(30,27,24,.13)';g.lineWidth=1;g.beginPath();g.moveTo(px(x),0);g.lineTo(px(x),h);g.stroke();}
  for(let i=0;i<5000;i++){g.fillStyle=i%2?'rgba(18,17,15,.055)':'rgba(226,193,143,.045)';g.fillRect((i*.6180339%1)*w,(i*.4142135%1)*h,4+i%22,1+i%3);}
  g.strokeStyle='#b8a267';g.lineWidth=5;for(const z of [-30,30]){g.beginPath();g.moveTo(px(-147),pz(z));g.lineTo(px(170),pz(z));g.stroke();}
  g.strokeStyle='#c9bca2';g.lineWidth=5;g.beginPath();g.arc(px(111),pz(-21),h*8/S.beamWater,0,Math.PI*2);g.stroke();
  g.fillStyle='#d3c7ac';g.font='bold 42px Arial';g.textAlign='center';g.fillText('H',px(111),pz(-21)+13);
});}
function fittings(g,m){
  const y=S.deckY;
  // Continuous raised cargo lines, actual manifolds, valves and expansion bends.
  for(const pipe of PIPE_BANK){
    tube(g,m.pipe,[-145,y+1.35,pipe.z],[178,y+1.35,pipe.z],pipe.radius);
    for(let x=-137;x<176;x+=13.8)box(g,m.dark,x,y+.55,pipe.z,1,.7,pipe.radius*2.8);
    for(const x of [-142,-42,45,164]){
      tube(g,m.pipe,[x,y+1.35,pipe.z],[x,y+3,pipe.z],pipe.radius);
      tube(g,m.pipe,[x,y+3,pipe.z],[x+3,y+3,pipe.z],pipe.radius);
      tube(g,m.pipe,[x+3,y+3,pipe.z],[x+3,y+1.35,pipe.z],pipe.radius);
    }
  }
  for(const {x,z} of CARGO_TANKS){
    box(g,m.deck,x,y+.2,z,18,.4,8.7);rail(g,m.rail,[[x-9,z-4.4],[x+9,z-4.4]],y+.4);
    mesh(g,new THREE.CylinderGeometry(1.15,1.3,.65,18),m.pipe,x+3,y+.72,z);
    const hatch=mesh(g,new THREE.CylinderGeometry(1.18,1.18,.09,20),m.dark,x+3,y+1.09,z);
    for(let i=0;i<10;i++){const a=i*Math.PI/5;box(g,m.rail,x+3+Math.cos(a)*1.06,y+1.17,z+Math.sin(a)*1.06,.09,.09,.09);}
    tube(g,m.pipe,[x-4,y+.8,z],[x-4,y+3.4,z],.18);mesh(g,new THREE.SphereGeometry(.32,10,8),m.pipe,x-4,y+3.4,z);
  }
  for(const side of [-1,1]){
    for(const x of [-32,0,32]){
      tube(g,m.pipe,[x,y+1.5,side*4.8],[x,y+1.5,side*27],.68);
      for(const z of [12,20,26]){
        tube(g,m.pipe,[x,y+1.5,side*z],[x,y+2.6,side*z],.32);
        const wheel=mesh(g,new THREE.TorusGeometry(.55,.07,6,16),m.red,x,y+2.8,side*z);wheel.rotation.x=Math.PI/2;
        for(const d of [-.4,.4])tube(g,m.red,[x+d,y+2.8,side*z],[x-d,y+2.8,side*z],.04);
      }
      box(g,m.deck,x,y+1.6,side*28,3,2,2.5);
    }
  }
  rail(g,m.rail,[...S.deckOutline,S.deckOutline[0]],y+.12);
  for(const x of [-202,-130,-47,45,154,205]){
    for(const side of [-1,1]){const z=side*(S.deckHalfWidthAt(x,side)-2);for(const dx of [-.65,.65])mesh(g,new THREE.CylinderGeometry(.35,.47,1.1,10),m.dark,x+dx,y+.7,z);}
  }
  // Raised forecastle and chain/windlass deck, matched to bow photographs.
  const fore=new THREE.Shape();const pts=[[177,25],[203,19],[220,10],[229,1.3],[229,-1.3],[220,-10],[203,-19],[177,-25]];
  pts.forEach(([x,z],i)=>i?fore.lineTo(x,-z):fore.moveTo(x,-z));fore.closePath();
  const fg=new THREE.ExtrudeGeometry(fore,{depth:3,bevelEnabled:false});fg.rotateX(-Math.PI/2);mesh(g,fg,m.deck,0,y,0);
  rail(g,m.rail,pts,y+3);
  for(const side of [-1,1]){
    box(g,m.dark,192,y+3.4,side*11,5,.8,3);tube(g,m.steel,[184,y+4.2,side*11],[199,y+4.2,side*11],.6);
    for(let j=0;j<15;j++){const ring=mesh(g,new THREE.TorusGeometry(.32,.095,5,10),m.dark,199+j*1.3,y+3.25,side*11);ring.rotation.x=Math.PI/2+(j%2)*Math.PI/2;}
    const anchor=new THREE.Group();anchor.position.set(214,y+1.3,side*13);tube(anchor,m.dark,[0,-2,0],[0,1.5,0],.21);tube(anchor,m.dark,[-1.5,-1.5,0],[1.5,-1.5,0],.23);g.add(anchor);
  }
  for(const x of [-94,71,186]){
    tube(g,m.cream,[x,y,0],[x,y+25,0],.28);tube(g,m.cream,[x,y+19,-9],[x,y+19,9],.16);
    for(const side of [-1,1])tube(g,m.steel,[x,y+22,0],[x+21,y+9,side*24],.045);
    for(const z of [-6,6])box(g,m.dark,x,y+19,z,.6,1.3,.7);
  }
  // White twin-post cargo derricks in front of the aft house.
  for(const side of [-1,1]){
    tube(g,m.cream,[-142,y,side*20],[-142,y+23,side*20],.65);
    tube(g,m.cream,[-142,y+22,side*20],[-103,y+15,side*20],.39);
    tube(g,m.steel,[-142,y+25,side*20],[-103,y+15,side*20],.045);
    tube(g,m.steel,[-103,y+15,side*20],[-103,y+4,side*20],.04);
  }
  for(let x=-119;x<171;x+=28)for(const side of [-1,1])box(g,m.red,x,y+1.1,side*29,.8,1.3,.5);
}
function accommodation(g,m){
  const base=S.deckY;
  for(let level=0;level<5;level++){
    const length=53-level*3.1,width=51-level*3.6,y=base+2.4+level*4.05;
    box(g,m.cream,-183,y,0,length,4,width);
    for(const side of [-1,1]){
      for(let x=-205+level*1.5;x<-162-level*1.5;x+=3.6)box(g,m.glass,x,y+.5,side*(width/2+.025),1.65,1.55,.09);
      const z=side*(width/2+1.2);box(g,m.cream,-183,y-1.75,z,length+1,.32,2.6);rail(g,m.rail,[[-183-length/2,z+side*1.2],[-183+length/2,z+side*1.2]],y-1.5);
    }
  }
  // Open forward bridge band; the bridge camera sits just behind its glass.
  box(g,m.cream,-174,26.8,0,35,.7,43);
  const roof=S.bridgeRoof;box(g,m.cream,roof.x,roof.y-roof.thickness/2,roof.z,roof.length,roof.thickness,roof.width);
  box(g,m.cream,-192,28.75,0,1,3.4,43);
  for(const side of [-1,1])box(g,m.cream,-174,28.7,side*21.7,35,3.4,.4);
  for(let z=-20;z<=20;z+=3.5){box(g,m.glass,-156.3,28.8,z,.07,2.7,3.1);box(g,m.cream,-156.2,28.8,z+1.55,.38,3.4,.18);}
  for(const side of [-1,1]){
    box(g,m.cream,-172,27.4,side*29.5,13,.65,16);rail(g,m.rail,[[-178.5,side*37.5],[-165.5,side*37.5],[-165.5,side*22]],27.75);
    for(const x of [-177,-167])tube(g,m.cream,[x,base+16,side*23],[x,27.4,side*34],.25);
    // Lifeboats under davits, without crew.
    const boat=mesh(g,new THREE.CapsuleGeometry(1.45,6,4,12),m.orange,-200,base+8,side*29);boat.rotation.z=Math.PI/2;
    for(const x of [-204,-196])tube(g,m.cream,[x,base+6,side*26],[x,base+12,side*31],.19);
  }
  box(g,m.dark,-193,37.8,1,12,12,10);box(g,m.red,-193,37.8,1,12.2,3.2,10.2);
  for(const z of [-2.2,1,4.2])mesh(g,new THREE.CylinderGeometry(1.12,1.12,.3,12),m.black,-193,44,z);
  const mast=new THREE.Group();mast.position.set(-171,31.2,0);
  tube(mast,m.cream,[0,0,0],[0,20,0],.22);for(const y of [5,12,18])tube(mast,m.cream,[0,y,-7],[0,y,7],.1);
  for(const z of [-6,-2,2,6])tube(mast,m.steel,[0,15,z],[0,20,z],.035);
  const radar=new THREE.Group();radar.position.set(0,11,0);radar.userData.dynamic=true;box(radar,m.cream,0,0,0,1,.7,6);bakeStatic(radar);mast.add(radar);g.add(mast);
  return radar;
}
export function createTanker({quality='high'}={}){
  const group=new THREE.Group();group.name=S.name;
  const physical=(name,color,roughness=.58,metalness=.09)=>new THREE.MeshPhysicalMaterial({name,color,roughness,metalness,clearcoat:.38,clearcoatRoughness:.26});
  const m={deck:physical('Weathered tanker deck',0x9a6656,.72),pipe:physical('Cargo pipe coatings',0x98685b,.48),
    cream:physical('Accommodation paint',0xd1d0b8,.61),rail:physical('Railings and bolts',0xaaa994,.46,.3),
    dark:physical('Deck machinery',0x393a36,.53,.2),black:physical('Funnel apertures',0x17191a,.75),
    red:physical('Valves and funnel band',0x863c31,.52),orange:physical('Lifeboats',0xaf693c,.67),
    steel:physical('Unpainted steel',0x858783,.34,.72),glass:physical('Bridge glazing',0x334950,.10,.12)};
  m.glass.transparent=true;m.glass.opacity=.38;m.glass.depthWrite=false;m.glass.clearcoat=1;
  const hullA=physical('Knock Nevis starboard paint',0xffffff,.53),hullB=physical('Knock Nevis port paint',0xffffff,.53);
  hullA.map=hullTexture(false);hullB.map=hullTexture(true);
  const deckMat=m.deck.clone();deckMat.name='Cargo deck surface';deckMat.map=deckTexture();deckMat.color.set(0xffffff);
  const loft=createHullLoft(S);group.add(loft.buildMesh(hullA,hullB,quality==='low'?100:180,quality==='low'?20:36));
  const shape=new THREE.Shape();S.deckOutline.forEach(([x,z],i)=>i?shape.lineTo(x,-z):shape.moveTo(x,-z));shape.closePath();
  const deckGeo=new THREE.ShapeGeometry(shape);deckGeo.rotateX(-Math.PI/2);
  const pos=deckGeo.attributes.position,uv=deckGeo.attributes.uv;
  for(let i=0;i<pos.count;i++)uv.setXY(i,(pos.getX(i)+S.length/2)/S.length,.5-pos.getZ(i)/S.beamWater);
  mesh(group,deckGeo,deckMat,0,S.deckY,0);
  fittings(group,m);const spin=accommodation(group,m),propulsion=buildPropulsion(S);group.add(propulsion.group);bakeStatic(group);
  const weapons=new WeaponBattery(S.weapons);group.add(weapons.group);
  group.userData={vessel:S,loft,patches:loft.buildPatches(quality==='low'?20:30,quality==='low'?12:16),mats:m,spin,propulsion,weapons};return group;
}
