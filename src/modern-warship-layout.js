import {DESTROYER,completeVessel} from './new-vessel-layout.js';
import {gun} from './battery-layout.js';
const house=(x,y0,y1,l0,w0,l1,w1,corner=1.2)=>({x,z:0,y0,y1,l0,w0,l1,w1,corner});
const propulsion=(length,draft,z,radius)=>({shafts:[-z,z].map((side,i)=>({position:[-length*.47,-draft*.72,side],radius,blades:5,hand:i?-1:1,rpm:190})),rudders:[-z,z].map(side=>({position:[-length*.493,-draft*.67,side],length:3.2,height:draft*.65}))});
const ciws=(id,x,y,z,style='phalanx')=>gun(id,[x,y,z],{type:'ciws',style,calibre:.055,length:2.2,barrels:6,width:2.2,height:2.4,bodyLength:2.2,heading:z>0?-Math.PI/2:Math.PI/2,cooldown:.07});
export const SEJONG=completeVessel({
  ...DESTROYER,id:'sejong',name:'ROKS Sejong the Great',displayName:'世宗大王号驱逐舰',designation:'DDG-991',number:'991',
  length:165.9,beamWater:21.4,draft:6.25,operatingDraft:6.25,deckY:5.25,hullTopY:5.1,designMass:11000000,
  gyradiusPitch:46,gyradiusYaw:46,cg:[-2,-1,0],bridgeEye:[30.7,18.0,0],deckEye:[50,7.3,-6],walkStart:[45,-4],
  superstructure:{x:0,z:0,length:90,width:17,centreY:16,topY:42},downflood:{height:14,halfBeam:8},lossPoint:[10,12,0],
  houses:[house(13,5.25,11.4,62,18,56,16.3,2.5),house(13,11.4,19.0,34,16.3,29,14.4,2),house(-49,5.25,12.6,29,17,27,16,1)],
  helipad:{x:-69,radius:8},
  weapons:[gun('mk45',[60,5.25,0],{type:'main',calibre:.127,length:7.2,barrels:1,width:3.8,height:2.1,bodyLength:4.1}),ciws('goalkeeper',-39,13,0,'goalkeeper')],
  launchBanks:[{x:43,y:5.25,rows:6,cols:8},{x:-26,y:5.25,rows:10,cols:8}],
  radar:{x:13,y:14.2,width:4.6,height:4.1,offsetX:26,offsetZ:8.35,tilt:.13},
  funnels:[{x:-3,bottom:12,top:25,length:10,width:11},{x:-33,bottom:6,top:22,length:12,width:12}],
  mast:{x:12,y:19,z:0,height:22,width:6,radarWidth:4.6},
  dynamics:{...DESTROYER.dynamics,wettedArea:4800,swayArea:1030,thrust:4.6e6,freeSpeed:23},propulsion:propulsion(165.9,6.25,4.8,1.8),
});
export const TYPE052D=completeVessel({
  ...DESTROYER,id:'type052d',name:'Kunming',displayName:'昆明舰 · 052D 型驱逐舰',designation:'172',number:'172',
  length:157,beamWater:17.2,draft:6,operatingDraft:6,deckY:4.8,hullTopY:4.64,designMass:7500000,cg:[-1,-1,0],
  gyradiusRoll:6.3,gyradiusPitch:43,gyradiusYaw:43,bridgeEye:[26.8,17.2,0],deckEye:[42,6.8,-5],walkStart:[43,-3],
  superstructure:{x:-2,z:0,length:84,width:14.5,centreY:16,topY:40},downflood:{height:12,halfBeam:7},lossPoint:[12,9,0],
  houses:[house(9,4.8,11,49,15,44,13,2),house(9,11,18.2,31,13,27,11.5,1.7),house(-43,4.8,11.5,27,14,25,13,1)],
  helipad:{x:-66,radius:7},
  weapons:[gun('h-pj38',[54,4.8,0],{type:'main',calibre:.130,length:6.6,barrels:1,width:4.2,height:2.3,bodyLength:4.6}),ciws('type730',31,11.2,0,'type1130')],
  launchBanks:[{x:37,y:4.8,rows:4,cols:8},{x:-27,y:4.8,rows:4,cols:8}],
  radar:{x:9,y:13.6,width:5.0,height:4.1,offsetX:15.1,offsetZ:6.3,tilt:.18},
  funnels:[{x:-11,bottom:11,top:23,length:11,width:10},{x:-38,bottom:11.5,top:18,length:8,width:9}],
  mast:{x:8,y:18.2,z:0,height:19,width:4,radarWidth:4},
  dynamics:{...DESTROYER.dynamics,wettedArea:3500,swayArea:780,thrust:3.6e6,freeSpeed:22,rudderArea:14,rudderDepth:4},propulsion:propulsion(157,6,3.7,1.55),
});
export const ZUMWALT=completeVessel({
  ...DESTROYER,id:'zumwalt',name:'USS Zumwalt',displayName:'朱姆沃尔特号驱逐舰',designation:'DDG-1000',number:'1000',
  // Original two-AGS configuration; the later CPS conversion is a different fit.
  length:190,beamWater:24.6,draft:8.4,operatingDraft:8.4,deckY:7.0,hullTopY:6.85,designMass:15900000,
  appearance:{...DESTROYER.appearance,hull:'#8a9090',deck:'#525e60',paint:0xb5bab8,rust:.018},
  hullStations:[[0,.25,.38,3,2,-.20],[.04,.39,.7,3,2,-.22],[.13,.48,.96,3,2,-.22],[.34,.5,1,3,2.1,-.25],[.66,.5,1,3,2.1,-.25],[.83,.35,.96,2.7,2,-.23],[.94,.15,.88,2.4,1.8,-.25],[1,.004,.76,2,1.6,-.15]],
  cg:[-3,-1.6,0],gyradiusRoll:9.0,gyradiusPitch:52,gyradiusYaw:52,
  bridgeEye:[12.2,25.0,0],deckEye:[54,9.1,-6],walkStart:[55,-4],
  superstructure:{x:-15,z:0,length:84,width:19.8,centreY:21,topY:32},downflood:{height:22,halfBeam:8},lossPoint:[-10,20,0],
  houses:[house(-17,7,14.5,90,20,79,16.8,.7),house(-17,14.5,31,76,16.8,48,9.5,.7)],
  helipad:{x:-75,radius:9},windows:{spacing:2.3,width:1.6,height:.46,frontSpacing:1.65,frontWidth:1.15},
  weapons:[gun('ags-1',[63,7,0],{type:'main',style:'stealth',calibre:.155,length:9.6,barrels:1,width:4.5,height:2.2,bodyLength:6}),
    gun('ags-2',[42,7,0],{type:'main',style:'stealth',calibre:.155,length:9.6,barrels:1,width:4.5,height:2.2,bodyLength:6}),
    ...[-1,1].map(side=>gun(`mk46-${side}`,[-45,15.2,side*6],{type:'ciws',calibre:.030,length:2.8,barrels:1,width:1.6,height:1.4,bodyLength:1.7,heading:-side*Math.PI/2,barrelPattern:'line',openMount:true,rotating:false}))],
  launchBanks:[...[-1,1].flatMap(side=>[{x:3,z:side*8.65,y:7,rows:10,cols:2},{x:-63,z:side*8.0,y:7,rows:10,cols:2}])],
  mast:null,radar:null,funnels:[],
  dynamics:{...DESTROYER.dynamics,wettedArea:6500,swayArea:1350,thrust:5.6e6,freeSpeed:24,rudderArea:25,rudderDepth:6},propulsion:propulsion(190,8.4,5.4,2.25),
});
export const MODERN_WARSHIPS=[SEJONG,TYPE052D,ZUMWALT];
