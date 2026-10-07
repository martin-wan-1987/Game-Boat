/** Knock Nevis / Jahre Viking: public particulars + photo-derived fittings.
 * The loft uses the loaded design waterline; the playable ship sails empty
 * with ballast. +X bow. The 13 m ballast draft is a game estimate, not a
 * measured shipyard value. */
export const TANKER = {
  id:'tanker',name:'Knock Nevis',displayName:'诺克·耐维斯号巨型油轮',designation:'ULCC',number:'KNOCK NEVIS',
  length:458.45,beamWater:68.86,draft:24.611,operatingDraft:13,depth:29.8,
  get deckY(){return this.depth-this.draft+.28;},get hullTopY(){return this.depth-this.draft;},
  designMass:657000000,gyradiusRoll:25.8,gyradiusPitch:125,gyradiusYaw:125,cg:[0,-3,.12],
  bridgeEye:[-158,28.4,0],deckEye:[-130,7.9,-19],walkStart:[-120,-17],
  superstructure:{x:-182,z:0,length:54,width:51,centreY:24,topY:43},
  bridgeRoof:{x:-174,z:0,y:31.175,length:37,width:45,thickness:.55},
  // The cargo deck is sealed; openings in the raised accommodation determine
  // down-flooding. Water on the cargo deck is not interior flooding.
  downflood:{height:18,halfBeam:26},lossPoint:[-182,28,0],
  weapons:[],
  // Effective resistance calibration near the published 16.5 kn / 50,000 hp
  // operating point; these are game coefficients, not a shipyard power curve.
  dynamics:{wettedArea:50500,swayArea:10400,friction:.0018,surgeRecovery:.47,rollLinear:8.8e9,rollQuadratic:7.8e9,pitchDamping:7.0e11,yawDamping:1.7e11,
    thrust:1.25e7,freeSpeed:13.0,rudderArea:145,rudderDepth:18,clr:[-42,-15,0]},
  propulsion:{shafts:[{position:[-220,-17.4,0],radius:4.5,blades:5,hand:1,rpm:85}],
    rudders:[{position:[-228,-17,0],length:9,height:14}]},
  hullStations:[
    [0,.30,.29,2.4,1.8,0],[.025,.40,.50,2.8,2,0],[.065,.46,.85,3.2,2.3,0],
    [.13,.5,1,3.2,2.4,0],[.32,.5,1,3.4,2.6,0],[.62,.5,1,3.4,2.6,0],
    [.77,.494,1,3.2,2.5,.005],[.84,.464,.98,3,2.3,.015],[.90,.39,.94,2.8,2.2,.025],
    [.94,.30,.87,2.6,2,.025],[.971,.20,.77,2.4,1.9,-.03],[.988,.11,.67,2.2,1.7,-.06],[1,.025,.55,2,1.5,-.10],
  ],
};
const half=TANKER.length/2;
export const TANKER_OUTLINE=[
  [half,1.5],[half-6,9],[half-16,17],[half-34,25],[half-65,31.5],[half-99,34.2],
  [40,34.43],[-120,34.43],[-173,33.5],[-205,29.2],[-222,24.4],[-half,20.8],
  [-half,-20.8],[-222,-24.4],[-205,-29.2],[-173,-33.5],[-120,-34.43],[40,-34.43],
  [half-99,-34.2],[half-65,-31.5],[half-34,-25],[half-16,-17],[half-6,-9],[half,-1.5],
];
Object.assign(TANKER,{
  deckOutline:TANKER_OUTLINE,deckBlocks:[[-209,-153,-26,26],[-144,174,-7.8,7.8]],
  get deckHalfWidth(){return TANKER.beamWater/2;},
  deckHalfWidthAt(x,side){
    for(let i=0;i<TANKER_OUTLINE.length;i++){
      const a=TANKER_OUTLINE[i],b=TANKER_OUTLINE[(i+1)%TANKER_OUTLINE.length];
      if(a[1]*side<0||b[1]*side<0||a[0]===b[0])continue;
      if(x>=Math.min(a[0],b[0])&&x<=Math.max(a[0],b[0]))return Math.abs(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]));
    }
    return 0;
  },
});
export const CARGO_TANKS=Array.from({length:46},(_,i)=>{
  const row=Math.floor(i/4),lane=i%4,x=-138+row*27.6,z=[-23.2,-12.2,12.2,23.2][lane];
  return {x,z};
});
export const PIPE_BANK=Array.from({length:6},(_,i)=>({z:(i-2.5)*1.65,radius:.5+(i%2)*.08}));
