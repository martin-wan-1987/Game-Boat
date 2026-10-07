/** Flight operations are metres-based data. Paint, wires, elevators and
 * blast deflectors consume these same axes, rather than a second plan. */
export function flightFrame(axis){
  const [a,b]=[axis.start,axis.end],length=Math.hypot(b[0]-a[0],b[1]-a[1]),tangent=[(b[0]-a[0])/length,(b[1]-a[1])/length];
  return {...axis,length,tangent,normal:[-tangent[1],tangent[0]]};
}
export function flightWires(operations){
  const f=flightFrame(operations.landing);
  return operations.wires.map(d=>[-1,1].map(side=>[f.start[0]+f.tangent[0]*d+f.normal[0]*side*f.width/2,
    f.start[1]+f.tangent[1]*d+f.normal[1]*side*f.width/2]));
}
export function drawFlightDeck(ctx,S,w,h){
  const operations=S.flightOperations;if(!operations)return;
  const px=x=>(.5+x/S.length)*w,pz=z=>(.5-z/(S.deckHalfWidth*2))*h;
  const line=(a,b,colour,width,dash=[])=>{
    ctx.strokeStyle=colour;ctx.lineWidth=width*w/S.length;ctx.setLineDash(dash.map(d=>d*w/S.length));
    ctx.beginPath();ctx.moveTo(px(a[0]),pz(a[1]));ctx.lineTo(px(b[0]),pz(b[1]));ctx.stroke();ctx.setLineDash([]);
  };
  const f=flightFrame(operations.landing);
  for(const side of [-1,1])line([f.start[0]+f.normal[0]*f.width*.5*side,f.start[1]+f.normal[1]*f.width*.5*side],
    [f.end[0]+f.normal[0]*f.width*.5*side,f.end[1]+f.normal[1]*f.width*.5*side],'#d5d4c7',.25);
  line(f.start,f.end,'#d3b84d',.38,[3,2]);
  for(let d=8;d<f.length-12;d+=11){
    const centre=[f.start[0]+f.tangent[0]*d,f.start[1]+f.tangent[1]*d];
    for(const side of [-1,1])line([centre[0]+f.normal[0]*side*f.width*.39,centre[1]+f.normal[1]*side*f.width*.39],
      [centre[0]+f.normal[0]*side*(f.width*.39+1.5),centre[1]+f.normal[1]*side*(f.width*.39+1.5)],'#d5d4c7',.4);
  }
  for(const axis of operations.launch){
    line(axis.start,axis.end,'#d2b84e',.24,[4,2]);
    const c=flightFrame(axis);
    for(const side of [-1,1])line([c.start[0]+c.normal[0]*side*2,c.start[1]+c.normal[1]*side*2],
      [c.end[0]+c.normal[0]*side*2,c.end[1]+c.normal[1]*side*2],'#d8d8ca',.12);
  }
  for(const e of operations.elevators){
    ctx.strokeStyle='#d6d6c9';ctx.lineWidth=.17*w/S.length;
    ctx.strokeRect(px(e.x-e.length/2),pz(e.z+e.width/2),e.length*w/S.length,e.width*h/(S.deckHalfWidth*2));
  }
  for(const x of [-S.length*.40,-S.length*.24,0,S.length*.19]){
    const z=S.deckHalfWidthAt(x,1)-5;
    line([x-8,z-3],[x+8,z-3],'#dbd9c8',.16);line([x-8,z+3],[x+8,z+3],'#dbd9c8',.16);
  }
  ctx.save();ctx.translate(px(S.length*.34),pz(0));ctx.rotate(-Math.PI/2);ctx.fillStyle='#dedecf';
  ctx.font=`bold ${Math.min(w/S.length*9,h*.14)}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(S.number,0,0);ctx.restore();
}
