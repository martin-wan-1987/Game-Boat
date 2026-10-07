/** USS Enterprise CVN-65, post-1982 island / final-deployment configuration.
 * Metres, +X bow, +Y up, +Z starboard. Public dimensions are documented in
 * qa/2026-09-30/REFERENCES.md; small fittings are photo-derived estimates.
 * Geometry, markings, camera anchors and deck collisions consume this layout.
 */
// Photo-derived planform, cross-checked against the FAS plan and the 1982
// vertical / 2007-2012 bow photographs. Keep the first 15 points starboard,
// bow→stern; the remaining points return along the port edge. The elevators
// are flush with this edge rather than separate boards extending its beam.
export const DECK_OUTLINE = [
  [171, 0], [171, 16.4], [163, 17.5], [116, 19.2], [77, 20.6],
  [71, 21.0], [48, 36.9], [13, 36.9], [-22, 36.9], [-68, 36.9],
  [-91, 36.9], [-97, 27.0], [-137, 27.0], [-151, 22.2], [-171, 22.2],
  [-171, -21.0], [-148, -21.0], [-145, -31.0], [-122, -31.0],
  [-115, -41.5], [-81, -41.5], [-46, -41.5], [-13, -41.5],
  [20, -41.5], [61, -41.5], [66, -40.4], [74, -19.0],
  [121, -17.5], [162, -16.7], [171, -16.4],
];

export function deckHalfWidth(x, side) {
  const points = side > 0 ? DECK_OUTLINE.slice(0, 15) : DECK_OUTLINE.slice(14);
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, z1] = points[i], [x2, z2] = points[i + 1];
    if (x1 !== x2 && x >= Math.min(x1, x2) && x <= Math.max(x1, x2))
      return Math.abs(z1 + (z2 - z1) * (x - x1) / (x2 - x1));
  }
  return 0;
}

export const SHIP = {
  id: 'carrier',
  name: 'USS Enterprise', displayName: '企业号核动力航空母舰', designation: 'CVN-65', number: '65',
  length: 342, beamWater: 40.5, draft: 12,
  get operatingDraft() { return this.draft; },
  get deckHalfWidth() {
    const widths = DECK_OUTLINE.map(point => point[1]);
    return (Math.max(...widths) - Math.min(...widths)) / 2;
  },
  deckY: 20, hullTopY: 18.2,
  // Keep the existing game's calibrated dynamics; this is not a naval
  // displacement simulation. The physical solver and its limits are unchanged.
  designMass: 1.0e8, gyradiusRoll: 20.5, gyradiusPitch: 95, gyradiusYaw: 94,
};

export const LAYOUT = {
  island: {
    x: -51, z: 23.8, length: 25, width: 10.8,
    houses: [
      { y: 36.2, length: 34, width: 18, corner: 3.6 },
      { y: 40.4, length: 31.5, width: 17.2, corner: 3.2 },
    ].map(house=>({...house,roofY:house.y+3.27})),
  },
  // Landing/waist launch axes diverge to PORT (+X forward, -Z port).
  landing: { start: [-169, 8], end: [62, -26.5], width: 26, wires: [49, 59, 69, 79] },
  catapults: [
    { start: [66, -8.5], end: [166, -8.5] },
    { start: [64, 13], end: [166, 11] },
    { start: [-30, -16.5], end: [63, -31.5] },
    { start: [-61, -33], end: [61, -37.8] },
  ],
  deflector: { setback: 5, length: 5.2, panelWidth: 2.2, panels: 5 },
  elevators: [
    { x: 37, length: 20.5, width: 15.5, side: 1 },
    { x: -13, length: 20.5, width: 15.5, side: 1 },
    { x: -80, length: 20.5, width: 15.5, side: 1 },
    { x: -103, length: 20.5, width: 15.5, side: -1 },
  ].map(e => ({ ...e, z: e.side * (deckHalfWidth(e.x, e.side) - e.width / 2) })),
  ciws: [{ x: 123, side: -1 }, { x: -152, side: 1 }, { x: -158, side: -1 }],
  launchers: [{ x: 110, side: 1 }, { x: -141, side: -1 }],
};

export const DECK_BLOCKS = [[
  LAYOUT.island.x - (LAYOUT.island.length + 4) / 2,
  LAYOUT.island.x + (LAYOUT.island.length + 4) / 2,
  LAYOUT.island.z - (LAYOUT.island.width + 2.6) / 2,
  LAYOUT.island.z + (LAYOUT.island.width + 2.6) / 2,
]];

export const BRIDGE_EYE = [
  LAYOUT.island.x + LAYOUT.island.length / 2 - 2,
  LAYOUT.island.houses[0].y + 2.2,
  LAYOUT.island.z - 3.2,
];

function axisFrame({ start, end }) {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const tangent = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
  return { length, tangent, normal: [-tangent[1], tangent[0]] };
}
export const LANDING_FRAME = axisFrame(LAYOUT.landing);
export const CATAPULT_FRAMES = LAYOUT.catapults.map(cat => {
  const frame = axisFrame(cat);
  return { ...cat, ...frame, deflector: cat.start.map((v, i) => v - frame.tangent[i] * LAYOUT.deflector.setback) };
});

// Paint and raised cable geometry consume the same endpoints.
export const ARRESTING_WIRES = LAYOUT.landing.wires.map(distance => {
  const { start, width } = LAYOUT.landing;
  const { tangent: t, normal: n } = LANDING_FRAME;
  const centre = [start[0] + t[0] * distance, start[1] + t[1] * distance];
  return [-1, 1].map(side => [centre[0] + n[0] * width / 2 * side, centre[1] + n[1] * width / 2 * side]);
});

Object.assign(SHIP, {
  aircraft:{countMin:1,countMax:5,kind:'f18',scale:1},
  weapons:LAYOUT.ciws.map((mount,i)=>({id:`ciws-${i}`,type:'ciws',style:'phalanx',
    position:[mount.x,SHIP.deckY-1.4,mount.side*(deckHalfWidth(mount.x,mount.side)-.4)],heading:-mount.side*Math.PI/2,
    barrels:6,length:2.2,radius:.055,width:2.2,height:2.4,bodyLength:2.2,cooldown:.07})),
  deckOutline: DECK_OUTLINE, deckHalfWidthAt: deckHalfWidth, deckBlocks: DECK_BLOCKS,
  bridgeEye: BRIDGE_EYE, deckEye: [-120, SHIP.deckY + 2.4, -18], walkStart: [40,0],
  superstructure: {x:LAYOUT.island.x,z:LAYOUT.island.z,length:LAYOUT.island.length,width:LAYOUT.island.width,centreY:46,topY:SHIP.deckY+42},
  get bridgeRoof(){const h=LAYOUT.island.houses.at(-1);return {x:LAYOUT.island.x,z:LAYOUT.island.z,y:h.roofY,length:h.length,width:h.width};},
  downflood: {height:SHIP.deckY,halfBeam:39}, lossPoint:[0,SHIP.deckY,0],
  cg:[3,0,.15],
  dynamics: {surgeRecovery:1,wettedArea:18700,swayArea:4111,friction:.0053,rollLinear:1.35e9,rollQuadratic:1.2e9,pitchDamping:1.05e11,yawDamping:2.5e10,
    thrust:3.2e7,freeSpeed:24,rudderArea:62,rudderDepth:9,clr:[-22,-7,0]},
  propulsion: {shafts:[-13.2,-4.4,4.4,13.2].map((z,i)=>({position:[-163,-8.3,z],radius:3.2,blades:5,hand:i<2?-1:1,rpm:140})),
    rudders:[-13.2,-4.4,4.4,13.2].map(z=>({position:[-170,-7.6,z],length:6.5,height:8.4}))},
  // Stern underbody rises above the four shafts, as seen in the 1985 drydock
  // photo. Waterline/topside planform stays unchanged. Section values below
  // are fractions of design beam and draft, followed by bilge exponents/flare.
  hullStations:[
    [0,18.6,2.8,3,2.3,0],[.045,19.8,8.0,3,2.4,0],[.12,20.5,12,3,2.4,0],
    [.3,20.6,12.2,3,2.4,0],[.52,20.6,12.2,3,2.4,0],[.66,20.4,12.1,2.9,2.4,.02],
    [.76,19.8,11.9,2.8,2.3,.05],[.84,18.4,11.2,2.6,2.2,.1],[.9,16.2,10.3,2.4,2,.16],
    [.945,12.6,8.9,2.2,1.8,.22],[.975,8.2,7,2,1.6,.24],[.993,4.4,5,1.8,1.4,.18],[1,1.6,3.6,1.6,1.2,.06],
  ].map(([t,beam,keel,...rest])=>[t,beam/41,keel/12.2,...rest]),
});
