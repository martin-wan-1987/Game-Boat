import * as THREE from 'three';
import {mesh,box,tube,rail} from './naval-vessels.js';
import {bakeStatic} from './mesh-bake.js';
export function modelLabel(g,text,x,y,z,width,height,rotation=0,colour='#dce0d9'){
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=512;
  const ctx=canvas.getContext('2d');ctx.fillStyle=colour;ctx.font='bold 330px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,1024,256,1960);
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;
  const part=mesh(g,new THREE.PlaneGeometry(width,height),new THREE.MeshStandardMaterial({map,transparent:true,roughness:.75,depthWrite:false}),x,y,z);part.rotation.y=rotation;return part;
}
export function latticeMast(g,M,{x,y,z=0,height,width=5,yards=[.55,.8],radarWidth=width}){
  for(const side of [-1,1])tube(g,M.steel,[x-.8,y,z+side*width*.25],[x,y+height,z],Math.max(.06,width*.025));
  for(let h=0;h<height-2;h+=2){const a=1-h/height,b=1-(h+2)/height;
    for(const side of [-1,1])tube(g,M.steel,[x-.8*a,y+h,z+side*width*.25*a],[x-.8*b,y+h+2,z-side*width*.25*b],.065);
  }
  for(const f of yards){const yy=y+height*f,span=width*(1.8-f);tube(g,M.steel,[x,yy,z-span/2],[x,yy,z+span/2],.12);
    for(const side of [-1,1])tube(g,M.steel,[x,yy-2,z],[x,yy,z+side*span/2],.075);
  }
  const radar=new THREE.Group();radar.userData.dynamic=true;radar.position.set(x,y+height,z);
  box(radar,M.dark,0,0,0,.4,1.1,radarWidth);for(let t=-radarWidth/2;t<radarWidth/2;t+=.55)box(radar,M.steel,.23,0,t,.035,1.03,.04);
  bakeStatic(radar);g.add(radar);return radar;
}
export function vlsBank(g,M,{x,z=0,y,rows,cols,spacingX=1.36,spacingZ=1.12}){
  box(g,M.grey,x,y+.1,z,rows*spacingX+.3,.2,cols*spacingZ+.3);
  for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){
    const xx=x+(i-(rows-1)/2)*spacingX,zz=z+(j-(cols-1)/2)*spacingZ;
    box(g,M.dark,xx,y+.225,zz,spacingX*.9,.06,spacingZ*.87);box(g,M.grey,xx,y+.275,zz,spacingX*.80,.045,spacingZ*.77);
    box(g,M.steel,xx+spacingX*.28,y+.31,zz+spacingZ*.22,.2,.04,.10);
  }
}
export function radarFaces(g,M,{x,y,z=0,width=8,height=5,offsetX=6,offsetZ=6,tilt=.18}){
  for(const side of [-1,1]){
    const sideFace=box(g,M.glass,x,y,z+side*offsetZ,width,height,.14);sideFace.rotation.x=side*tilt;
    const front=box(g,M.glass,x+side*offsetX,y,z,.14,height,width);front.rotation.z=-side*tilt;
    for(let yy=-height*.4;yy<height*.41;yy+=.5){box(g,M.steel,x,y+yy,z+side*(offsetZ+.11),width*.94,.035,.025);box(g,M.steel,x+side*(offsetX+.11),y+yy,z,.025,.035,width*.94);}
  }
}
export function liferafts(g,M,{x,y,z,count=4,spacing=2.4}){
  for(let i=0;i<count;i++){
    const xx=x+(i-(count-1)/2)*spacing,raft=mesh(g,new THREE.CapsuleGeometry(.42,1.25,4,10),M.white,xx,y,z);raft.rotation.z=Math.PI/2;
    box(g,M.steel,xx,y-.45,z,1.4,.16,.85);
  }
}
export function funnel(g,M,{x,z=0,bottom,top,length,width}){
  const body=box(g,M.grey,x,(bottom+top)/2,z,length,top-bottom,width);body.rotation.z=-.025;
  box(g,M.dark,x,top+.03,z,length*.86,.12,width*.86);
  for(let zz=-width*.35;zz<width*.36;zz+=.9)box(g,M.steel,x,top+.14,z+zz,length*.8,.12,.12);
}
export function gallery(g,M,{x,y,z,length,width=2}){
  box(g,M.grey,x,y-.13,z,length,.26,width);rail(g,M.steel,[[x-length/2,z-width/2],[x+length/2,z-width/2],[x+length/2,z+width/2],[x-length/2,z+width/2]],y);
  for(let xx=x-length/2+2;xx<x+length/2;xx+=4)tube(g,M.steel,[xx,y-2,z],[xx,y-.15,z+width/2],.10);
}
