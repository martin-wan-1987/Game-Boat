/** USS Enterprise CVN-65, reconstructed from multi-angle reference photos.
 * Shared hull loft drives the visible mesh, waterline foam and hydrostatic patches.
 * All deck and island coordinates live in carrier-layout.js.
 */
import * as THREE from 'three';
import { createHullLoft } from './hull-loft.js';
import { buildPropulsion } from './propulsion.js';
import { bakeStatic } from './mesh-bake.js';
import { WeaponBattery } from './weapons.js';
import { SHIP, LAYOUT, DECK_OUTLINE, LANDING_FRAME, CATAPULT_FRAMES, ARRESTING_WIRES, deckHalfWidth } from './carrier-layout.js';
export { SHIP, deckHalfWidth } from './carrier-layout.js';
const HALF_L = SHIP.length / 2;

const loft=createHullLoft(SHIP);
export const {buildMesh:buildHull,waterlineOutline,buildPatches}=loft;
const hullPoint=loft.point;

function canvasTex(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 8;
  if (opts.wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.needsUpdate = true;
  return t;
}

function noiseOverlay(g, w, h, amount, size = 2) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

/**
 * Procedural normal map from a tiled value-noise height field.
 *
 * This is what kills the "plastic" look: every flat surface (hull plating,
 * deck, island) gets micro-relief — panel edges, weld beads, pitting — that
 * catches the sun and breaks up the specular. Without it the hull reads
 * like a bathtub toy no matter how good the albedo texture is.
 *
 * @param {number} size     texture edge, power of two
 * @param {number} strength slope scale (higher = more pronounced relief)
 * @param {number} freq     noise frequency (higher = finer detail)
 */
function makeNormalTexture(size = 512, strength = 2.2, freq = 12, seed = 0) {
  // ---- height field -------------------------------------------------
  const H = new Float32Array(size * size);
  const hash = (x, y) => {
    let n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
    return n - Math.floor(n);
  };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  const fbm = (x, y, oct = 4) => {
    let s = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
    return s;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * freq, fy = (y / size) * freq;
      H[y * size + x] = fbm(fx, fy, 4) * 0.65 + fbm(fx * 3.3, fy * 3.3, 3) * 0.35;
    }
  }
  // ---- Sobel -> tangent-space normals --------------------------------
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => H[((y % size) + size) % size * size + ((x % size) + size) % size];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1.0;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * Hull sides: anti-fouling red below the waterline, boot topping, haze grey.
 *
 * NB three flips canvas textures by default (flipY = true), so texture
 * v = 0 sits at the BOTTOM row of the canvas. All drawing goes through py()
 * to keep that straight — getting it wrong paints the red bottom on the
 * upper hull.
 *
 * @param {boolean} mirror  true for the port side. Text glyphs are flipped
 *   about their anchor so the hull number reads correctly from outside on
 *   *both* sides (feature positions are unchanged).
 */
function makeHullTexture(mirror = false) {
  return canvasTex(2048, 320, (g, w, h) => {
    // hull texture v = (y + SHIP.draft + 1) / (SHIP.hullTopY + SHIP.draft + 2), y in metres relative to the waterline
    const py = (y) => h * (1 - (y + SHIP.draft + 1) / (SHIP.hullTopY + SHIP.draft + 2));
    const flip = () => { if (mirror) g.scale(-1, 1); };

    // topside haze grey over everything
    g.fillStyle = '#7e858c';
    g.fillRect(0, 0, w, h);
    // anti-fouling red below the waterline
    g.fillStyle = '#5d3129';
    g.fillRect(0, py(0), w, h - py(0));
    // boot topping straddling the waterline
    g.fillStyle = '#15171a';
    g.fillRect(0, py(1.1), w, py(-1.1) - py(1.1));

    // marine fouling band just below the waterline: barnacles and weed.
    // Every real hull carries it — a clean red bottom below the boot top is
    // the classic "model, not ship" tell.
    {
      const grd = g.createLinearGradient(0, py(-0.9), 0, py(-4.5));
      grd.addColorStop(0, 'rgba(56,52,30,0.85)');
      grd.addColorStop(0.45, 'rgba(64,70,34,0.55)');
      grd.addColorStop(1, 'rgba(70,52,30,0.0)');
      g.fillStyle = grd;
      g.fillRect(0, py(-0.9), w, py(-4.5) - py(-0.9));
      // weed tufts: short darker strokes at random spots along the band
      for (let i = 0; i < 220; i++) {
        const x = Math.random() * w;
        const y = py(-1.0 + Math.random() * 1.6);
        g.strokeStyle = `rgba(40,44,22,${0.25 + Math.random() * 0.3})`;
        g.lineWidth = 1 + Math.random() * 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (Math.random() - 0.5) * 4, y + 3 + Math.random() * 8);
        g.stroke();
      }
    }

    // rust weeping: from the hawse pipe, the draft-mark bolts and a few
    // plate seams — thin oxide drips running DOWN from each feature
    const rust = (x, y, n, len) => {
      for (let i = 0; i < n; i++) {
        const dx = x + (Math.random() - 0.5) * 26;
        const l = len * (0.5 + Math.random());
        g.strokeStyle = `rgba(96,58,34,${0.10 + Math.random() * 0.16})`;
        g.lineWidth = 0.8 + Math.random() * 1.8;
        g.beginPath();
        g.moveTo(dx, y);
        g.bezierCurveTo(dx + 2, y + l * 0.4, dx - 2, y + l * 0.7, dx + 1, y + l);
        g.stroke();
      }
    };
    rust(w * 0.79, py(2.6), 10, 60);       // hawse
    rust(w * 0.052, py(1.2), 6, 40);       // fwd draft marks
    rust(w * 0.935, py(1.2), 6, 40);       // aft draft marks
    for (let i = 0; i < 9; i++) rust(Math.random() * w, py(2 + Math.random() * 8), 3, 34);

    // vertical weathering streaks running down from the deck edge
    for (let i = 0; i < 900; i++) {
      const x = Math.random() * w;
      const top = Math.random() * py(4);
      const len = Math.random() * (py(2) - top);
      const a = Math.random() * 0.11;
      g.strokeStyle = Math.random() < 0.32
        ? `rgba(96,62,40,${a})` : `rgba(66,74,82,${a})`;
      g.lineWidth = Math.random() * 3 + 0.4;
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x + (Math.random() - 0.5) * 6, top + len);
      g.stroke();
    }
    // plate seams
    g.strokeStyle = 'rgba(48,54,60,0.32)';
    g.lineWidth = 1.2;
    for (let i = 0; i <= 26; i++) {
      const x = (i / 26) * w;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, py(0)); g.stroke();
    }
    for (let i = 1; i <= 6; i++) {
      const y = py(i * 2.6);
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }

    // draft marks just above the waterline, fore and aft
    g.font = 'bold 12px sans-serif';
    g.textAlign = 'center';
    for (const fx of [0.052, 0.935]) {
      const px = fx * w;
      for (let m = 2; m <= 12; m += 2) {
        const y = py(-m);
        g.fillStyle = '#eef1f3';
        g.fillRect(px - 9, y - 1, 18, 2);
        g.save();
        g.translate(px, y - 5);
        flip();
        g.fillText(String(m), 0, 0);
        g.restore();
      }
    }

    // hull number, high on the bow plating
    g.save();
    g.translate(w * 0.845, py(11));
    flip();
    g.fillStyle = '#d8dcd4';
    g.font = 'bold 78px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(SHIP.number, 0, 0);
    g.restore();

    // anchor hawse pipe
    g.fillStyle = 'rgba(16,18,20,0.95)';
    g.beginPath();
    g.ellipse(w * 0.79, py(3.2), 14, 20, 0, 0, 7);
    g.fill();

    noiseOverlay(g, w, h, 15);
  });
}


function makeNetTexture() {
  return canvasTex(256, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2.2;
    const step = 16;
    for (let x = 0; x <= w; x += step) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    for (let y = 0; y <= h; y += step) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
  }, { wrap: true });
}


function buildEnsign() {
  const g = new THREE.Group();
  const W = 5.2, H = 3.2;
  const tex = canvasTex(256, 160, (c, w, h) => {
    const stripes = 13;
    for (let i = 0; i < stripes; i++) {
      c.fillStyle = i % 2 ? '#f2f4f6' : '#b6282e';
      c.fillRect(0, (i / stripes) * h, w, h / stripes + 1);
    }
    c.fillStyle = '#22356e';
    c.fillRect(0, 0, w * 0.42, h * 0.54);
    c.fillStyle = '#f2f4f6';
    for (let r = 0; r < 4; r++) for (let cc = 0; cc < 5; cc++) {
      c.beginPath();
      c.arc(8 + cc * (w * 0.42 - 14) / 4, 10 + r * (h * 0.54 - 18) / 3, 3.2, 0, 7);
      c.fill();
    }
  });
  const mat = new THREE.MeshStandardMaterial({
    map: tex, side: THREE.DoubleSide, roughness: 0.85, metalness: 0.0,
  });
  const geo = new THREE.PlaneGeometry(W, H, 22, 6);
  geo.translate(W / 2, 0, 0);            // hoist edge at local x = 0
  const flag = new THREE.Mesh(geo, mat);
  flag.castShadow = false;
  flag.userData.dynamic = true;          // animated; keep out of the bake
  const base = geo.attributes.position.array.slice();
  flag.userData.animate = (t) => {
    const pos = geo.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      const e = x / W;                   // 0 at the hoist, 1 at the fly
      arr[i * 3 + 2] = base[i * 3 + 2]
        + Math.sin(x * 1.9 - t * 8.5) * 0.42 * e
        + Math.sin(x * 3.7 - t * 13.0) * 0.16 * e;
      arr[i * 3 + 1] = y - e * e * 0.35  // the fly droops a touch
        + Math.sin(x * 2.6 - t * 6.0) * 0.10 * e;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };
  // gaff staff on the transom, flag flying aft
  const staff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.12, 15, 8),
    new THREE.MeshStandardMaterial({ color: 0xb8bec4, roughness: 0.5, metalness: 0.4 }));
  staff.position.set(-HALF_L + 2, SHIP.deckY + 7.5, 0);
  staff.castShadow = true;
  g.add(staff);
  flag.position.set(-HALF_L + 2, SHIP.deckY + 13.6, 0);
  flag.rotation.y = Math.PI / 2;         // plane spans aft
  g.add(flag);
  g.userData.animate = (t) => flag.userData.animate(t);
  return g;
}


function flipWinding(geo) {
  const attrs = Object.values(geo.attributes);
  const count = geo.attributes.position.count;
  for (const a of attrs) {
    const it = a.itemSize;
    const arr = a.array;
    for (let i = 0; i < count; i += 3) {
      for (let k = 0; k < it; k++) {
        const t = arr[(i + 2) * it + k];
        arr[(i + 2) * it + k] = arr[i * it + k];
        arr[i * it + k] = t;
      }
    }
  }
}


// Flight-deck artwork is generated from the same metres-based layout as geometry.
const ZMIN = Math.min(...DECK_OUTLINE.map(p => p[1])) - 2;
const ZMAX = Math.max(...DECK_OUTLINE.map(p => p[1])) + 10;
function makeDeckTexture() {
  return canvasTex(4096, 1024, (g, w, h) => {
    const px = x => (x + HALF_L) / SHIP.length * w;
    const pz = z => (1 - (z - ZMIN) / (ZMAX - ZMIN)) * h;
    const scale = h / (ZMAX - ZMIN);
    g.fillStyle = '#34383b'; g.fillRect(0, 0, w, h);
    noiseOverlay(g, w, h, 17);
    const line = (a, b, width, color, dash = []) => {
      g.strokeStyle = color; g.lineWidth = width * scale;
      g.setLineDash(dash.map(v => v * scale));
      g.beginPath(); g.moveTo(px(a[0]), pz(a[1])); g.lineTo(px(b[0]), pz(b[1])); g.stroke();
      g.setLineDash([]);
    };
    const rect = (x, z, l, d, color) => {
      g.fillStyle = color; g.fillRect(px(x-l/2), pz(z+d/2), l/SHIP.length*w, d*scale);
    };
    // Weld seams and tie-down grid remain subtle at grazing angles.
    for (let x=-168; x<171; x+=8) {
      line([x,ZMIN], [x,ZMAX], 0.035, '#24292c');
      for (let z=-47; z<35; z+=3.2) { g.fillStyle='#8b8e89'; g.beginPath(); g.arc(px(x),pz(z),0.85,0,Math.PI*2); g.fill(); }
    }
    const {start:a,end:b,width} = LAYOUT.landing;
    const n = LANDING_FRAME.normal.map(v => v * width / 2);
    g.fillStyle='#292e31'; g.beginPath();
    for (const p of [[a[0]+n[0],a[1]+n[1]],[b[0]+n[0],b[1]+n[1]],[b[0]-n[0],b[1]-n[1]],[a[0]-n[0],a[1]-n[1]]]) g.lineTo(px(p[0]),pz(p[1]));
    g.closePath(); g.fill();
    const { tangent:t, normal } = LANDING_FRAME;
    const landingAt=(distance,offset)=>[a[0]+t[0]*distance+normal[0]*offset,a[1]+t[1]*distance+normal[1]*offset];
    for (const side of [-1,1]) {
      line(landingAt(0,side*width/2),landingAt(LANDING_FRAME.length,side*width/2),0.55,'#d9dad0');
      line(landingAt(0,side*(width/2-1.0)),landingAt(LANDING_FRAME.length,side*(width/2-1.0)),0.55,'#d9dad0',[4.2,3.2]);
    }
    line(a,b,0.4,'#d8b84f');
    // Sparse aft threshold marks, rather than the old keyboard-like zebra.
    for(const side of [-1,1])for(const offset of [5.5,8])
      line(landingAt(4,side*offset),landingAt(12,side*offset),0.5,'#d9dad0');
    for (const [start, end] of ARRESTING_WIRES) line(start,end,0.16,'#aaaa9f');
    CATAPULT_FRAMES.forEach(({start,end,deflector,normal:n,tangent:t},index) => {
      line(start,end,0.7,'#92958e'); line(start,end,0.12,'#1b1e20');
      // Yellow denotes the short launch/deflector safety zone. The full-length
      // four-lane yellow corridors in the old texture were not in the photos.
      for (const side of [-1,1]) line([start[0]-t[0]*8+n[0]*side*6,start[1]-t[1]*8+n[1]*side*6],[start[0]+t[0]*6+n[0]*side*6,start[1]+t[1]*6+n[1]*side*6],0.2,'#cbb15a',[1.2,1.2]);
      g.font=`bold ${scale*1.7}px Arial`;g.fillStyle='#deded2';g.textAlign='center';g.fillText(String(index+1),px(start[0]-13),pz(start[1]));
    });
    for (const e of LAYOUT.elevators) {
      rect(e.x,e.z,e.length,e.width,'#42484a');
      g.strokeStyle='#d0ba55';g.lineWidth=scale*0.25;
      g.strokeRect(px(e.x-e.length/2),pz(e.z+e.width/2),e.length/SHIP.length*w,e.width*scale);
      line([e.x-e.length/2,e.z],[e.x+e.length/2,e.z],0.07,'#24282b');
    }
    // 65 is aligned to read from the bow, as on the real carrier.
    g.save();g.translate(px(143),pz(0));g.rotate(-Math.PI/2);
    g.font=`900 ${scale*13}px Arial`;g.strokeStyle='#dfdfd4';g.lineWidth=scale*0.4;
    g.fillStyle='#373c3e';g.textAlign='center';g.textBaseline='middle';
    g.strokeText(SHIP.number,0,0);g.fillText(SHIP.number,0,0);g.restore();
    for (let x=-144;x<120;x+=18) {
      const z=deckHalfWidth(x,1)-4;
      line([x-6,z],[x+6,z],0.15,'#aaa99b');line([x,z-4],[x,z+2],0.15,'#aaa99b');
    }
    // Outline paint follows the actual polygon rather than a bounding rectangle.
    for(let i=0;i<DECK_OUTLINE.length;i++) line(DECK_OUTLINE[i],DECK_OUTLINE[(i+1)%DECK_OUTLINE.length],0.32,'#c7c8bb');
  }, {aniso:16});
}

function makePanelTexture() {
  return canvasTex(1024,512,(g,w,h)=>{
    g.fillStyle='#8d9395';g.fillRect(0,0,w,h);noiseOverlay(g,w,h,9);
    g.strokeStyle='rgba(37,44,46,.15)';g.lineWidth=1;
    for(let x=0;x<w;x+=96){g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}
    for(let y=0;y<h;y+=85){g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();}
  });
}
function shipMaterials() {
  const normal=makeNormalTexture(256,0.7,16,4);
  const hullRoughness=canvasTex(512,256,(g,w,h)=>{
    const water=h*(1-13/32),gradient=g.createLinearGradient(0,water-65,0,water+12);
    gradient.addColorStop(0,'#dedede');gradient.addColorStop(0.8,'#747474');gradient.addColorStop(1,'#565656');
    g.fillStyle=gradient;g.fillRect(0,0,w,h);
  });hullRoughness.colorSpace=THREE.NoColorSpace;
  const deckRoughness=canvasTex(1024,256,(g,w,h)=>{
    g.fillStyle='#e9e9e9';g.fillRect(0,0,w,h);
    for(let i=0;i<65;i++){
      const x=(i*0.61803398875%1)*w,y=(i*0.41421356237%1)*h;
      g.fillStyle=`rgba(60,60,60,${0.12+(i%5)*0.025})`;g.beginPath();g.ellipse(x,y,15+(i%7)*15,3+(i%4)*2,0,0,Math.PI*2);g.fill();
    }
  });deckRoughness.colorSpace=THREE.NoColorSpace;
  const mat=(name,options)=>new THREE.MeshPhysicalMaterial({name,roughness:0.62,metalness:0.04,clearcoat:0.2,clearcoatRoughness:0.28,...options});
  return {
    hull:mat('Enterprise starboard hull',{map:makeHullTexture(false),normalMap:normal,normalScale:new THREE.Vector2(0.18,0.18),roughnessMap:hullRoughness,clearcoat:0.38,clearcoatRoughness:0.18}),
    hullPort:mat('Enterprise port hull',{map:makeHullTexture(true),normalMap:normal,normalScale:new THREE.Vector2(0.18,0.18),roughnessMap:hullRoughness,clearcoat:0.38,clearcoatRoughness:0.18}),
    deckTop:mat('Enterprise flight deck',{map:makeDeckTexture(),roughness:0.79,roughnessMap:deckRoughness,metalness:0.02,clearcoat:0.16,clearcoatRoughness:0.48,side:THREE.DoubleSide}),
    grey:mat('Haze grey',{color:0x838e93,roughness:0.57,clearcoat:0.34}),
    island:mat('Island plating',{map:makePanelTexture(),color:0xc6cccb}),
    dark:mat('Gallery recesses',{color:0x414b50}),
    steel:mat('Machinery steel',{color:0x687277,roughness:0.53,metalness:0.45}),
    white:mat('Radomes and rafts',{color:0xd4d7cd,roughness:0.9}),
    glass:mat('Bridge windows',{color:0x294e5c,roughness:0.085,metalness:0.05,clearcoat:1,clearcoatRoughness:0.06,transparent:true,opacity:0.35,depthWrite:false}),
    black:mat('Cables and apertures',{color:0x1f262a}),
    yellow:mat('Deck equipment',{color:0xba9c42}),
    red:mat('Fire equipment',{color:0xa34836}),
    net:mat('Safety nets',{map:makeNetTexture(),transparent:true,side:THREE.DoubleSide,depthWrite:false,color:0x969d98}),
  };
}
function mesh(parent,geo,mat,x=0,y=0,z=0) {
  const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function box(parent,mat,x,y,z,l,h,d) { return mesh(parent,new THREE.BoxGeometry(l,h,d),mat,x,y,z); }
function strut(parent,mat,a,b,r=0.065,segments=6) {
  const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),dir=end.clone().sub(start);
  const m=mesh(parent,new THREE.CylinderGeometry(r,r,dir.length(),segments),mat,...start.clone().add(end).multiplyScalar(0.5).toArray());
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),dir.normalize());return m;
}
function railing(parent,mats,points,y,spacing=3.8) {
  for(let i=0;i<points.length-1;i++) {
    const a=points[i],b=points[i+1],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    for(const height of [0.52,1.04])strut(parent,mats.grey,[a[0],y+height,a[1]],[b[0],y+height,b[1]],0.045);
    for(let k=0,n=Math.ceil(length/spacing);k<n;k++) {
      const f=k/n,x=a[0]+(b[0]-a[0])*f,z=a[1]+(b[1]-a[1])*f;
      strut(parent,mats.grey,[x,y,z],[x,y+1.08,z],0.055);
    }
  }
}
function deckShape() {
  const shape=new THREE.Shape();DECK_OUTLINE.forEach(([x,z],i)=>i?shape.lineTo(x,z):shape.moveTo(x,z));shape.closePath();return shape;
}
function buildDeck(mats) {
  const g=new THREE.Group(),shape=deckShape();
  const top=new THREE.ShapeGeometry(shape);
  const positions=top.attributes.position,uv=new Float32Array(positions.count*2);
  for(let i=0;i<positions.count;i++){uv[i*2]=(positions.getX(i)+HALF_L)/SHIP.length;uv[i*2+1]=(positions.getY(i)-ZMIN)/(ZMAX-ZMIN);}
  top.setAttribute('uv',new THREE.BufferAttribute(uv,2));top.rotateX(Math.PI/2);top.translate(0,SHIP.deckY,0);
  const ids=top.index.array;for(let i=0;i<ids.length;i+=3){const t=ids[i];ids[i]=ids[i+2];ids[i+2]=t;}top.computeVertexNormals();
  mesh(g,top,mats.deckTop);
  const slab=new THREE.ExtrudeGeometry(shape,{depth:1.5,bevelEnabled:false});slab.rotateX(Math.PI/2);slab.translate(0,SHIP.deckY-0.06,0);mesh(g,slab,mats.grey);
  // Closed sloping overhang plating from the actual hull to the deck outline.
  for(const side of [1,-1]) {
    const edge=side>0?DECK_OUTLINE.slice(0,15):DECK_OUTLINE.slice(15).concat([DECK_OUTLINE[0]]);
    for(let i=0;i<edge.length-1;i++) {
      const a=edge[i],b=edge[i+1],verts=[];
      for(const [x,z] of [a,b]) {
        const t=THREE.MathUtils.clamp((x+HALF_L)/SHIP.length,0,1),p=hullPoint(t,0.83,side);
        verts.push(x,SHIP.deckY-1.55,z,p.x,p.y,p.z);
      }
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setIndex(side>0?[0,1,2,2,1,3]:[0,2,1,2,3,1]);geo.computeVertexNormals();
      // Reuse a dedicated material for the whole non-UV underside stream.
      mesh(g,geo,mats.underside);
      const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const catwalk=box(g,mats.dark,(a[0]+b[0])/2,SHIP.deckY-0.85,(a[1]+b[1])/2,length,0.24,1.15);
      catwalk.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);
      if(length>1){const net=mesh(g,new THREE.PlaneGeometry(length,1.7),mats.net,(a[0]+b[0])/2,SHIP.deckY-0.55,(a[1]+b[1])/2+side*0.6);net.rotation.set(-Math.PI/2,-Math.atan2(b[1]-a[1],b[0]-a[0]),0);}
    }
    for(let x=-153;x<146;x+=12) {
      const p=hullPoint((x+HALF_L)/SHIP.length,0.79,side),z=side*(deckHalfWidth(x,side)-0.6);
      strut(g,mats.dark,p.toArray(),[x,SHIP.deckY-1.8,z],0.28,6);
    }
  }
  for(const e of LAYOUT.elevators) {
    box(g,mats.grey,e.x,SHIP.deckY-0.76,e.z,e.length,1.3,e.width);
    for(const x of [e.x-e.length/2,e.x+e.length/2])strut(g,mats.steel,[x,8,e.z+e.side*e.width/2],[x,SHIP.deckY-1,e.z+e.side*e.width/2],0.32);
    const p=hullPoint((e.x+HALF_L)/SHIP.length,0.78,e.side);
    box(g,mats.black,e.x,13,p.z+e.side*0.25,e.length-1.6,7,0.2);
    for(let y=10.3;y<=16;y+=0.48)box(g,mats.steel,e.x,y,p.z+e.side*0.4,e.length-1.6,0.035,0.2);
  }
  // Deflectors are lowered when there are no aircraft, keeping the deck walkable.
  for(const cat of CATAPULT_FRAMES) {
    const {deflector:[x,z],tangent:t,normal:n}=cat,def=LAYOUT.deflector;
    for(let i=0;i<def.panels;i++) {
      const offset=(i-(def.panels-1)/2)*def.panelWidth;
      const panel=box(g,mats.steel,x+n[0]*offset,SHIP.deckY+0.055,z+n[1]*offset,def.length,0.11,def.panelWidth-0.1);
      panel.rotation.y=-Math.atan2(t[1],t[0]);
    }
  }
  // Actual cable geometry has a different specular response from painted lines.
  for(const [a,b] of ARRESTING_WIRES) strut(g,mats.steel,[a[0],SHIP.deckY+0.06,a[1]],[b[0],SHIP.deckY+0.06,b[1]],0.045);
  return g;
}

function houseOutline(cx,cz,length,width,corner) {
  const x=length/2,z=width/2;
  return [[-x+corner,-z],[x-corner,-z],[x,-z+corner],[x,z-corner],
    [x-corner,z],[-x+corner,z],[-x,z-corner],[-x,-z+corner]]
    .map(([dx,dz])=>[cx+dx,cz+dz]);
}
function profileSlab(parent,material,outline,y,thickness) {
  const shape=new THREE.Shape();
  outline.forEach(([x,z],i)=>i?shape.lineTo(x,z):shape.moveTo(x,z));shape.closePath();
  const geo=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false});
  geo.rotateX(Math.PI/2);geo.translate(0,y,0);
  return mesh(parent,geo,material);
}
function bridgeHouse(parent,mats,cx,cz,house) {
  const {y,length,width,corner}=house;
  const outline=houseOutline(cx,cz,length,width,corner);
  const gallery=houseOutline(cx,cz,length+2.4,width+2.4,corner+0.8);
  profileSlab(parent,mats.grey,gallery,y,0.4);
  profileSlab(parent,mats.island,outline,y+1.2,1.2);
  // Each window follows a facet; the clipped corners and overhanging wings
  // are part of the same profile as the sill, roof and exterior gallery.
  for(let i=0;i<outline.length;i++) {
    const a=outline[i],b=outline[(i+1)%outline.length];
    const dx=b[0]-a[0],dz=b[1]-a[1],span=Math.hypot(dx,dz),angle=-Math.atan2(dz,dx);
    const window=box(parent,mats.glass,(a[0]+b[0])/2,y+2,(a[1]+b[1])/2,span,1.2,0.08);
    window.rotation.y=angle;
    const bays=Math.ceil(span/1.65);
    for(let k=0;k<=bays;k++) {
      const f=k/bays,m=box(parent,mats.grey,a[0]+dx*f,y+2,a[1]+dz*f,0.11,1.3,0.17);
      m.rotation.y=angle;
    }
  }
  profileSlab(parent,mats.grey,houseOutline(cx,cz,length+0.9,width+0.9,corner+0.3),house.roofY,0.35);
  railing(parent,mats,[...gallery,gallery[0]],y,2.5);
}

function buildIsland(mats) {
  const g=new THREE.Group(),I=LAYOUT.island,{x:cx,z:cz,length:l,width:d}=I,Y=SHIP.deckY;
  box(g,mats.grey,cx,Y+0.8,cz,l+4,1.6,d+2.6);
  box(g,mats.island,cx,Y+8.1,cz,l,14.6,d);
  // The number-bearing shoulder is broader than the supporting tower, with
  // deeply ribbed cantilevers visible in the 2012 port-side close-ups.
  const shoulder=I.houses[0];
  profileSlab(g,mats.island,houseOutline(cx,cz,shoulder.length-2,shoulder.width-0.8,shoulder.corner),shoulder.y,5.3);
  for(const side of [-1,1])for(let x=cx-11;x<=cx+11;x+=2.2) {
    strut(g,mats.grey,[x,Y+8.9,cz+side*d/2],[x,shoulder.y-4.5,cz+side*(shoulder.width/2-0.4)],0.17);
  }
  // Enterprise's broad overhanging two-level bridge is its main recognition feature.
  for(const house of I.houses) bridgeHouse(g,mats,cx,cz,house);
  // Cantilevered galleries, stairs, piping and the port-side white 65.
  for(const y of [Y+5.3,Y+11.2]) {
    box(g,mats.grey,cx-3,y,cz-d/2-2.4,l-7,0.3,4.8);
    railing(g,mats,[[cx-l/2+0.3,cz-d/2-4.5],[cx+l/2-6,cz-d/2-4.5]],y);
    for(const x of [cx-9,cx+7])strut(g,mats.grey,[x,Y+1,cz-d/2],[x,y,cz-d/2-4.1],0.13);
    // Companionways connect the deck galleries, including their handrails.
    const sx=cx-l/2+1,sz=cz-d/2-2;
    for(let n=0;n<12;n++)box(g,mats.steel,sx+n*0.32,y-4.2+n*0.35,sz,0.37,0.09,1.1);
    for(const side of [-1,1])strut(g,mats.grey,[sx,y-3.2,sz+side*0.6],[sx+3.8,y+1,sz+side*0.6],0.055);
  }
  for(const side of [-1,1]) {
    const label=canvasTex(512,256,(c,w,h)=>{c.fillStyle='#90979a';c.fillRect(0,0,w,h);c.font='bold 190px Arial';c.textAlign='center';c.textBaseline='middle';c.lineWidth=5;c.strokeStyle='#4c565b';c.strokeText(SHIP.number,w/2,h/2);c.fillStyle='#e1e4df';c.fillText(SHIP.number,w/2,h/2);});
    const m=new THREE.MeshPhysicalMaterial({name:`Island ${SHIP.number} ${side}`,map:label,roughness:0.64,clearcoat:0.18});
    mesh(g,new THREE.PlaneGeometry(13.8,5.1),m,cx+2,shoulder.y-2.65,cz+side*(shoulder.width/2-0.32)).rotation.y=side>0?0:Math.PI;
    for(let y=Y+2;y<Y+13;y+=0.65)strut(g,mats.steel,[cx-l/2+2,y,cz+side*(d/2+0.25)],[cx-l/2+3.1,y,cz+side*(d/2+0.25)],0.06);
    for(const x of [cx-l/2+2,cx-l/2+3.1])strut(g,mats.steel,[x,Y+1,cz+side*(d/2+0.25)],[x,Y+13,cz+side*(d/2+0.25)],0.08);
  }
  // Rounded flight-control observation cabin and its open ribbed balcony.
  const porchX=cx+9.8,porchZ=cz-shoulder.width/2-1.1,porchY=shoulder.y-2.3;
  mesh(g,new THREE.CylinderGeometry(3.2,3.2,1.5,32),mats.glass,porchX,porchY+0.5,porchZ);
  for(const height of [-0.45,1.35])mesh(g,new THREE.CylinderGeometry(3.6,3.6,0.23,32),mats.grey,porchX,porchY+height,porchZ);
  for(let i=0;i<12;i++) {
    const angle=i*Math.PI/6,x=porchX+Math.cos(angle)*3.25,z=porchZ+Math.sin(angle)*3.25;
    strut(g,mats.grey,[x,porchY-0.2,z],[x,porchY+1.3,z],0.075);
    strut(g,mats.steel,[porchX,porchY-1.6,porchZ],[x,porchY-0.6,z],0.10);
  }
  for(const [x,side] of [[cx-12,-1],[cx+11,1]]) {
    const z=cz+side*(shoulder.width/2+1),y=Y+9.8;
    const arc=Array.from({length:17},(_,i)=>[x+3.5*Math.cos(i*Math.PI/16),z+side*3.5*Math.sin(i*Math.PI/16)]);
    profileSlab(g,mats.grey,[[x-3.5,z],...arc,[x+3.5,z]],y,0.25);
    railing(g,mats,arc,y,1.5);
    for(let i=0;i<arc.length;i+=2)strut(g,mats.steel,[x,y-2.6,cz+side*d/2],[arc[i][0],y-0.2,arc[i][1]],0.11);
  }
  const warning=canvasTex(512,128,(c,w,h)=>{c.fillStyle='#262b29';c.fillRect(0,0,w,h);c.fillStyle='#d5bb55';c.textAlign='center';c.font='bold 30px Arial';['BEWARE OF JET','BLAST PROPS','AND ROTORS'].forEach((t,i)=>c.fillText(t,w/2,33+i*34));});
  mesh(g,new THREE.PlaneGeometry(5.3,1.8),new THREE.MeshStandardMaterial({name:'Island blast warning',map:warning}),cx+2,Y+7,cz-d/2-0.1).rotation.y=Math.PI;
  for(let x=cx-9;x<=cx+9;x+=6) {
    box(g,mats.dark,x,Y+7.5,cz+d/2+0.05,3.3,2.2,0.15);
    for(let k=0;k<7;k++)box(g,mats.grey,x,Y+6.6+k*0.27,cz+d/2+0.16,3.1,0.07,0.12);
  }
  const roof=SHIP.bridgeRoof.y;
  // Rooftop equipment housings break up the broad roof, as in the final
  // deployment photos; the open platforms carry radomes and mast services.
  for(const [x,z,ll,hh,dd] of [[cx-7,cz,6,2.2,4],[cx+6,cz+1,5,1.1,3],[cx-1,cz-5,3,1.4,2]]) {
    box(g,mats.island,x,roof+hh/2,z,ll,hh,dd);
    box(g,mats.grey,x,roof+hh+0.15,z,ll+0.4,0.3,dd+0.4);
    for(let yy=0.3;yy<hh;yy+=0.25)box(g,mats.dark,x,roof+yy,z+dd/2+0.02,ll-0.6,0.06,0.05);
  }
  // Two-tier open lattice / yardarm mast, not a Ford-class enclosed array tower.
  const mx=cx-3,mz=cz,base=roof+0.4;
  for(const [ax,az] of [[-2.1,-1.7],[-2.1,1.7],[2.1,-1.7],[2.1,1.7]])strut(g,mats.grey,[mx+ax,base,mz+az],[mx+ax*0.35,base+14,mz+az*0.35],0.17);
  for(let y=0;y<14;y+=2.8) {
    const a=1-y/14*0.65,b=1-(y+2.8)/14*0.65;
    for(const side of [-1,1]){
      strut(g,mats.steel,[mx-2.1*a,base+y,mz+side*1.7*a],[mx+2.1*b,base+y+2.8,mz+side*1.7*b],0.075);
      strut(g,mats.steel,[mx+side*2.1*a,base+y,mz-1.7*a],[mx+side*2.1*b,base+y+2.8,mz+1.7*b],0.075);
    }
  }
  strut(g,mats.grey,[mx,base+12,mz],[mx,base+31,mz],0.28);
  for(const y of [27,30,31])mesh(g,new THREE.CylinderGeometry(0.52,0.52,0.14,12),mats.grey,mx,base+y,mz);
  for(const [height,span] of [[14,23],[23,18]]) {
    box(g,mats.grey,mx,base+height,mz,2.4,0.35,span);
    for(const side of [-1,1]){
      strut(g,mats.steel,[mx,base+height-4,mz],[mx,base+height,mz+side*span/2],0.13);
      for(let z=3;z<span/2;z+=2.2)strut(g,mats.black,[mx,base+height,mz+side*z],[mx,base+height+2.6,mz+side*z],0.055);
    }
    railing(g,mats,[[mx-1.2,mz-span/2],[mx-1.2,mz+span/2]],base+height,2.8);
  }
  for(const [x,z,r] of [[cx-12,cz-5.4,1.7],[cx+12,cz+5.9,1.4],[cx-6,cz+6.5,1.2],[cx+7,cz-5.7,1.0]]) {
    mesh(g,new THREE.CylinderGeometry(r,r,1.2,14),mats.white,x,roof+0.8,z);
    mesh(g,new THREE.SphereGeometry(r,18,12,0,Math.PI*2,0,Math.PI/2),mats.white,x,roof+1.4,z);
    box(g,mats.grey,x,roof-0.4,z,r*2.5,0.3,r*2.5);
  }
  // SPS-48 planar radar, separate SPS-49 open reflector; both remain dynamic.
  const spin=new THREE.Group();spin.userData.dynamic=true;spin.position.set(cx+9,base+5,mz);
  strut(g,mats.grey,[cx+9,roof,mz],[cx+9,base+3,mz],0.42);
  const panel=box(spin,mats.grey,0,0,0,4.6,6.6,0.32);panel.rotation.z=-0.12;
  for(let y=-2.8;y<=2.8;y+=0.5)box(spin,mats.steel,0,y,0.2,4.4,0.035,0.025);
  strut(spin,mats.steel,[-2,-3,-0.5],[2,3,-0.5],0.08);g.add(spin);g.userData.spin=spin;
  const search=new THREE.Group();search.userData.dynamic=true;search.position.set(mx,base+18.5,mz);
  const reflector=(y,z)=>[0.035*(y*y+z*z),y,z];
  const wire=points=>{for(let i=1;i<points.length;i++)strut(search,mats.steel,points[i-1],points[i],0.045);};
  for(let k=-7;k<=7;k++) {
    const z=k/8*4.8,h=1.8*Math.sqrt(1-(z/4.8)**2);
    wire(Array.from({length:9},(_,j)=>reflector(-h+2*h*j/8,z)));
  }
  for(let k=-3;k<=3;k++) {
    const y=k/4*1.8,w=4.8*Math.sqrt(1-(y/1.8)**2);
    wire(Array.from({length:17},(_,j)=>reflector(y,-w+2*w*j/16)));
  }
  wire(Array.from({length:41},(_,k)=>reflector(1.8*Math.sin(k*Math.PI/20),4.8*Math.cos(k*Math.PI/20))));
  strut(search,mats.grey,[-0.2,-1.7,-4.6],[-0.2,1.7,4.6],0.07);g.add(search);g.userData.searchRadar=search;
  for(const z of [cz-6,cz+6])strut(g,mats.black,[cx+9,roof,z],[cx+9,roof+6,z],0.055);
  return g;
}
function buildFittings(mats) {
  const g=new THREE.Group();
  // Ship-side fittings are placed against the shared hull loft, not fixed widths.
  for(const side of [-1,1])for(let x=-149;x<=133;x+=6.8) {
    const p=hullPoint((x+HALF_L)/SHIP.length,0.91,side);
    const z=side*Math.min(Math.abs(p.z)+0.8,deckHalfWidth(x,side)-1);
    const raft=mesh(g,new THREE.CylinderGeometry(0.42,0.42,1.8,10),mats.white,x,SHIP.deckY-2.7,z);raft.rotation.z=Math.PI/2;
    box(g,mats.dark,x,SHIP.deckY-3.25,z,2.3,0.2,1.0);
    for(const dx of [-0.55,0.55])box(g,mats.steel,x+dx,SHIP.deckY-2.72,z,0.08,0.88,0.82);
  }
  for(const side of [-1,1])for(let x=-155;x<153;x+=8) {
    const p=hullPoint((x+HALF_L)/SHIP.length,0.65,side);
    mesh(g,new THREE.CircleGeometry(0.28,10),mats.black,x,p.y,p.z+side*0.06).rotation.y=side>0?0:Math.PI;
  }
  // Anchor pockets, ring, shank and flukes on both sides of the fine bow.
  for(const side of [-1,1]) {
    const p=hullPoint(0.923,0.7,side);
    mesh(g,new THREE.CircleGeometry(1.2,14),mats.black,p.x,p.y,p.z+side*0.08).rotation.y=side>0?0:Math.PI;
    const anchor=new THREE.Group();anchor.position.set(p.x,p.y-1,p.z+side*0.2);anchor.rotation.y=side>0?0:Math.PI;
    strut(anchor,mats.steel,[0,1,0],[0,-2.2,0],0.23);
    strut(anchor,mats.steel,[-1.6,-1.6,0],[1.6,-1.6,0],0.23);
    for(const s of [-1,1]){const f=box(anchor,mats.steel,s*1.45,-1.7,0,0.9,1.1,0.4);f.rotation.z=s*0.55;}
    g.add(anchor);
  }
  // Enterprise fantail is recessed below the round-down, with closed rear bulkhead.
  box(g,mats.grey,-HALF_L-0.7,9.5,0,1.0,1.3,34);
  box(g,mats.dark,-HALF_L-0.75,13.1,0,0.2,5.5,25);
  for(const z of [-13,-6,0,6,13])box(g,mats.grey,-HALF_L-1,13.1,z,0.3,5.8,0.3);
  railing(g,mats,[[-HALF_L-1.1,-17],[-HALF_L-1.1,17]],10.2,2.5);
  for(const side of [-1,1])for(const x of [-148,-80,40,119]) {
    const z=side*(deckHalfWidth(x,side)-1.5);
    box(g,mats.grey,x,SHIP.deckY-2.2,z,7,0.5,4);
    strut(g,mats.grey,[x,SHIP.deckY-2,z],[x,SHIP.deckY+5,z+side*2],0.07);
  }
  // Three Phalanx mounts, two missile mounts on outboard gallery platforms.
  for(const mount of LAYOUT.ciws) {
    const z=mount.side*(deckHalfWidth(mount.x,mount.side)-0.4),y=SHIP.deckY-1.4;
    box(g,mats.grey,mount.x,y-0.5,z,6,0.7,5);
    railing(g,mats,[[mount.x-3,z+mount.side*2.4],[mount.x+3,z+mount.side*2.4]],y-0.1);
  }
  for(const mount of LAYOUT.launchers) {
    const z=mount.side*(deckHalfWidth(mount.x,mount.side)-1.5),y=SHIP.deckY-1.6;
    box(g,mats.grey,mount.x,y,z,6,0.6,5);
    mesh(g,new THREE.CylinderGeometry(0.8,1.1,1.4,12),mats.grey,mount.x,y+1,z);
    const tubes=new THREE.Group();tubes.position.set(mount.x,y+2.4,z);tubes.rotation.x=mount.side*0.45;
    box(tubes,mats.grey,0,0,0,4.4,2,2.5);
    for(let x=-1.5;x<=1.5;x+=1)for(const yy of [-0.5,0.5])box(tubes,mats.black,x,yy,mount.side*1.26,0.8,0.8,0.05);
    g.add(tubes);
  }
  // Port optical landing aid, lights, and fire stations.
  const oz=-deckHalfWidth(-105,-1)+1.8;
  for(const x of [-106.7,-103.3])strut(g,mats.grey,[x,SHIP.deckY-1,oz],[x,SHIP.deckY+2.2,oz],0.13);
  box(g,mats.grey,-105,SHIP.deckY+2.2,oz,4.2,2,1);
  for(let i=-3;i<=3;i++)box(g,mats.yellow,-105+i*0.48,SHIP.deckY+2.4,oz-0.55,0.32,0.32,0.1);
  for(const side of [-1,1])for(let x=-130;x<=130;x+=26)box(g,mats.red,x,SHIP.deckY-1.9,side*(deckHalfWidth(x,side)-0.8),0.65,0.9,0.3);
  return g;
}

export function createCarrier({quality='high'}={}) {
  const group=new THREE.Group();group.name=SHIP.name;
  const mats=shipMaterials();mats.underside=new THREE.MeshStandardMaterial({name:'Sponson underside',color:0x737d82,roughness:0.8,side:THREE.DoubleSide});
  const hull=buildHull(mats.hull,mats.hullPort,quality==='low'?80:160,quality==='low'?18:32);
  group.add(hull,buildDeck(mats));
  const island=buildIsland(mats);group.add(island,buildFittings(mats));
  bakeStatic(island.userData.spin);
  bakeStatic(island.userData.searchRadar);
  const ensign=buildEnsign();group.add(ensign);
  const propulsion=buildPropulsion(SHIP);group.add(propulsion.group);
  const weapons=new WeaponBattery(SHIP.weapons);group.add(weapons.group);
  bakeStatic(group);
  group.userData={vessel:SHIP,loft,propulsion,weapons,mats,island,hull,patches:buildPatches(quality==='low'?18:26,quality==='low'?10:14),spin:island.userData.spin,searchRadar:island.userData.searchRadar,flagAnimate:ensign.userData.animate};
  return group;
}
