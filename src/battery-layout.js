/** Physical mount dimensions and placement, shared by models and firing.
 * +X bow, +Z starboard. Historic layouts use their own gun shields/barrels;
 * their rapid AA battery uses the game's existing defence control channel. */
export const gun=(id,position,{calibre=.127,length=5.7,barrels=2,width=4.3,height=2.8,bodyLength=4.5,type='secondary',heading=0,side=0,cooldown=.65,...shape}={})=>
  ({id,position,barrels,width,height,bodyLength,length,radius:calibre/2,type,heading,side,cooldown,operable:true,...shape});
export const rapidAA=(id,x,y,z,barrels,calibre=.025)=>gun(id,[x,y,z],{
  calibre,barrels,length:calibre===.04?2.3:1.55,width:barrels===4?2.5:barrels===3?1.7:1.1,
  height:.7,bodyLength:1.3,type:'ciws',heading:z>0?-Math.PI/2:Math.PI/2,cooldown:.10,
  openMount:true,barrelPattern:'line',rotating:false,
});

/** Yamato, final 1945 fit: 12 twin 127 mm, 52 triple + 6 single 25 mm. */
export function yamatoDefence(){
  const twins=[[-40,12.3,15.7],[-25,15.0,14.0],[-10,15.0,14.0],[6,15.0,14.0],[22,15.0,14.0],[38,12.3,15.7]];
  const triples=[
    ...[-109,-97,-72,-58,-47,48,66,75,101,111].map(x=>[x,7.35,Math.abs(x)>90?11:16]),
    ...[-44,-34,-24,-14,-4,6,16,26,36,46].map(x=>[x,11.15,11.8]),
    ...[-34,-14,6,26].map(x=>[x,17.5,10.9]),[14,24.9,8.5],[24,30.0,7.7],
  ];
  return [-1,1].flatMap(side=>[
    ...twins.map(([x,y,z],i)=>gun(`127-${side}-${i}`,[x,y,side*z],{heading:-side*Math.PI/2,side})),
    ...triples.map(([x,y,z],i)=>rapidAA(`25-triple-${side}-${i}`,x,y,side*z,3)),
    ...[-70,-60,-50].map((x,i)=>rapidAA(`25-single-${side}-${i}`,x,7.35,side*7.8,1)),
  ]);
}

/** Iowa, 1945: 10 twin 5-inch, 19 quad Bofors, 52 single Oerlikons.
 * The late Missouri refit remains a separate, historically smaller battery. */
export function iowaDefence(deckY){
  const twins=[[38,deckY+4.0,11.8],[22,deckY+7.0,10.5],[5,deckY+7.0,10.5],[-14,deckY+7.0,10.5],[-31,deckY+4.0,11.8]];
  const quads=[[113,deckY,6.8],[96,deckY,10.8],[47,deckY+3.6,10.8],
    [35,deckY+10.6,9.4],[14,deckY+11.5,9.5],[-7,deckY+5.0,11.6],[-29,deckY+7,10.3],[-48,deckY+3.8,10.2],[-67,deckY,12.5]];
  const singles=[...Array.from({length:16},(_,i)=>[-111+i*13.9,deckY,Math.min(14.5,8.5+Math.sin(i/15*Math.PI)*6)]),
    ...Array.from({length:10},(_,i)=>[-48+i*9,deckY+3.7,12.6])];
  return [rapidAA('40-stern-centre',-116,deckY,0,4,.04),...[-1,1].flatMap(side=>[
    ...twins.map(([x,y,z],i)=>gun(`5inch-${side}-${i}`,[x,y,side*z],{heading:-side*Math.PI/2,side})),
    ...quads.map(([x,y,z],i)=>rapidAA(`40-quad-${side}-${i}`,x,y,side*z,4,.04)),
    ...singles.map(([x,y,z],i)=>rapidAA(`20-single-${side}-${i}`,x,y,side*z,1,.020)),
  ])];
}
