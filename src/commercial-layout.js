import {completeVessel} from './new-vessel-layout.js';
const hull=[[0,.30,.30,3,2,0],[.035,.40,.56,3,2.1,0],[.12,.49,.96,3.1,2.4,0],[.36,.5,1,3.2,2.5,0],[.7,.49,1,3.2,2.4,.005],
  [.84,.40,.98,3,2.2,.04],[.94,.20,.87,2.6,2,.09],[1,.006,.54,2,1.6,.04]];
const house=(x,z,y0,y1,l0,w0,l1=l0,w1=w0,corner=1)=>({x,z,y0,y1,l0,w0,l1,w1,corner});
function commercial({length,beamWater,draft,mass,deckY,...configuration}){
  return {length,beamWater,draft,operatingDraft:draft,designMass:mass,deckY,hullTopY:deckY-.25,hullStations:hull,
    cg:[-2,-1.8,.02],gyradiusRoll:beamWater*.40,gyradiusPitch:length*.277,gyradiusYaw:length*.277,
    downflood:{height:deckY+9,halfBeam:beamWater*.40},lossPoint:[0,deckY+10,0],weapons:[],
    dynamics:{wettedArea:length*(beamWater+2*draft)*.82,swayArea:length*draft*.60,friction:.0026,surgeRecovery:.48,
      rollLinear:mass*9,rollQuadratic:mass*8,pitchDamping:mass*1300,yawDamping:mass*320,thrust:mass*.09,freeSpeed:16.5,
      rudderArea:beamWater*2,rudderDepth:draft*.72,clr:[-length*.085,-draft*.50,0]},
    propulsion:{shafts:[{position:[-length*.475,-draft*.69,0],radius:Math.min(4.8,beamWater*.076),blades:5,hand:1,rpm:90}],
      rudders:[{position:[-length*.495,-draft*.65,0],length:7.5,height:draft*.72}]},...configuration};
}
function containerShip(config){
  const deckY=config.deckY,bridgeX=config.bridgeX,width=config.beamWater*.76;
  const levels=Array.from({length:9},(_,i)=>house(bridgeX,0,deckY+i*2.8,deckY+(i+1)*2.8,23,width,23,width,1));
  levels.push(house(bridgeX+3,0,deckY+25.2,deckY+29.2,31,config.beamWater*.94,29,config.beamWater*.90,2));
  const S=completeVessel(commercial({...config,houses:levels,
    appearance:{hull:config.hullColour,antifoul:'#8a3c30',deck:config.deckColour,paint:config.houseColour,rust:.045},
    bridgeEye:[bridgeX+18,deckY+28.1,0],deckEye:[config.length*.41,deckY+2.2,-config.beamWater*.25],walkStart:[config.length*.41,0],
    superstructure:{x:bridgeX,z:0,length:31,width:config.beamWater*.94,centreY:deckY+16,topY:deckY+41},
    cargo:{bays:29,columns:Math.floor((config.beamWater-4.6)/2.55),tiers:8,startX:-config.length*.455,pitchX:12.68,pitchZ:2.55,
      releaseFraction:.80,releaseInterval:.24,slideSpeed:1.05,largeWaveHeight:8,brand:config.brand},
    funnelX:-config.length*.335,
    windows:{spacing:2.1,width:1.5,height:.75,frontSpacing:1.5,frontWidth:1.1},
  }));
  S.cargo.stacks=[];
  for(let bay=0;bay<S.cargo.bays;bay++)for(let column=0;column<S.cargo.columns;column++){
    const x=S.cargo.startX+bay*S.cargo.pitchX,z=(column-(S.cargo.columns-1)/2)*S.cargo.pitchZ;
    if(Math.abs(x-bridgeX)<25||Math.abs(x-S.funnelX)<16||Math.abs(z)+1.25>S.deckHalfWidthAt(x,Math.sign(z)||1)-1.1)continue;
    const tiers=S.cargo.tiers-((bay+column)%11===0?1:0)-(Math.abs(x)>S.length*.37?2:0);
    S.cargo.stacks.push({x,z,tiers,bay,column});
  }
  S.deckBlocks.push([S.funnelX-15,S.funnelX+15,-S.beamWater*.35,S.beamWater*.35]);
  // Cargo handling areas are excluded from the perimeter walking route,
  // including after a load is lost. They are an access contract, not hull
  // roofs or copies of moving cargo bodies consumed by hydrodynamics.
  const bays=new Map();
  for(const stack of S.cargo.stacks){
    const area=bays.get(stack.bay)??[stack.x-6.1,stack.x+6.1,Infinity,-Infinity];
    area[2]=Math.min(area[2],stack.z-1.23);area[3]=Math.max(area[3],stack.z+1.23);bays.set(stack.bay,area);
  }
  S.walkRestrictedAreas=[];let previous=-2;
  for(const [bay,area] of bays){
    if(bay!==previous+1)S.walkRestrictedAreas.push(area);
    else {const span=S.walkRestrictedAreas.at(-1);span[1]=area[1];span[2]=Math.min(span[2],area[2]);span[3]=Math.max(span[3],area[3]);}
    previous=bay;
  }
  return S;
}
export const CONTAINER_SHIPS=[
  {id:'msc-irina',name:'MSC Irina',displayName:'地中海伊琳娜号',designation:'MSC IRINA · 24,346 TEU',number:'MSC IRINA',
    length:399.9,beamWater:61.3,draft:17,deckY:15.7,mass:240000000,bridgeX:64,brand:'MSC',hullColour:'#17292e',deckColour:'#8a3930',houseColour:0xd8c491},
  {id:'ever-fortune',name:'Ever Fortune',displayName:'长福号',designation:'EVER FORTUNE · 23,992 TEU',number:'EVER FORTUNE',
    length:399.9,beamWater:61.5,draft:16.5,deckY:16.2,mass:235000000,bridgeX:60,brand:'EVERGREEN',hullColour:'#17643f',deckColour:'#456348',houseColour:0xd9dfd5},
  {id:'oocl-hong-kong',name:'OOCL Hong Kong',displayName:'东方香港号',designation:'OOCL HONG KONG · 21,413 TEU',number:'OOCL HONG KONG',
    length:399.9,beamWater:58.8,draft:16,deckY:15.4,mass:225000000,bridgeX:52,brand:'OOCL',hullColour:'#b7c0bf',deckColour:'#94675e',houseColour:0xe0dfd4},
].map(containerShip);

function cruiseShip(config){
  const {length,beamWater,deckY}=config,houseList=[];
  // Lower hotel decks are continuous. Upper aft decks split around the open
  // Central Park/Boardwalk well; the aperture is actual geometry.
  for(let i=0;i<14;i++){
    const y0=deckY+i*3.05,y1=y0+3.05,foreX=85-i*.40,foreLength=135-i*2.2,width=beamWater+4-Math.max(0,i-10)*2;
    houseList.push(house(foreX,0,y0,y1,foreLength,width,foreLength-1.0,width-.6,4));
    if(i<5)houseList.push(house(-68,0,y0,y1,172,width,170,width-.6,3));
    else for(const side of [-1,1])houseList.push(house(-67,side*(width/4+4.1),y0,y1,169,width/2-8.2,166,width/2-8.5,2));
  }
  return completeVessel(commercial({...config,houses:houseList,
    appearance:{hull:'#e0e2db',antifoul:'#385e6b',deck:'#b49b72',paint:0xf0efe7,rust:.007},
    bridgeEye:[160,deckY+21.4,0],deckEye:[length*.43,deckY+4,-beamWater*.22],walkStart:[length*.425,0],
    superstructure:{x:15,z:0,length:300,width:beamWater+8,centreY:deckY+23,topY:deckY+56},
    cg:[-5,-3.7,0],gyradiusRoll:beamWater*.43,downflood:{height:deckY+14,halfBeam:beamWater*.43},lossPoint:[155,deckY+21,0],
    hotel:{levels:14,floorHeight:3.05,well:{x:-68,length:170,width:16.4,y:deckY+15.25},topY:deckY+42.7},
    cameras:['orbit','chase','bridge','deck','cinema'],
    propulsion:{shafts:[-12,0,12].map((z,i)=>({position:[-length*.465,-config.draft*.7,z],radius:3.6,blades:5,hand:i<1?-1:1,rpm:150})),
      rudders:[-12,0,12].map(z=>({position:[-length*.484,-config.draft*.66,z],length:5.5,height:7}))},
  }));
}
export const CRUISE_SHIPS=[
  {id:'icon-of-the-seas',name:'Icon of the Seas',displayName:'皇家加勒比海洋标志号',designation:'ICON OF THE SEAS',number:'ICON OF THE SEAS',
    length:364.75,beamWater:48.47,draft:9.25,deckY:10.5,mass:105000000,iconClass:true},
  {id:'symphony-of-the-seas',name:'Symphony of the Seas',displayName:'海洋交响号',designation:'SYMPHONY OF THE SEAS',number:'SYMPHONY OF THE SEAS',
    length:361,beamWater:47.45,draft:9.3,deckY:10.5,mass:100000000,iconClass:false},
].map(cruiseShip);
