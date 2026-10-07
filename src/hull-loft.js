import * as THREE from 'three';
import {trianglesToPatches,ringSolid} from './solid.js';
/** Local height of the operating waterline in a hull drawn at design draft. */
export const operatingWaterlineY = spec => spec.operatingDraft - spec.draft;
export const pressureIntegral=(patches,waterline)=>patches.reduce((sum,p)=>{
  const d=waterline-p.pos.y;return sum+(d>0&&p.kind!=='deck'?d*p.area*-p.nrm.y:0);
},0);
/** Solve the same displacement quadrature for a changed buoyancy coefficient,
 * preserving the previous operating mass instead of changing cargo weight. */
export function draftForBuoyancyScale(spec,referenceDraft){
  const patches=createHullLoft(spec).buildPatches(),target=pressureIntegral(patches,referenceDraft-spec.draft)/(spec.buoyancyScale??1);
  let low=Math.min(...patches.map(p=>p.pos.y)),high=referenceDraft-spec.draft;
  for(let i=0;i<60;i++){const mid=(low+high)/2;if(pressureIntegral(patches,mid)<target)low=mid;else high=mid;}
  return spec.draft+(low+high)/2;
}
/** One loft for visible shell, waterline and pressure patches of any vessel. */
export function createHullLoft(spec) {
  if(spec.hulls){
    const parts=spec.hulls.map(h=>({offset:new THREE.Vector3(h.offsetX??0,0,h.offsetZ??0),loft:createHullLoft({...spec,hulls:null,houses:[],...h})}));
    const outer=createHullLoft({...spec,hulls:null});
    return {...outer,
      surfaces:parts.flatMap(({offset,loft})=>loft.surfaces.map(surface=>({
        point:(t,u,side,out)=>surface.point(t,u,side,out).add(offset),
        waterlineOutline:(...args)=>surface.waterlineOutline(...args).map(p=>({...p,x:p.x+offset.x,z:p.z+offset.z})),
      }))),
      buildMesh(...args){const root=new THREE.Group();for(const {offset,loft} of parts){const mesh=loft.buildMesh(...args);mesh.position.copy(offset);root.add(mesh);}return root;},
      buildPatches(stations=26,ring=14){return parts.flatMap(({offset,loft})=>loft.buildShellPatches(stations,ring).map(p=>({...p,pos:p.pos.add(offset)}))).concat(outer.buildTopsides());},
    };
  }
const HALF_L=spec.length/2;
function lerpStations(t) {
  const S = spec.hullStations;
  let i = 0;
  while (i < S.length - 2 && t > S[i + 1][0]) i++;
  const a = S[i], b = S[i + 1];
  const f = THREE.MathUtils.clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
  const e = f * f * (3 - 2 * f);           // smoothstep keeps the loft crease-free
  return [
    THREE.MathUtils.lerp(a[1], b[1], e) * spec.beamWater,
    THREE.MathUtils.lerp(a[2], b[2], e) * spec.draft,
    THREE.MathUtils.lerp(a[3], b[3], e),
    THREE.MathUtils.lerp(a[4], b[4], e),
    THREE.MathUtils.lerp(a[5], b[5], e),
  ];
}

/**
 * Half-section of the hull at parameter u (0 = keel, 1 = deck edge).
 * Returns { y, halfW }.
 */
function hullSection(t, u) {
  const [hb, keel, sa, sb, flare] = lerpStations(t);
  const top = spec.hullTopY;
  const y = -keel + (top + keel) * u;
  // w0 high -> hard bilge then near-vertical sides: a carrier's hull is a
  // wall-sided box with rounded bilges, not a yacht's soft sections
  const w0 = 0.34;
  const section=spec.sectionShape;
  // A truncated superellipse represents rounded pressure hulls and crowned
  // decks. The same analytic section feeds mesh, waterline and quadrature.
  const edge=section&&(u<section.centre?section.bottom:section.top);
  const q=section&&(u-section.centre)/(u<section.centre?section.centre:1-section.centre)*Math.pow(1-Math.pow(edge,section.power),1/section.power);
  const shape=section?Math.pow(1-Math.pow(Math.abs(q),section.power),1/section.power):w0+(1-w0)*Math.pow(1-Math.pow(1-u,sa),1/sb);
  const halfW = hb * shape * (1 + flare * u * u * u);
  return { y, halfW };
}

function hullPoint(t, u, side, out = new THREE.Vector3()) {
  const { y, halfW } = hullSection(t, u);
  const x = -HALF_L + t * spec.length;
  return out.set(x, y, side * halfW);
}

// Highest point of the rounded section above a horizontal footprint point.
// Its upper branch is monotone from maximum beam to the crown edge. Fittings
// consume this same loft instead of floating above a separate flat deck.
function topHeightAt(x,z){
  const t=(x+HALF_L)/spec.length,edge=hullSection(t,1);
  if(!spec.sectionShape||Math.abs(z)<=edge.halfW)return edge.y;
  let low=spec.sectionShape.centre,high=1;
  for(let i=0;i<36;i++){const mid=(low+high)/2;if(hullSection(t,mid).halfW>Math.abs(z))low=mid;else high=mid;}
  return hullSection(t,(low+high)/2).y;
}


function buildHull(matStar, matPort, stations = 96, ring = 22) {
  const yToV = y => (y + spec.draft + 1) / (spec.hullTopY + spec.draft + 2);
  const group = new THREE.Group();

  for (const side of [1, -1]) {
    const verts = [];
    const uvs = [];
    const idx = [];
    for (let j = 0; j <= stations; j++) {
      const t = j / stations;
      for (let i = 0; i <= ring; i++) {
        const p = hullPoint(t, i / ring, side);
        verts.push(p.x, p.y, p.z);
        uvs.push(t, yToV(p.y));
      }
    }
    const stride = ring + 1;
    for (let j = 0; j < stations; j++) {
      for (let i = 0; i < ring; i++) {
        const a = j * stride + i;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        if (side > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, side > 0 ? matStar : matPort);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  // Every boundary is a strip between the exact sampled loft rings. Ordering
  // the two sides sets its outward winding; no separately fitted cap or
  // triangulator may discard side-ring vertices and introduce a seam.
  const closeStrip=(count,sample)=>{
    const positions=[],uvs=[],indices=[];
    for(let j=0;j<=count;j++)for(const p of sample(j)) {
      positions.push(p.x,p.y,p.z);uvs.push((p.x+HALF_L)/spec.length,yToV(p.y));
    }
    for(let j=0;j<count;j++) {
      const a=j*2,b=a+1,c=a+2,d=a+3;
      indices.push(a,c,b,b,c,d);
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geo.setIndex(indices);geo.computeVertexNormals();return mesh(group,geo,matStar);
  };
  for(const u of [0,1])closeStrip(stations,j=>[-1,1].map(side=>hullPoint(j/stations,u,side*(1-2*u))));
  for(const t of [0,1]) {
    const sign=2*t-1;
    const end=closeStrip(ring,i=>[-sign,sign].map(side=>hullPoint(t,i/ring,side)));
    end.name=t===1?'Bow shell closure':'Stern shell closure';
  }
  return group;
}


function waterlineOutline(stations = 72, localY = operatingWaterlineY(spec)) {
  if (localY > spec.hullTopY) return [];
  const wet = t => hullSection(t, 0).y <= localY;
  const ts = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    if (i && wet((i - 1) / stations) !== wet(t)) {
      let lo = (i - 1) / stations, hi = t;
      for (let n = 0; n < 30; n++) {
        const mid = (lo + hi) / 2;
        if (wet(mid) === wet(lo)) lo = mid;
        else hi = mid;
      }
      ts.push((lo + hi) / 2);
    }
    if (wet(t)) ts.push(t);
  }
  const pts = [];
  const push = (t, side) => {
    const keel = -hullSection(t, 0).y;
    const u = (localY + keel) / (spec.hullTopY + keel);
    const { halfW } = hullSection(t, u);
    pts.push({ t, x: -HALF_L + t * spec.length, y: localY, z: side * halfW, side });
  };
  for (const t of ts) push(t, 1);
  for (let i = ts.length - 1; i >= 0; i--) push(ts[i], -1);
  // outward normals in the XZ plane
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // rotate +90deg -> outward normal (starboard side points +z, port -z)
    pts[i].nx = -dz;
    pts[i].nz = dx;
  }
  return pts;
}

/* ------------------------------------------------------------------ *
 * Hydrostatic patches for the physics solver
 * ------------------------------------------------------------------ */
function buildShellPatches(stations = 26, ring = 14) {
  const patches = [];
  const p = new THREE.Vector3();
  const pu = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const n = new THREE.Vector3();
  const eps = 1e-3;

  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1;
    for (let j = 0; j < stations; j++) {
      const t0 = j / stations, t1 = (j + 1) / stations;
      for (let i = 0; i < ring; i++) {
        const u0 = i / ring, u1 = (i + 1) / ring;
        const tc = (t0 + t1) / 2, uc = (u0 + u1) / 2;
        hullPoint(tc, uc, side, p);
        hullPoint(tc + eps, uc, side, pu);
        hullPoint(tc, uc + eps, side, pv);
        pu.sub(p).divideScalar(eps);
        pv.sub(p).divideScalar(eps);
        n.crossVectors(pv, pu).normalize();
        // make sure it points away from the hull centreline
        if (n.z * side < 0) n.negate();
        // exact patch area = |dP/dt x dP/du| * dt * du
        // (forgetting the parameter spans here makes the patches hundreds of
        //  times too large, which then destroys the heave stiffness)
        const area = pu.cross(pv).length() * (t1 - t0) * (u1 - u0);
        patches.push({
          pos: new THREE.Vector3(p.x, p.y, p.z),
          nrm: n.clone(),
          area,
          kind: uc < 0.55 ? 'bottom' : 'side',
        });
      }
    }
  }

  if(spec.hydrostaticClosure){
    // A sealed small craft carries pressure on all closing faces as well.
    // Reuse the exact visible shell triangulation, including keel and ends.
    const shell=buildHull(undefined,undefined,stations,ring);
    patches.length=0;
    shell.traverse(m=>{if(m.isMesh){patches.push(...trianglesToPatches(m.geometry,'sealed'));m.geometry.dispose();}});
  }
  return patches;
}
function buildTopsides(){
  const patches=[];
  for(const h of spec.houses??[])if(h.sealed){
    const solid=ringSolid(h.rings);patches.push(...solid.patches);solid.geometry.dispose();
  }

  // Non-watertight equipment/deck patches contribute drag, never pressure.
  const dx=spec.length/10;
  for(let j=0;j<10;j++) {
    const x=-HALF_L+(j+.5)*dx,port=spec.deckHalfWidthAt(x,-1),star=spec.deckHalfWidthAt(x,1),dz=(port+star)/5;
    for(let i=0;i<5;i++)patches.push({pos:new THREE.Vector3(x,spec.deckY,-port+(i+.5)*dz),nrm:new THREE.Vector3(0,1,0),area:dx*dz*.8,kind:'deck'});
  }
  for(const [x0,x1,z0,z1] of spec.deckBlocks) {
    const dx=(x1-x0)/5,dz=(z1-z0)/3;
    for(let j=0;j<5;j++)for(let i=0;i<3;i++)patches.push({pos:new THREE.Vector3(x0+(j+.5)*dx,spec.superstructure.topY,z0+(i+.5)*dz),nrm:new THREE.Vector3(0,1,0),area:dx*dz*.7,kind:'deck'});
  }
  return patches;
}

const buildPatches=(stations=26,ring=14)=>buildShellPatches(stations,ring).concat(buildTopsides());
return {point:hullPoint,topHeightAt,surfaces:[{point:hullPoint,waterlineOutline}],buildMesh:buildHull,waterlineOutline,buildPatches,buildShellPatches,buildTopsides};
}
function mesh(parent,geo,mat){const m=new THREE.Mesh(geo,mat);m.castShadow=m.receiveShadow=true;parent.add(m);return m;}
