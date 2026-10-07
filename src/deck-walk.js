/** Closest-point projection onto the walkable deck. A deck rail and an island
 * exclusion are simultaneous geometric constraints; sequential push-outs do
 * not preserve their intersection when the island reaches a deck edge.
 */
import { SHIP } from './carrier-layout.js';

export const WALK_INSET = { ends: 1.5, rail: 0.9, obstacle: 0.7 };
const TOL = 1e-8; // metre-scale floating-point boundary comparisons
export function createDeckWalk(spec) {
const DECK_OUTLINE=spec.deckOutline,DECK_BLOCKS=spec.deckBlocks,deckHalfWidth=spec.deckHalfWidthAt;
const xmin = -spec.length / 2 + WALK_INSET.ends;
const xmax = spec.length / 2 - WALK_INSET.ends;
const obstacles = DECK_BLOCKS.map(([x0,x1,z0,z1]) => [
  x0-WALK_INSET.obstacle,x1+WALK_INSET.obstacle,
  z0-WALK_INSET.obstacle,z1+WALK_INSET.obstacle,
]);
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const at=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];

function clipX(polygon,bound,sign) {
  const result=[];
  for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length];
    const ia=sign*(a[0]-bound)>=0,ib=sign*(b[0]-bound)>=0;
    if(ia)result.push(a);
    if(ia!==ib)result.push(at(a,b,(bound-a[0])/(b[0]-a[0])));
  }
  return result;
}
function edges(polygon) { return polygon.map((p,i)=>[p,polygon[(i+1)%polygon.length]]); }

function onWalkableDeck([x,z]) {
  return x>=xmin-TOL && x<=xmax+TOL
    && z<=deckHalfWidth(x,1)-WALK_INSET.rail+TOL
    && z>=-deckHalfWidth(x,-1)+WALK_INSET.rail-TOL
    && obstacles.every(([x0,x1,z0,z1])=>
      x<=x0+TOL || x>=x1-TOL || z<=z0+TOL || z>=z1-TOL);
}

// Split every boundary at its intersections with the other boundaries. The
// midpoint classifies each resulting open segment, so its closure is a valid
// boundary of the feasible polygon, including concave edges and clipped boxes.
const boundary=(()=>{
  const rail=DECK_OUTLINE.map(([x,z])=>[x,z-Math.sign(z)*WALK_INSET.rail]);
  const polygon=clipX(clipX(rail,xmin,1),xmax,-1);
  const segments=edges(polygon).concat(obstacles.flatMap(([x0,x1,z0,z1])=>
    edges([[x0,z0],[x1,z0],[x1,z1],[x0,z1]])));
  const feasible=[];
  for(const [a,b] of segments) {
    const r=sub(b,a),cuts=[0,1];
    for(const [c,d] of segments) {
      const s=sub(d,c),delta=sub(c,a),den=cross(r,s);
      if(den===0)continue; // parallel segments have no transverse intersection
      const t=cross(delta,s)/den,u=cross(delta,r)/den;
      if(t>=0&&t<=1&&u>=0&&u<=1)cuts.push(t);
    }
    const sorted=[...new Set(cuts)].sort((a,b)=>a-b);
    for(let i=1;i<sorted.length;i++) {
      const lo=sorted[i-1],hi=sorted[i];
      if(hi>lo&&onWalkableDeck(at(a,b,(lo+hi)/2)))feasible.push([at(a,b,lo),at(a,b,hi)]);
    }
  }
  return feasible;
})();

function projectDeckWalk(x,z) {
  const point=[x,z];
  if(onWalkableDeck(point))return point;
  let nearest=boundary[0][0],distance=Infinity;
  for(const [a,b] of boundary) {
    const dx=b[0]-a[0],dz=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz)));
    const q=at(a,b,t),d=(q[0]-x)**2+(q[1]-z)**2;
    if(d<distance){distance=d;nearest=q;}
  }
  return nearest;
}

return {onWalkableDeck,projectDeckWalk};
}
export const {onWalkableDeck,projectDeckWalk}=createDeckWalk(SHIP);
