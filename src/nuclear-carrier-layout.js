import {completeVessel} from './new-vessel-layout.js';
import {gun} from './battery-layout.js';
const house=(x,z,y0,y1,l0,w0,l1,w1,corner=2)=>({x,z,y0,y1,l0,w0,l1,w1,corner});
const NIMITZ_OUTLINE=[[166.4,0],[166.4,16],[151,19],[72,20],[60,28],[36,37.2],[-80,37.2],[-91,28],[-148,25],[-166.4,22],
  [-166.4,-22],[-145,-23],[-126,-35],[-87,-39.4],[26,-39.4],[64,-37.5],[81,-19],[151,-17],[166.4,-15]];
const FORD_OUTLINE=[[168.5,0],[168.5,17.5],[153,20],[68,22],[53,39],[-74,39],[-88,29],[-154,27],[-168.5,23],
  [-168.5,-22],[-149,-25],[-125,-38],[-85,-39],[36,-39],[77,-36],[87,-20],[157,-18],[168.5,-16.5]];
const stations=[[0,.23,.34,3,2.2,0],[.05,.37,.70,3,2.2,0],[.15,.49,.99,3,2.3,0],[.42,.5,1,3,2.4,0],
  [.7,.48,.98,3,2.3,.025],[.84,.37,.92,2.8,2,.07],[.94,.18,.76,2.5,1.8,.12],[1,.005,.45,2,1.6,.05]];
function makeCarrier(config){
  const ford=config.family==='ford',length=ford?337:332.8,deckY=20,ix=config.islandX,iz=25.2;
  const S=completeVessel({
    ...config,name:`USS ${config.english}`,displayName:`${config.chinese}号航空母舰`,designation:`CVN-${config.number}`,number:String(config.number),
    length,beamWater:ford?40.8:40.8,draft:11.3,operatingDraft:11.3,designMass:ford?101600000:100000000,deckY,hullTopY:18.5,
    appearance:{hull:'#929b9e',antifoul:'#763e36',deck:'#50575b',paint:0xc0c5c5,rust:.022},
    hullStations:ford?stations.map((p,i)=>i>5?[p[0],p[1]*1.045,p[2],...p.slice(3)]:p.slice()):stations,
    flightDeck:ford?FORD_OUTLINE:NIMITZ_OUTLINE,
    cg:[-2,-.8,.20],gyradiusRoll:20,gyradiusPitch:92,gyradiusYaw:92,
    bridgeEye:[ix+config.islandLength*.46+1.2,39.5,iz],deckEye:[-110,22.4,-18],walkStart:[42,0],
    superstructure:{x:ix,z:iz,length:config.islandLength,width:16.8,centreY:42,topY:ford?67:74},
    houses:[house(ix,iz,20,30,config.islandLength,11.4,config.islandLength*.95,10.8),
      house(ix+2,iz,30,36,config.islandLength*.94,16.8,config.islandLength*.89,15.6,2.8),
      house(ix+2,iz,36,41,config.islandLength*.86,15.8,config.islandLength*.81,14.6,2.5),
      house(ix-2,iz,41,46,config.islandLength*.64,11.4,config.islandLength*.56,10.4,1.7)],
    downflood:{height:deckY,halfBeam:36},lossPoint:[ix,27,iz],
    dynamics:{wettedArea:17800,swayArea:4050,friction:.0045,surgeRecovery:.85,rollLinear:1.25e9,rollQuadratic:1.1e9,pitchDamping:9.8e10,yawDamping:2.5e10,
      thrust:3.3e7,freeSpeed:24,rudderArea:62,rudderDepth:9,clr:[-22,-7,0]},
    propulsion:{shafts:[-12,-4,4,12].map((z,i)=>({position:[-length*.475,-8,z],radius:3.05,blades:5,hand:i<2?-1:1,rpm:150})),
      rudders:[-10,10].map(z=>({position:[-length*.495,-7.5,z],length:6.4,height:8.4}))},
    weapons:[...[[-147,-1],[-147,1],[115,-1]].map(([x,side],i)=>gun(`phalanx-${i}`,[x,18.7,side*(Math.abs(x)>130?23.8:21)],
      {type:'ciws',style:'phalanx',calibre:.055,barrels:6,length:2.2,width:2.2,height:2.4,bodyLength:2.2,heading:-side*Math.PI/2,cooldown:.07}))],
    aircraft:{countMin:3,countMax:5,kind:'f18',scale:1},
  });
  S.flightOperations={
    landing:{start:[-length/2+4,7],end:[64,-28],width:23},wires:ford?[43,56,69]:[39,50,61,72],
    launch:[{start:[58,-9],end:[length/2-7,-9]},{start:[55,11],end:[length/2-7,11]},
      {start:[-30,-17],end:[63,-32]},{start:[-60,-32],end:[63,-37]}],
    catapults:true,elevators:(ford?[[41,1],[-22,1],[-114,-1]]:[[47,1],[-1,1],[-87,1],[-113,-1]]).map(([x,side])=>
      ({x,side,z:side*(S.deckHalfWidthAt(x,side)-7.5),length:21,width:15})),
  };
  return S;
}
/** Independent photo review of each named ship; shared class geometry is
 * parametrized by its visible refit rather than cloning Enterprise's island.
 * Small-fitting dimensions are photo estimates, not shipyard drawings. */
export const NUCLEAR_CARRIERS=[
  {id:'nimitz',number:68,english:'Nimitz',chinese:'尼米兹',family:'nimitz',islandX:-30,islandLength:51,mastHeight:26,radar:'lattice',domes:[[-17,-5,1.3],[10,5,1.2]],yardSpans:[18,13]},
  {id:'eisenhower',number:69,english:'Dwight D. Eisenhower',chinese:'艾森豪威尔',family:'nimitz',islandX:-30,islandLength:51,mastHeight:25,radar:'lattice',domes:[[-16,-5,1.2],[10,5,1.5],[0,0,1.7]],yardSpans:[20,14]},
  {id:'vinson',number:70,english:'Carl Vinson',chinese:'卡尔·文森',family:'nimitz',islandX:-31,islandLength:52,mastHeight:27,radar:'lattice',domes:[[-18,-4,1.5],[12,5,1.2]],yardSpans:[19,14]},
  {id:'roosevelt',number:71,english:'Theodore Roosevelt',chinese:'罗斯福',family:'nimitz',islandX:-30,islandLength:53,mastHeight:25,radar:'lattice',domes:[[-17,-5,1.5],[10,5,1.2],[2,-5,1.1]],yardSpans:[18,14]},
  {id:'lincoln',number:72,english:'Abraham Lincoln',chinese:'林肯',family:'nimitz',islandX:-30,islandLength:53,mastHeight:25,radar:'lattice',domes:[[-16,-5,1.4],[13,5,1.4],[1,-5,1.1]],yardSpans:[19,14]},
  {id:'washington',number:73,english:'George Washington',chinese:'华盛顿',family:'nimitz',islandX:-31,islandLength:53,mastHeight:27,radar:'lattice',domes:[[-18,-5,1.5],[11,5,1.4],[1,0,1.8]],yardSpans:[19,13]},
  {id:'stennis',number:74,english:'John C. Stennis',chinese:'斯坦尼斯',family:'nimitz',islandX:-31,islandLength:53,mastHeight:26,radar:'lattice',domes:[[-17,-5,1.6],[10,5,1.3]],yardSpans:[20,14]},
  {id:'truman',number:75,english:'Harry S. Truman',chinese:'杜鲁门',family:'nimitz',islandX:-31,islandLength:53,mastHeight:26,radar:'lattice',domes:[[-17,-5,1.5],[12,5,1.3],[1,-5,1.0]],yardSpans:[19,14]},
  {id:'bush',number:77,english:'George H. W. Bush',chinese:'布什',family:'nimitz',islandX:-36,islandLength:47,mastHeight:24,radar:'integrated',domes:[[-15,-5,1.5],[10,4,1.4],[0,-4,1.1]],yardSpans:[16,12]},
  {id:'ford',number:78,english:'Gerald R. Ford',chinese:'福特',family:'ford',islandX:-75,islandLength:39,mastHeight:20,radar:'integrated',domes:[[-11,-4,1.4],[9,4,1.3]],yardSpans:[14,10]},
].map(makeCarrier);
