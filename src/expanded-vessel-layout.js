import {DESTROYER,BATTLESHIP,PILOT,completeVessel} from './new-vessel-layout.js';
import {draftForBuoyancyScale} from './hull-loft.js';
/** Public overall dimensions; game hydrodynamics and small fittings are
 * estimates. Layout data, geometry, pressure faces and controls share specs. */
const hull=[[0,.19,.25,2.5,1.9,0],[.05,.32,.55,2.7,2,0],[.16,.46,.94,2.9,2.2,.02],[.45,.5,1,3,2.2,.03],[.68,.47,.98,2.8,2.1,.05],[.85,.30,.86,2.5,1.9,.12],[.97,.07,.55,2,1.6,.14],[1,.004,.35,2,1.5,.1]];
const ciws=(id,x,y,z,heading=0)=>({id,type:'ciws',position:[x,y,z],heading,barrels:6,length:2.2,radius:.055,width:2.2,height:2.4,bodyLength:2.2,cooldown:.07});
const shaft=(x,y,z,radius,rpm=160)=>({position:[x,y,z],radius,blades:5,hand:z<0?-1:1,rpm});
const rudder=(x,y,z,length,height)=>({position:[x,y,z],length,height});
const house=(x,z,y0,y1,l0,w0,l1=l0*.92,w1=w0*.9,corner=1)=>({x,z,y0,y1,l0,w0,l1,w1,corner});
const gun=(id,x,y,z,calibre,length,barrels,width,heading=0,type='main',side=0)=>({id,type,position:[x,y,z],heading,barrels,length,radius:calibre/2,width,height:width*.32,bodyLength:width*1.05,cooldown:type==='main'?1.8:.65,side});
export const HOUBEI=completeVessel({
  ...DESTROYER,id:'houbei',name:'Type 022',displayName:'022 型导弹快艇',designation:'Houbei',number:'2208',
  helipad:null,fittingsScale:.65,
  length:42.6,beamWater:12.2,draft:1.5,operatingDraft:1.5,designMass:220000,deckY:2.1,hullTopY:1.9,cg:[-2,-.15,0],gyradiusRoll:4.4,gyradiusPitch:11,gyradiusYaw:11,
  hullStations:hull,hulls:[{length:42.6,beamWater:3.1,offsetZ:-4.25},{length:42.6,beamWater:3.1,offsetZ:4.25}],
  bridgeEye:[7.6,7.7,0],deckEye:[13,3.8,-3],walkStart:[13,0],
  superstructure:{x:1,z:0,length:23,width:8.1,centreY:6,topY:17},downflood:{height:8,halfBeam:4.5},lossPoint:[0,5,0],
  houses:[house(1,0,2.1,5.5,24,9,21,7.4,2),house(1,0,5.5,8.1,14,7.4,12,6.5,1.6)],
  weapons:[ciws('ak630',16,2.1,0)],
  dynamics:{...PILOT.dynamics,wettedArea:360,swayArea:100,rollLinear:2e6,rollQuadratic:3e6,pitchDamping:8e7,yawDamping:4e7,thrust:160000,freeSpeed:26,rudderArea:3.2,rudderDepth:1.2,clr:[-5,-.7,0]},
  propulsion:{shafts:[-4.25,4.25].map(z=>shaft(-20,-.7,z,.65,480)),rudders:[-4.25,4.25].map(z=>rudder(-21,-.7,z,1.4,1.3))},
});
export const LIAONING=completeVessel({
  ...DESTROYER,id:'liaoning',name:'Liaoning',displayName:'辽宁号航空母舰',designation:'CV-16',number:'16',
  helipad:null,
  length:304.5,beamWater:38,draft:10.5,operatingDraft:10.5,designMass:60000000,deckY:17.5,hullTopY:16.9,
  cg:[-2,-1,.4],gyradiusRoll:19,gyradiusPitch:84,gyradiusYaw:84,hullStations:hull,
  flightDeck:[[152.25,0],[152.25,22],[112,27],[48,27],[25,34.5],[-90,34.5],[-133,25],[-152.25,25],[-152.25,-26],[-125,-36],[-52,-36],[35,-36],[69,-23],[112,-23],[152.25,-20]],
  bridgeEye:[-21.1,34.8,20],deckEye:[-70,19.8,-20],walkStart:[20,-5],
  superstructure:{x:-42,z:20,length:51,width:13,centreY:34,topY:65},downflood:{height:17.5,halfBeam:34},lossPoint:[0,17.5,0],
  houses:[house(-45,20,17.5,28,46,12,42,11,2),house(-40,20,28,36,39,17,35,15,3),house(-43,20,36,43,28,13,25,11,2)],
  weapons:[ciws('ciws-bow',117,16.9,-22,Math.PI/2),ciws('ciws-stern',-131,16.9,22,-Math.PI/2),ciws('ciws-port',-115,16.9,-30,Math.PI/2)],
  dynamics:{...BATTLESHIP.dynamics,wettedArea:14500,swayArea:3000,thrust:2.7e7,freeSpeed:24,rudderArea:50,rudderDepth:8,clr:[-21,-5,0]},
  propulsion:{shafts:[-10,-3.4,3.4,10].map(z=>shaft(-143,-7,z,2.7)),rudders:[-8,8].map(z=>rudder(-151,-6.5,z,5,7))},
  aircraft:{countMin:1,countMax:5,kind:'j15',scale:1.03},
  ramp:{start:78,rise:7},
});
const spiritCG=[-.8,-.1,0];
export const SPIRIT=completeVessel({
  ...PILOT,id:'spirit',name:'Spirit of Australia',displayName:'澳大利亚精神号',designation:'511 km/h',number:'SPIRIT OF AUSTRALIA',
  appearance:{hull:'#dddccf',antifoul:'#dddccf',deck:'#d9d8cb',paint:0xe2e0d5,rust:0},
  length:8.23,beamWater:2.5,draft:.48,operatingDraft:.48,designMass:1700,deckY:.75,hullTopY:.62,
  cg:spiritCG,gyradiusRoll:1.2,gyradiusPitch:2.8,gyradiusYaw:2.8,hullStations:hull,
  hulls:[{length:8.23,beamWater:.78,offsetZ:0},{length:5.9,beamWater:.55,offsetX:1.0,offsetZ:-1.05},{length:5.9,beamWater:.55,offsetX:1.0,offsetZ:1.05}],
  bridgeEye:[1.9,1.75,0],deckEye:[2.1,1.8,.5],walkStart:[1.5,0],superstructure:{x:.1,z:0,length:3.2,width:.65,centreY:1.3,topY:1.9},
  houses:[house(.4,0,.6,1.85,2.9,.74,1.5,.6,.16)],downflood:{height:2.2,halfBeam:.4,sealed:true},lossPoint:[0,1.5,0],
  dynamics:{...PILOT.dynamics,wettedArea:16,swayArea:3.5,friction:.00002,surgeRecovery:.07,rollLinear:8000,rollQuadratic:14000,pitchDamping:45000,yawDamping:30000,thrust:3400,freeSpeed:511/3.6,speedLimit:511/3.6,seaSpeed:{height:5.6,speed:120/3.6},rudderArea:.03,rudderDepth:.3,clr:[-1,-.2,0]},
  speedUnit:'km/h',
  cameras:['orbit','chase','deck','cinema'],
  structural:{rollElastic:80,rollFailure:150,pitchElastic:80},
  propulsion:{thrustAxes:[1,0,1],thrustPoint:spiritCG,shafts:[{...shaft(-3.5,-.1,0,.25,1600),kind:'jet'}],rudders:[rudder(-3.9,-.15,0,.3,.4)]},
});
export const YAMATO=completeVessel({
  ...BATTLESHIP,id:'yamato',name:'Yamato',displayName:'大和号战列舰',designation:'IJN Yamato',number:'大和',deckLift:0,
  length:263,beamWater:38.9,draft:10.4,operatingDraft:10.4,designMass:72800000,deckY:7.3,hullTopY:7.1,
  cg:[0,-1.5,0],gyradiusRoll:15,gyradiusPitch:73,gyradiusYaw:73,hullStations:hull,
  bridgeEye:[30,31.7,0],deckEye:[80,9.2,-10],walkStart:[88,-4],superstructure:{x:16,z:0,length:75,width:28,centreY:28,topY:52},
  houses:[house(0,0,7.3,11,105,28,93,25,4),house(17,0,11,18,48,22,35,17,3),house(20,0,18,25,26,17,22,14,2),house(20,0,25,33,20,14,17,12,2)],
  weapons:[gun('main-a',87,7.3,0,.46,21.5,3,12),gun('main-b',58,10.2,0,.46,21.5,3,12),gun('main-c',-82,7.3,0,.46,21.5,3,12,Math.PI),
    gun('secondary-a',41,14.5,0,.155,8.5,3,6,0,'secondary'),gun('secondary-c',-59,13,0,.155,8.5,3,6,Math.PI,'secondary'),
    ...[-1,1].flatMap(side=>[-29,-8,12,31].map((x,i)=>gun(`aa-${side}-${i}`,x,12.1,side*15,.127,5.6,2,3.7,-side*Math.PI/2,'secondary',side))),
    ...[-1,1].map(side=>ciws(`ciws-${side}`,-38,14,side*15,-side*Math.PI/2))],
  battery:{broadside:true,recoilScale:8},downflood:{height:14,halfBeam:16},lossPoint:[20,11,0],
  dynamics:{...BATTLESHIP.dynamics,wettedArea:14200,swayArea:3200,thrust:2.0e7,freeSpeed:24},
  propulsion:{shafts:[-11,-4,4,11].map(z=>shaft(-123,-7.8,z,2.65)),rudders:[-4,4].map(z=>rudder(-130,-7.4,z,5.6,8))},
});
const lift=BATTLESHIP.deckLift;
export const IOWA=completeVessel({
  ...BATTLESHIP,id:'iowa',name:'USS Iowa',displayName:'衣阿华号战列舰',designation:'BB-61',number:'61',deckLift:0,deckY:BATTLESHIP.deckY-lift,hullTopY:BATTLESHIP.hullTopY-lift,
  bridgeEye:BATTLESHIP.bridgeEye.map((v,i)=>v-(i===1?lift:0)),deckEye:BATTLESHIP.deckEye.map((v,i)=>v-(i===1?lift:0)),
  houses:BATTLESHIP.houses.map(h=>({...h,y0:h.y0-lift,y1:h.y1-lift})),lossPoint:[20,9,0],downflood:{height:13,halfBeam:13},
  superstructure:{...BATTLESHIP.superstructure,centreY:BATTLESHIP.superstructure.centreY-lift,topY:BATTLESHIP.superstructure.topY-lift},
  weapons:[...BATTLESHIP.weapons.filter(w=>w.type==='main').map(w=>({...w,operable:true,position:w.position.map((v,i)=>v-(i===1?lift:0))})),
    ...[-1,1].flatMap(side=>[30,4,-23].map((x,i)=>gun(`secondary-${side}-${i}`,x,9.2,side*11.5,.127,5.7,2,4.3,-side*Math.PI/2,'secondary',side))),
    ...BATTLESHIP.weapons.filter(w=>w.type==='ciws').map(w=>({...w,position:w.position.map((v,i)=>v-(i===1?lift:0))}))],battery:{broadside:true,recoilScale:8},
});
export const TYPHOON=completeVessel({
  ...PILOT,id:'typhoon',name:'Project 941 Typhoon',displayName:'941 台风级核潜艇',designation:'Akula / Typhoon',number:'941',
  appearance:{hull:'#363d41',antifoul:'#282c30',deck:'#39454a',paint:0x323c42,rust:.01},
  length:175,beamWater:23,draft:11,operatingDraft:11,designMass:23800000,deckY:4.5,hullTopY:4.3,cg:[-1,-3.5,0],gyradiusRoll:8.5,gyradiusPitch:48,gyradiusYaw:48,
  hullStations:[[0,.03,.15,1.1,1.1,0],[.05,.27,.52,1.5,1.4,0],[.16,.48,.97,1.8,1.6,0],[.35,.5,1,1.8,1.6,0],[.7,.5,1,1.8,1.6,0],[.85,.4,.87,1.7,1.5,0],[.96,.16,.4,1.4,1.2,0],[1,.01,.2,1.1,1.1,0]],
  houses:[house(-15,0,4.3,14.4,21,9,17,7.5,2.8)],superstructure:{x:-15,z:0,length:21,width:9,centreY:10,topY:19},
  bridgeEye:[-6.1,15.7,0],periscope:{position:[-9,14.5,0],travel:4.5,radius:.17},deckEye:[20,6.3,0],walkStart:[25,0],downflood:{height:16,halfBeam:3.8,sealed:true},lossPoint:[0,8,0],
  buoyancyScale:2,waveBuoyancy:{height:30,scale:4},submarine:true,aircraft:null,
  dynamics:{...BATTLESHIP.dynamics,wettedArea:6400,swayArea:1700,thrust:7.8e6,freeSpeed:18,rudderArea:26,rudderDepth:6,clr:[-22,-4,0]},
  propulsion:{shafts:[-5,5].map(z=>shaft(-81,-5,z,2.2,160)),rudders:[-5,5].map(z=>rudder(-86,-4.5,z,4,6))},
});
for(const S of [SPIRIT,TYPHOON])S.operatingDraft=draftForBuoyancyScale(S,S.draft);
