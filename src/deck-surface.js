/** The deck plan is the common support boundary for walking, aircraft and
 * water visibility. A ramp changes elevation, never the plan outline. */
export function insideOutline(points,x,z){
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function deckHeightAt(spec,x){
  const r=spec.ramp;
  return spec.deckY+(r?r.rise*Math.max(0,(x-r.start)/(spec.length/2-r.start))**2:0);
}
export function deckSlopeAt(spec,x){
  const r=spec.ramp;
  return r?2*r.rise*Math.max(0,x-r.start)/(spec.length/2-r.start)**2:0;
}
