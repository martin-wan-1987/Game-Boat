import {createHullLoft,draftForBuoyancyScale} from './hull-loft.js';
import {chamferPlan} from './solid.js';

/** Public dimensions; all small fittings and hydrodynamic coefficients are
 * photo/game estimates, not shipyard plans. Local frame: +X bow, +Z starboard. */
export const DESTROYER={
  id:'destroyer',name:'Nanchang',displayName:'南昌舰 · 055 型驱逐舰',designation:'101',number:'101',
  appearance:{hull:'#858e94',antifoul:'#753b32',deck:'#515b63',paint:0xb9bec0,rust:.025},helipad:{x:-73,radius:8},
  length:180,beamWater:20,draft:6.6,operatingDraft:5.5,designMass:13000000,deckY:5.3,hullTopY:5.12,
  cg:[-1,-.8,.015],gyradiusRoll:7.5,gyradiusPitch:49,gyradiusYaw:49,
  bridgeEye:[25,19.05,0],deckEye:[40,7.02,-5],walkStart:[58,-3],
  superstructure:{x:1,z:0,length:82,width:16,centreY:15,topY:33},
  downflood:{height:12,halfBeam:8},lossPoint:[10,10,0],
  dynamics:{wettedArea:5000,swayArea:960,friction:.003,surgeRecovery:.55,rollLinear:2.5e7,rollQuadratic:3e7,pitchDamping:3.5e9,yawDamping:1.5e9,
    thrust:4.8e6,freeSpeed:23,rudderArea:18,rudderDepth:4.5,clr:[-12,-3,0]},
  propulsion:{shafts:[-4.1,4.1].map((z,i)=>({position:[-85,-4.9,z],radius:1.8,blades:5,hand:i?-1:1,rpm:190})),
    rudders:[-4.1,4.1].map(z=>({position:[-89,-4.6,z],length:3.2,height:4.3}))},
  hullStations:[[0,.33,.35,2.6,2,.04],[.035,.40,.55,2.7,2,.04],[.12,.48,.91,2.8,2.1,.015],[.28,.5,1,3,2.2,.01],[.57,.5,1,3,2.2,.025],
    [.72,.465,.98,2.9,2.1,.055],[.82,.365,.9,2.7,2,.12],[.9,.23,.77,2.6,1.9,.18],[.96,.11,.64,2.3,1.8,.20],[1,.004,.35,2,1.6,.1]],
  houses:[{x:14,z:0,y0:5.3,y1:11.9,l0:50,w0:17,l1:45,w1:14,corner:3},
    {x:11,z:0,y0:11.9,y1:20,l0:29,w0:14,l1:24,w1:12.5,corner:2.5},
    {x:-43,z:0,y0:5.3,y1:12,l0:26,w0:16.5,l1:25,w1:15,corner:1.2}],
  weapons:[{id:'main',type:'main',style:'stealth',position:[65,5.3,0],barrels:1,length:6.6,radius:.065,width:4.4,height:2.3,bodyLength:4.8,cooldown:.6},
    {id:'ciws',type:'ciws',style:'type1130',position:[36,12.1,0],barrels:11,length:2.6,radius:.055,width:2.6,height:2.3,bodyLength:2.4,cooldown:.055}],
};
export const BATTLESHIP={
  id:'battleship',name:'USS Missouri',displayName:'密苏里号战列舰',designation:'BB-63',number:'63',
  appearance:{hull:'#858e94',antifoul:'#753b32',deck:'#97846b',paint:0xb9bec0,rust:.16,planks:true},
  length:270.43,beamWater:32.97,draft:10.7,operatingDraft:10.7,designMass:58000000,deckY:5.25,hullTopY:5.07,
  cg:[-1,-1.4,.04],gyradiusRoll:12.8,gyradiusPitch:75,gyradiusYaw:75,
  bridgeEye:[33.5,26.1,0],deckEye:[40,7,-10],walkStart:[103,-4],
  superstructure:{x:-3,z:0,length:103,width:25,centreY:20,topY:53},downflood:{height:13,halfBeam:13},lossPoint:[20,9,0],
  dynamics:{wettedArea:12200,swayArea:2660,friction:.0028,surgeRecovery:.6,rollLinear:3.2e8,rollQuadratic:3e8,pitchDamping:3.6e10,yawDamping:1.2e10,
    thrust:1.8e7,freeSpeed:26,rudderArea:42,rudderDepth:7,clr:[-24,-6,0]},
  propulsion:{shafts:[-10,-3.7,3.7,10].map((z,i)=>({position:[i===0||i===3?-126:-120,-8,z],radius:2.4,blades:5,hand:i<2?-1:1,rpm:185})),
    rudders:[-3.8,3.8].map(z=>({position:[-132,-7.2,z],length:5,height:7}))},
  hullStations:[[0,.12,.25,2.5,1.9,.02],[.035,.28,.53,2.6,2,.01],[.10,.405,.85,2.8,2.1,.015],[.23,.493,1,3,2.3,.012],
    [.50,.5,1,3,2.3,.02],[.66,.47,.98,2.9,2.2,.05],[.77,.37,.92,2.7,2.1,.12],[.86,.22,.82,2.6,2,.2],[.94,.075,.65,2.4,1.8,.26],[1,.003,.4,2,1.6,.18]],
  houses:[{x:-2,z:0,y0:5.25,y1:8.7,l0:108,w0:25,l1:104,w1:23,corner:4},
    {x:23,z:0,y0:8.7,y1:13.3,l0:36,w0:22,l1:34,w1:19,corner:3},
    {x:24,z:0,y0:13.3,y1:18,l0:29,w0:18,l1:25,w1:15,corner:2.8},
    {x:24,z:0,y0:18,y1:23.8,l0:22,w0:14,l1:20,w1:12,corner:2.5},
    {x:24,z:0,y0:23.8,y1:27.5,l0:18,w0:14,l1:17,w1:13,corner:2}],
  battery:{broadside:true,recoilScale:.42},
  weapons:[...[{x:82,y:5.25,heading:0},{x:56,y:8.3,heading:0},{x:-83,y:5.25,heading:Math.PI}].map((t,i)=>({id:`main-${i}`,type:'main',style:'triple',position:[t.x,t.y,0],heading:t.heading,operable:true,barrels:3,length:16.2,radius:.203,width:10.4,height:3.4,bodyLength:11.4,cooldown:1.5})),
    ...[-1,1].flatMap(side=>[30,4,-23].map((x,i)=>({id:`secondary-${side}-${i}`,type:'secondary',position:[x,9.2,side*11.5],heading:-side*Math.PI/2,operable:true,barrels:2,length:5.7,radius:.0635,width:4.3,height:2.8,bodyLength:4.5,cooldown:.65,side}))),
    ...[-1,1].flatMap(side=>[8,-41].map((x,i)=>({id:`ciws-${side}-${i}`,type:'ciws',style:'phalanx',position:[x,12.1,side*12],heading:-side*Math.PI/2,barrels:6,length:2.2,radius:.055,width:2.2,height:2.4,bodyLength:2.2,cooldown:.07})))],
};
export const PILOT={
  id:'pilot',name:'Interceptor 48',displayName:'全封闭高浮力领航艇',designation:'Interceptor 48',number:'PILOT',
  appearance:{hull:'#252e38',antifoul:'#753b32',deck:'#b07d24',paint:0xdca72d,rust:.025},fittingsScale:.4,
  windows:{spacing:.83,width:.7,height:.85,frontSpacing:.7,frontWidth:.65},
  length:15,beamWater:4.4,draft:1.3,operatingDraft:1.3,designMass:17000,deckY:1.4,hullTopY:1.32,
  cg:[-.25,-.85,.002],gyradiusRoll:1.65,gyradiusPitch:4.1,gyradiusYaw:4.1,
  bridgeEye:[2.4,3.45,0],deckEye:[3.45,3.12,-.65],walkStart:[4.5,0],
  superstructure:{x:-1,z:0,length:6,width:2.65,centreY:2.9,topY:6},downflood:{height:5,halfBeam:.9,sealed:true},lossPoint:[-1,3.75,0],
  structural:{rollElastic:60,rollFailure:120,pitchElastic:45},
  dynamics:{heaveDampingRatio:.4,wettedArea:55,swayArea:14,friction:.0018,surgeRecovery:.23,rollLinear:40000,rollQuadratic:60000,pitchDamping:200000,yawDamping:90000,
    thrust:52000,freeSpeed:21,rudderArea:1.6,rudderDepth:.9,clr:[-2,-.7,0]},
  propulsion:{shafts:[-.95,.95].map((z,i)=>({position:[-6.85,-.81,z],radius:.39,blades:5,hand:i?-1:1,rpm:700})),
    rudders:[-.95,.95].map(z=>({position:[-7.2,-.72,z],length:.65,height:.83}))},
  // Sealed hull closure and cabin pressure faces share their visual geometry.
  hydrostaticClosure:true,
  buoyancyScale:3,
  waveBuoyancy:{height:30,scale:6},
  hullStations:[[0,.38,.55,1.7,1.4,.02],[.05,.46,.73,1.7,1.4,.04],[.2,.5,1,1.8,1.5,.06],[.5,.5,1,1.8,1.5,.08],
    [.7,.43,.9,1.7,1.5,.13],[.85,.29,.7,1.65,1.5,.19],[.94,.13,.50,1.6,1.4,.22],[1,.004,.3,1.5,1.4,.12]],
  houses:[{x:-1,z:0,y0:1.32,y1:3.75,l0:6.3,w0:2.85,l1:5.2,w1:2.65,corner:.35,sealed:true}],
  weapons:[],
};
// The raised topside datum and deeper Iowa-class operating draft share one
// waterline datum. Missouri retains her late-service weapons configuration.
BATTLESHIP.deckLift=BATTLESHIP.deckY+BATTLESHIP.draft-BATTLESHIP.operatingDraft;
for(const key of ['deckY','hullTopY'])BATTLESHIP[key]+=BATTLESHIP.deckLift;
for(const key of ['bridgeEye','deckEye','lossPoint'])BATTLESHIP[key][1]+=BATTLESHIP.deckLift;
for(const h of BATTLESHIP.houses){h.y0+=BATTLESHIP.deckLift;h.y1+=BATTLESHIP.deckLift;}
for(const w of BATTLESHIP.weapons)w.position[1]+=BATTLESHIP.deckLift;
for(const key of ['centreY','topY'])BATTLESHIP.superstructure[key]+=BATTLESHIP.deckLift;
BATTLESHIP.downflood.height+=BATTLESHIP.deckLift;
export function completeVessel(S){
  Object.defineProperty(S,'bridgeRoof',{get(){const h=S.houses.reduce((a,b)=>a.y1>b.y1?a:b);return {x:h.x,z:h.z,y:h.y1,length:h.l1,width:h.w1};},enumerable:true});
  const loft=createHullLoft(S),points=Array.from({length:65},(_,i)=>loft.point(i/64,1,1));
  S.deckOutline=S.flightDeck??points.slice().reverse().map(p=>[p.x,p.z]).concat(points.map(p=>[p.x,-p.z]));
  S.deckHalfWidth=Math.max(...S.deckOutline.map(p=>Math.abs(p[1])));
  S.deckHalfWidthAt=(x,side)=>{
    let width=0;for(let i=0;i<S.deckOutline.length;i++){
      const a=S.deckOutline[i],b=S.deckOutline[(i+1)%S.deckOutline.length];
      if(a[0]!==b[0]&&x>=Math.min(a[0],b[0])&&x<=Math.max(a[0],b[0])){const z=a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);if(z*side>=0)width=Math.max(width,Math.abs(z));}
    }return width;
  };
  S.deckBlocks=S.houses.map(h=>[h.x-h.l0/2,h.x+h.l0/2,h.z-h.w0/2,h.z+h.w0/2]);
  S.houses=S.houses.map(h=>({...h,rings:[{y:h.y0,points:chamferPlan(h.x,h.z,h.l0,h.w0,h.corner)},
    {y:h.y1,points:chamferPlan(h.x,h.z,h.l1,h.w1,h.corner)}]}));
  return S;
}
for(const S of [DESTROYER,BATTLESHIP,PILOT])completeVessel(S);
PILOT.operatingDraft=draftForBuoyancyScale(PILOT,PILOT.draft);
