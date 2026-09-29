/**
 * ship.js — procedurally built Ford/Nimitz-class aircraft carrier.
 *
 * Everything is generated in code (no external models) so the whole thing is a
 * single self-contained project. Dimensions follow a real CVN:
 *   length 337 m, waterline beam 41 m, draft 12.2 m, flight deck 78 m wide,
 *   flight deck 20 m above the waterline, displacement ~100 000 t.
 *
 * The same station data that builds the hull mesh also generates the
 * hydrostatic patch set used by the physics solver, so the floating body and
 * the visible body are guaranteed to be the same shape.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const SHIP = {
  length: 337,
  beamWater: 41,
  draft: 12.2,
  deckY: 20.0,          // flight deck surface above waterline
  hullTopY: 18.2,
  deckHalfWidth: 39,
  mass: 1.0e8,          // kg  (~100 000 t)
  gyradiusRoll: 20.5,   // m   -> roll period ~11 s
  gyradiusPitch: 88,
  gyradiusYaw: 88,
};

const HALF_L = SHIP.length / 2;

/* station table: t, halfBeam, keelDepth, shapeA, shapeB, flare
 * Real carriers have a long PARALLEL MIDBODY at full beam (not the smooth
 * continuous taper of a yacht), a fine entry at the bow, and only a slight
 * taper to the transom. */
const STATIONS = [
  [0.000, 18.6, 10.8, 3.0, 2.3, 0.00],
  [0.045, 19.8, 11.6, 3.0, 2.4, 0.00],
  [0.120, 20.5, 12.0, 3.0, 2.4, 0.00],
  [0.300, 20.6, 12.2, 3.0, 2.4, 0.00],
  [0.520, 20.6, 12.2, 3.0, 2.4, 0.00],
  [0.660, 20.4, 12.1, 2.9, 2.4, 0.02],
  [0.760, 19.8, 11.9, 2.8, 2.3, 0.05],
  [0.840, 18.4, 11.2, 2.6, 2.2, 0.10],
  [0.900, 16.2, 10.3, 2.4, 2.0, 0.16],
  [0.945, 12.6,  8.9, 2.2, 1.8, 0.22],
  [0.975,  8.2,  7.0, 2.0, 1.6, 0.24],
  [0.993,  4.4,  5.0, 1.8, 1.4, 0.18],
  [1.000,  1.6,  3.6, 1.6, 1.2, 0.06],
];

function lerpStations(t) {
  const S = STATIONS;
  let i = 0;
  while (i < S.length - 2 && t > S[i + 1][0]) i++;
  const a = S[i], b = S[i + 1];
  const f = THREE.MathUtils.clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
  const e = f * f * (3 - 2 * f);           // smoothstep keeps the loft crease-free
  return [
    THREE.MathUtils.lerp(a[1], b[1], e),
    THREE.MathUtils.lerp(a[2], b[2], e),
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
  const top = SHIP.hullTopY;
  const y = -keel + (top + keel) * u;
  // w0 high -> hard bilge then near-vertical sides: a carrier's hull is a
  // wall-sided box with rounded bilges, not a yacht's soft sections
  const w0 = 0.34;
  const shape = w0 + (1 - w0) * Math.pow(1 - Math.pow(1 - u, sa), 1 / sb);
  const halfW = hb * shape * (1 + flare * u * u * u);
  return { y, halfW };
}

function hullPoint(t, u, side, out = new THREE.Vector3()) {
  const { y, halfW } = hullSection(t, u);
  const x = -HALF_L + t * SHIP.length;
  return out.set(x, y, side * halfW);
}

/* ------------------------------------------------------------------ *
 * Textures
 * ------------------------------------------------------------------ */
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
 * catches the sun and breaks up the specular. Without it a 337 m hull reads
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
    // hull texture v = (y + 13) / 32, y in metres relative to the waterline
    const py = (y) => h * (1 - (y + 13) / 32);
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
    g.fillStyle = 'rgba(38,42,46,0.92)';
    g.font = 'bold 78px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('78', 0, 0);
    g.restore();

    // anchor hawse pipe
    g.fillStyle = 'rgba(16,18,20,0.95)';
    g.beginPath();
    g.ellipse(w * 0.79, py(3.2), 14, 20, 0, 0, 7);
    g.fill();

    noiseOverlay(g, w, h, 15);
  });
}

/** Flight deck: non-skid, runway, catapults, elevators, foul lines. */
function makeDeckTexture() {
  const W = 4096, H = 1024;
  const X0 = -HALF_L, LEN = SHIP.length;
  const Z0 = -44, ZW = 84;
  const px = (x) => ((x - X0) / LEN) * W;
  const sz = (m) => (m / ZW) * H;
  const sx = (m) => (m / LEN) * W;

  return canvasTex(W, H, (g, w, h) => {
    // three flips the canvas, so v=0 (z = -44, port) is the BOTTOM row
    const pz = (z) => h * (1 - (z - Z0) / ZW);
    const rect = (x1, x2, z1, z2) => {
      const a = px(x1), b = px(x2), c = pz(z1), d = pz(z2);
      g.fillRect(Math.min(a, b), Math.min(c, d), Math.abs(b - a), Math.abs(d - c));
    };

    // ---- non-skid base -------------------------------------------
    // Fine, low-contrast speckle: the earlier 3 px / 14 % dots aliased into
    // a visible mosaic at grazing angles from the bridge. 2 px dots at
    // lower alpha survive as texture without a pixel-grid read.
    g.fillStyle = '#3a3e43';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 52000; i++) {
      const a = Math.random() * 0.09;
      g.fillStyle = Math.random() < 0.5
        ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // long, faint traffic streaks along the launch direction — breaks the
    // uniformity of the non-skid at large scale without repeating
    for (let i = 0; i < 26; i++) {
      const y = Math.random() * h;
      const grd = g.createLinearGradient(0, y, w, y + (Math.random() - 0.5) * 40);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.5, `rgba(12,12,14,${0.05 + Math.random() * 0.06})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, y - 3 + (Math.random() - 0.5) * 8, w, 5);
    }
    // deck plates
    g.strokeStyle = 'rgba(18,20,23,0.55)';
    g.lineWidth = 1.6;
    for (let x = -168; x <= 169; x += 12) {
      g.beginPath(); g.moveTo(px(x), 0); g.lineTo(px(x), h); g.stroke();
    }
    // scorch / tyre marks
    for (let i = 0; i < 90; i++) {
      const x = px(THREE.MathUtils.randFloat(-150, 150));
      const y = pz(THREE.MathUtils.randFloat(-38, 36));
      const r = Math.random() * 60 + 14;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(10,10,12,0.34)');
      grd.addColorStop(1, 'rgba(10,10,12,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }

    const line = (x1, z1, x2, z2, wm, color, dash = null, alpha = 0.9) => {
      g.save();
      g.globalAlpha = alpha;
      g.strokeStyle = color;
      g.lineWidth = Math.max(2, sz(wm));
      if (dash) g.setLineDash(dash.map((d) => Math.max(3, sz(d))));
      g.beginPath();
      g.moveTo(px(x1), pz(z1));
      g.lineTo(px(x2), pz(z2));
      g.stroke();
      g.restore();
    };

    // ---- landing area (angled deck, ~9 deg to port) ----------------
    const LAND = { x1: -162, z1: -25, x2: 62, z2: -1 };
    const ang = Math.atan2(LAND.z2 - LAND.z1, LAND.x2 - LAND.x1);
    const halfRun = 15.5;
    const nx = -Math.sin(ang) * halfRun, nz = Math.cos(ang) * halfRun;

    g.save();
    g.globalAlpha = 0.42;
    g.fillStyle = '#2c3036';
    g.beginPath();
    g.moveTo(px(LAND.x1 + nx), pz(LAND.z1 + nz));
    g.lineTo(px(LAND.x2 + nx), pz(LAND.z2 + nz));
    g.lineTo(px(LAND.x2 - nx), pz(LAND.z2 - nz));
    g.lineTo(px(LAND.x1 - nx), pz(LAND.z1 - nz));
    g.closePath(); g.fill();
    g.restore();

    // foul lines
    line(LAND.x1 + nx * 1.08, LAND.z1 + nz * 1.08,
         LAND.x2 + nx * 1.08, LAND.z2 + nz * 1.08, 0.6, '#eef3f6', [7, 5], 0.85);
    line(LAND.x1 - nx * 1.08, LAND.z1 - nz * 1.08,
         LAND.x2 - nx * 1.08, LAND.z2 - nz * 1.08, 0.6, '#eef3f6', [7, 5], 0.6);

    // runway centreline
    line(LAND.x1, LAND.z1, LAND.x2, LAND.z2, 0.9, '#f4f8fa', [15, 10], 0.95);

    // threshold bars at the aft end
    g.save();
    g.globalAlpha = 0.92;
    g.strokeStyle = '#f4f8fa';
    g.lineWidth = sz(1.6);
    for (let i = -4; i <= 4; i++) {
      const bx = LAND.x1 + 8 + nx * (i / 4.4);
      const bz = LAND.z1 + 8 + nz * (i / 4.4);
      g.beginPath();
      g.moveTo(px(bx), pz(bz));
      g.lineTo(px(bx + 9), pz(bz + 9 * Math.tan(ang)));
      g.stroke();
    }
    g.restore();

    // ---- catapult tracks -----------------------------------------
    const cat = (x1, z1, x2, z2) => {
      line(x1, z1, x2, z2, 1.1, '#c6cace', null, 0.6);
      line(x1, z1 + 1.0, x2, z2 + 1.0, 1.3, '#17191c', null, 0.95);
      line(x1, z1 - 1.0, x2, z2 - 1.0, 1.3, '#17191c', null, 0.95);
      // jet blast deflector
      g.save();
      g.globalAlpha = 0.8;
      g.fillStyle = '#575d63';
      rect(x1 - 10, x1 - 3, z1 - 7, z1 + 7);
      g.restore();
    };
    cat(96, -7.5, 166, -3.5);
    cat(96, 7.5, 166, 3.5);
    cat(-26, -16, 46, -10);
    cat(-26, -28, 46, -22);

    // ---- elevators: Ford layout — two starboard (fwd + aft of the
    // island), one port. (The old Nimitz-style middle starboard one is gone.)
    const elev = (x1, x2, z1, z2) => {
      g.save();
      g.globalAlpha = 0.92;
      g.fillStyle = '#454a50';
      rect(x1, x2, z1, z2);
      g.globalAlpha = 1;
      g.strokeStyle = '#f0c400';
      g.lineWidth = Math.max(2, sz(0.8));
      const a = px(x1), b = px(x2), c = pz(z1), d = pz(z2);
      g.strokeRect(Math.min(a, b), Math.min(c, d), Math.abs(b - a), Math.abs(d - c));
      g.restore();
    };
    elev(0, 20, 16, 30);
    elev(-110, -90, 16, 30);
    elev(-62, -42, -38, -26);

    // ---- island footprint ----------------------------------------
    g.save();
    g.globalAlpha = 0.55;
    g.fillStyle = '#20232a';
    rect(29, 67, 19, 31);
    g.restore();

    // ---- parking spots -------------------------------------------
    g.strokeStyle = 'rgba(238,240,242,0.34)';
    g.lineWidth = Math.max(2, sz(0.4));
    const spots = [
      [96, 24], [96, 26], [80, 20], [80, 26],
      [-50, 28], [-72, 28], [-94, 28],
      [-52, 15], [-74, 15],
      [42, -33], [20, -31],
      [-118, 26], [-140, 26], [-142, 13],
    ];
    for (const [x, z] of spots) {
      const a = px(x - 9), b = px(x + 9), c = pz(z - 6), d = pz(z + 6);
      g.strokeRect(Math.min(a, b), Math.min(c, d), Math.abs(b - a), Math.abs(d - c));
    }

    // ---- deck edge line ------------------------------------------
    g.save();
    g.globalAlpha = 0.5;
    g.strokeStyle = '#eef3f6';
    g.lineWidth = Math.max(2, sz(0.55));
    g.setLineDash([sz(3.4), sz(2.4)]);
    g.strokeRect(sx(4), sz(4), w - sx(8), h - sz(8));
    g.restore();

    // ---- deck number ---------------------------------------------
    g.save();
    g.fillStyle = 'rgba(238,242,246,0.6)';
    g.font = `bold ${sz(12)}px "Helvetica Neue", Arial, sans-serif`;
    g.textAlign = 'center';
    g.fillText('78', px(132), pz(25));
    g.restore();
  }, { aniso: 16 });
}

/** Safety-net grid texture (alpha-only pattern on colour). */
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

function makeIslandTexture() {
  return canvasTex(1024, 512, (g, w, h) => {    // v=0 is the bottom of the face -> canvas bottom row
    const py = (v) => h * (1 - v);
    g.fillStyle = '#828990';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * w;
      g.strokeStyle = `rgba(58,64,70,${Math.random() * 0.11})`;
      g.lineWidth = Math.random() * 3 + 0.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, Math.random() * h); g.stroke();
    }
    // bridge window band high on the face
    g.fillStyle = '#101418';
    g.fillRect(w * 0.05, py(0.80), w * 0.90, py(0.68) - py(0.80));
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(44,68,92,${0.35 + Math.random() * 0.55})`;
      g.fillRect(w * (0.062 + i * 0.0342), py(0.785), w * 0.022, py(0.70) - py(0.785));
    }
    // panel lines
    g.strokeStyle = 'rgba(58,64,70,0.5)';
    g.lineWidth = 1.4;
    for (let i = 1; i < 12; i++) {
      const y = (i / 12) * h;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    for (let i = 1; i < 20; i++) {
      const x = (i / 20) * w;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    // hull number on the island side
    g.save();
    g.translate(w * 0.5, py(0.42));
    g.fillStyle = 'rgba(42,47,53,0.96)';
    g.font = 'bold 132px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('78', 0, 0);
    g.restore();
    noiseOverlay(g, w, h, 13);
  }, { aniso: 8 });
}

/* ------------------------------------------------------------------ *
 * Materials
 * ------------------------------------------------------------------ */
function shipMaterials() {
  const hullTex = makeHullTexture(false);
  hullTex.wrapS = THREE.RepeatWrapping;
  const hullTexPort = makeHullTexture(true);
  hullTexPort.wrapS = THREE.RepeatWrapping;
  const deckTex = makeDeckTexture();
  const islandTex = makeIslandTexture();

  // Procedural normal maps. Repeat counts are matched to real feature sizes:
  // hull plating ~1.2 m, deck non-skid ~0.5 m, island panels ~0.8 m.
  // The deck normal map is 1024² at a 6 m tile: the old 512² / 8.4 m tile
  // repeated visibly from the bridge — the "mosaic deck" complaint.
  const hullNrm = makeNormalTexture(512, 2.0, 14, 1);
  hullNrm.repeat.set(26, 3);
  const deckNrm = makeNormalTexture(1024, 2.6, 26, 2);
  deckNrm.repeat.set(56, 14);
  const islandNrm = makeNormalTexture(512, 1.8, 16, 3);
  islandNrm.repeat.set(6, 3);
  const steelNrm = makeNormalTexture(256, 1.4, 20, 4);
  steelNrm.repeat.set(4, 4);

  const std = (o) => {
    const m = new THREE.MeshStandardMaterial(o);
    // Haze Grey warship paint is a SEMI-GLOSS: flat-lit plastic was a big
    // part of the "fake" look. envMapIntensity picks up the sky so hull
    // sides and panel faces carry moving reflections at grazing angles.
    m.envMapIntensity = o.envInt ?? 1.0;
    return m;
  };

  return {
    hull: std({
      map: hullTex, normalMap: hullNrm, normalScale: new THREE.Vector2(0.55, 0.55),
      color: 0xffffff, roughness: 0.60, metalness: 0.32, envInt: 1.25,
      side: THREE.DoubleSide,
    }),
    hullPort: std({
      map: hullTexPort, normalMap: hullNrm, normalScale: new THREE.Vector2(0.55, 0.55),
      color: 0xffffff, roughness: 0.60, metalness: 0.32, envInt: 1.25,
      side: THREE.DoubleSide,
    }),
    deckTop: std({
      map: deckTex, normalMap: deckNrm, normalScale: new THREE.Vector2(0.75, 0.75),
      color: 0xffffff, roughness: 0.90, metalness: 0.14, envInt: 0.45,
      // DoubleSide: from deck-level rigs the lens rides 1-2 m above the
      // plane, and a few degrees of pitch puts the deck AHEAD below the
      // sightline — a FrontSide top would backface-cull there and the view
      // would see straight through the ship to the shadowed sea: a huge
      // near-black flash. Seen from below, the deck must still be a deck.
      side: THREE.DoubleSide,
    }),
    deckSide: std({
      normalMap: steelNrm, normalScale: new THREE.Vector2(0.4, 0.4),
      color: 0x6f767d, roughness: 0.58, metalness: 0.34, envInt: 1.0,
    }),
    island: std({
      map: islandTex, normalMap: islandNrm, normalScale: new THREE.Vector2(0.5, 0.5),
      color: 0xffffff, roughness: 0.60, metalness: 0.30, envInt: 1.15,
    }),
    grey: std({
      normalMap: steelNrm, normalScale: new THREE.Vector2(0.35, 0.35),
      color: 0x7d848b, roughness: 0.56, metalness: 0.38, envInt: 1.05,
    }),
    greyDark: std({
      normalMap: steelNrm, normalScale: new THREE.Vector2(0.35, 0.35),
      color: 0x4a5057, roughness: 0.52, metalness: 0.44, envInt: 1.05,
    }),
    black: std({ color: 0x1c1f22, roughness: 0.48, metalness: 0.4, envInt: 0.9 }),
    white: std({ color: 0xd9dde0, roughness: 0.44, metalness: 0.1, envInt: 1.1 }),
    glass: std({
      color: 0x1a2a38, roughness: 0.08, metalness: 0.9,
      transparent: true, opacity: 0.55, envInt: 1.6,
    }),
    jet: std({ color: 0x8a949c, roughness: 0.52, metalness: 0.42 }),
    jetDark: std({ color: 0x555c64, roughness: 0.55, metalness: 0.45 }),
    canopy: std({
      color: 0x18242e, roughness: 0.06, metalness: 0.85,
      transparent: true, opacity: 0.6,
    }),
    yellow: std({ color: 0xd9a800, roughness: 0.6, metalness: 0.25 }),
    orange: std({ color: 0xe2661a, roughness: 0.75, metalness: 0.05 }),
    steel: std({ color: 0x555b61, roughness: 0.42, metalness: 0.72, envInt: 1.2 }),
    bronze: std({ color: 0x8a6a3a, roughness: 0.4, metalness: 0.8 }),
  };
}

/* ------------------------------------------------------------------ *
 * Hull
 * ------------------------------------------------------------------ */
function buildHull(matStar, matPort, stations = 96, ring = 22) {
  const yToV = (y) => (y + 13) / 32;
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
  return group;
}

/** Flat transom closing the stern. */
function buildTransom(mat) {
  const shape = new THREE.Shape();
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const p = hullPoint(0.001, u, 1);
    pts.push([p.y, p.z]);
  }
  for (let i = 24; i >= 0; i--) {
    const u = i / 24;
    const p = hullPoint(0.001, u, -1);
    pts.push([p.y, p.z]);
  }
  shape.moveTo(pts[0][1], pts[0][0]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][1], pts[i][0]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(-HALF_L - 1.2, 0, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Bulbous bow. */
function buildBulb(mat) {
  const g = new THREE.SphereGeometry(1, 24, 16);
  g.scale(15, 5.0, 4.2);
  g.translate(HALF_L - 8, -6.6, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

/* ------------------------------------------------------------------ *
 * Flight deck
 * ------------------------------------------------------------------ */
/* Flight-deck outline, bow-first. This is the PLAN FORM, and it is what
 * makes a carrier a carrier:
 *   • the bow is a sharp wedge meeting near the centreline
 *   • the STARBOARD edge runs almost straight (catapult side) ~30-33 m off
 *     the centreline, with the elevators cut into it
 *   • the PORT side carries the angled landing deck: its diagonal edge is
 *     the widest part of the ship (~-42..-44) from midship aft, tapering
 *     forward to the bow — that asymmetric bulge is the single strongest
 *     "this is a carrier" silhouette from above
 *   • the stern is a broad transom with slightly angled corners
 * (First 15 entries are the starboard side, bow -> stern; the rest run the
 * port side stern -> bow — deckHalfWidth() and the net strips rely on it.) */
const DECK_OUTLINE = [
  // starboard: blunt bow face -> straight catapult-side edge -> stern
  [172.5, 0], [171.5, 6], [169, 11], [164.5, 15.5], [157, 19.5], [145, 23.5],
  [125, 27.5], [100, 30], [70, 31.5], [30, 32.5], [-30, 32.5], [-90, 32.5],
  [-130, 33.5], [-155, 35], [-168, 36],
  // port: transom corner -> angled-deck bulge -> diagonal to the bow face
  [-168, -43], [-152, -43.5], [-118, -43.5], [-80, -43], [-40, -42],
  [0, -40.5], [40, -38], [80, -35], [112, -30], [132, -25], [146, -19.5],
  [157, -14], [164.5, -9], [169, -4.5], [171.5, -6],
];

function deckShape() {
  const s = new THREE.Shape();
  DECK_OUTLINE.forEach(([x, z], i) => {
    if (i === 0) s.moveTo(x, z); else s.lineTo(x, z);
  });
  s.closePath();
  return s;
}

/** Flight-deck half width at longitudinal position x, for the given side
 *  (+1 starboard / -1 port), by walking the outline polylines. Used to place
 *  gallery struts, safety nets, deck-edge fittings — and by the spray emitter
 *  so water is born OUTBOARD of the deck instead of clipping through it. */
export function deckHalfWidth(x, side) {
  const pts = side > 0 ? DECK_OUTLINE.slice(0, 15) : DECK_OUTLINE.slice(14);
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
    if ((x1 >= x && x >= x2) || (x2 >= x && x >= x1)) {
      const f = (x - x1) / ((x2 - x1) || 1);
      return Math.abs(z1 + (z2 - z1) * f);
    }
  }
  return 0;
}

/** The gallery band + diagonal struts under the flight-deck overhang. On a
 *  real carrier the 78 m deck hangs 8-12 m beyond the 41 m hull on both
 *  sides, carried on sponsons. The band is a VERTICAL outer wall following
 *  the full deck outline (from the deck slab's underside down ~2.6 m): an
 *  earlier version used a plate shrunk inboard from the outline, which left
 *  a see-through slot between it and the deck edge over the whole length —
 *  the "one side is missing" hole. A wall flush with the deck edge cannot
 *  open a gap. */
function buildGallery(mats) {
  const g = new THREE.Group();

  // vertical closing wall flush with the deck edge. 7 m tall: it runs from
  // the deck slab down past the hull's top edge, so a beam view sees hull
  // + wall with NO see-through under the overhang (the old 2.6 m band left
  // the 23 m port overhang open scaffolding from low angles).
  const shape = deckShape();
  const wallGeo = new THREE.ExtrudeGeometry(shape, { depth: 7.0, bevelEnabled: false });
  wallGeo.rotateX(Math.PI / 2);
  wallGeo.translate(0, SHIP.deckY - 1.86, 0);
  const wall = new THREE.Mesh(wallGeo, mats.deckSide);
  wall.castShadow = true; wall.receiveShadow = true;
  g.add(wall);

  // diagonal struts from the hull side up to the gallery band
  for (const side of [1, -1]) {
    for (let x = -150; x <= 150; x += 15) {
      const t = (x + HALF_L) / SHIP.length;
      if (t < 0.05 || t > 0.90) continue;
      const [, keel] = lerpStations(t);
      const u = THREE.MathUtils.clamp((11 + keel) / (SHIP.hullTopY + keel), 0, 1);
      const { halfW } = hullSection(t, u);
      const z0 = side * (halfW + 0.6), y0 = 11;
      const z1 = side * (deckHalfWidth(x, side) - 0.4), y1 = SHIP.deckY - 6.6;
      const dz = z1 - z0, dy = y1 - y0;
      const L = Math.hypot(dz, dy);
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.0, L, 0.9), mats.greyDark);
      m.position.set(x, (y0 + y1) / 2, (z0 + z1) / 2);
      m.rotation.x = -Math.atan2(dz, dy);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
  }

  // Enclosing diaphragm: continuous sloped plating from the hull's top
  // edge out to the gallery band. Without it the overhang zone — 23 m wide
  // under the angled deck on the port side — is open scaffolding, and a
  // beam view sees straight through to the sea: "one side was never built".
  {
    const skirtMat = mats.deckSide.clone();
    skirtMat.side = THREE.DoubleSide;
    for (const side of [1, -1]) {
      const outline = side > 0 ? DECK_OUTLINE.slice(0, 14) : DECK_OUTLINE.slice(13);
      const A = [], B = [];
      const yHull = 17.4, yBand = SHIP.deckY - 6.6;
      for (let i = 0; i < outline.length; i++) {
        const [x, z] = outline[i];
        const t = THREE.MathUtils.clamp((x + HALF_L) / SHIP.length, 0, 1);
        const { halfW } = hullSection(t, 1);
        const dw = Math.abs(z);
        A.push(x, yHull, side * halfW);          // on the hull's top edge
        B.push(x, yBand, side * dw);             // under the gallery band
      }
      const verts = [];
      const idx = [];
      for (let i = 0; i < outline.length; i++) {
        verts.push(A[i * 3], A[i * 3 + 1], A[i * 3 + 2]);
        verts.push(B[i * 3], B[i * 3 + 1], B[i * 3 + 2]);
      }
      for (let i = 0; i < outline.length - 1; i++) {
        const a0 = i * 2, b0 = i * 2 + 1, a1 = a0 + 2, b1 = b0 + 2;
        idx.push(a0, b0, a1, b1, a1, b0);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const skirt = new THREE.Mesh(geo, skirtMat);
      skirt.castShadow = true; skirt.receiveShadow = true;
      g.add(skirt);
    }
  }

  // sponson pods along the gallery band — weapon mounts, boat davit bases
  for (const side of [1, -1]) {
    for (const x of [-128, -84, -36, 16, 66, 112]) {
      const z = side * (deckHalfWidth(x, side) - 1.6);
      const m = new THREE.Mesh(new THREE.BoxGeometry(8, 1.5, 3.2), mats.grey);
      m.position.set(x, SHIP.deckY - 2.2, z);
      m.castShadow = true;
      g.add(m);
    }
  }
  return g;
}

function buildDeck(mats) {
  const group = new THREE.Group();
  const shape = deckShape();

  // top surface with UVs derived from world x/z
  const topGeo = new THREE.ShapeGeometry(shape, 24);
  {
    const pos = topGeo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) + HALF_L) / SHIP.length;
      uv[i * 2 + 1] = (pos.getY(i) + 44) / 84;
    }
    topGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  topGeo.rotateX(Math.PI / 2);
  topGeo.translate(0, SHIP.deckY, 0);
  // ShapeGeometry winds CCW in its XY plane, so after rotateX(+90 deg) the
  // face normal points -Y: the marking surface would be backface-culled when
  // seen from above and you would just see the plain slab through it.
  // Reverse the winding and rebuild the normals so the deck faces up.
  {
    const idx = topGeo.getIndex();
    const a = idx.array;
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t;
    }
    idx.needsUpdate = true;
    topGeo.computeVertexNormals();
  }
  const top = new THREE.Mesh(topGeo, mats.deckTop);
  top.receiveShadow = true;
  group.add(top);

  // slab thickness + underside. Its top cap is dropped 6 cm below the marking
  // surface: coplanar caps z-fight and the plain slab wins, which silently
  // erases every runway marking.
  const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: 1.8, bevelEnabled: false });
  slabGeo.rotateX(Math.PI / 2);
  slabGeo.translate(0, SHIP.deckY - 0.06, 0);
  const slab = new THREE.Mesh(slabGeo, mats.deckSide);
  slab.castShadow = true; slab.receiveShadow = true;
  group.add(slab);

  // gallery deck + struts under the overhang (replaces the old single
  // support box, which read as a rectangular barge under the deck)
  group.add(buildGallery(mats));

  // jet blast deflectors, raised, behind catapults 1 & 2
  for (const zOff of [-7.5, 7.5]) {
    const jbd = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 10), mats.greyDark);
    jbd.position.set(88, SHIP.deckY + 3.1, zOff);
    jbd.rotation.set(-Math.PI / 3.1, 0, 0);
    jbd.castShadow = true;
    group.add(jbd);
  }

  // deck-edge safety nets: a grid texture on hanging strips, following the
  // real outline (the old fixed stanchion row floated off the deck edge)
  const netTex = makeNetTexture();
  for (const side of [1, -1]) {
    const pts = side > 0 ? DECK_OUTLINE.slice(0, 15) : DECK_OUTLINE.slice(14);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 4) continue;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(len, 1.6),
        new THREE.MeshStandardMaterial({
          map: netTex, transparent: true, side: THREE.DoubleSide,
          color: 0x39424b, roughness: 0.9, metalness: 0.1, depthWrite: false,
        }));
      m.position.set((x1 + x2) / 2, SHIP.deckY - 0.95, (z1 + z2) / 2 - side * 0.9);
      m.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
      m.rotation.x = -Math.PI / 2;
      group.add(m);
    }
  }

  // deck edge catwalk
  const catwalk = new THREE.Group();
  const mkEdge = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, 1.3), mats.greyDark);
      b.position.set((x1 + x2) / 2, SHIP.deckY - 0.55, (z1 + z2) / 2);
      b.rotation.y = -Math.atan2(dz, dx);
      catwalk.add(b);
    }
  };
  mkEdge(DECK_OUTLINE.slice(0, 15));
  mkEdge(DECK_OUTLINE.slice(15).concat([DECK_OUTLINE[0]]));
  catwalk.traverse((o) => { o.castShadow = true; });
  group.add(catwalk);

  return group;
}

/* ------------------------------------------------------------------ *
 * Island (superstructure) — Ford-class style
 *
 * Footprint x 31..65, z 26..36 (compact, ~2/3 aft of the bow like the
 * real thing). Stepped tower, flat phased-array panels, an OPEN nav-bridge
 * house (floor / roof / side+rear walls, window band + mullions at the
 * front) so the bridge camera actually sees over the bow, bridge wings,
 * one box mast with two yardarms, and the rotating EASR panel on top.
 * ------------------------------------------------------------------ */
function buildIsland(mats) {
  const g = new THREE.Group();
  const Y0 = SHIP.deckY;
  const CX = 48, CZ = 25;
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // base gallery + life-raft canister rows
  add(new THREE.BoxGeometry(36, 1.6, 12), mats.greyDark, CX, Y0 + 0.8, CZ);
  const raftGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.9, 10);
  for (let x = 33.5; x <= 62.5; x += 3.6) {
    for (const dz of [-5.5, 5.5]) {
      add(raftGeo, mats.white, x, Y0 + 1.95, CZ + dz, 0, Math.PI / 2);
    }
  }

  // main tower (stepped, slab-sided)
  add(new THREE.BoxGeometry(30, 11, 9), mats.island, CX, Y0 + 7.1, CZ);
  // flat phased-array sensor panels on both faces, slightly canted
  for (const [px, py] of [[42, Y0 + 7], [54, Y0 + 7]]) {
    add(new THREE.BoxGeometry(7, 7, 0.4), mats.greyDark, px, py, CZ + 4.55, 0.05);
    add(new THREE.BoxGeometry(7, 7, 0.4), mats.greyDark, px, py, CZ - 4.55, -0.05);
  }

  // flag bridge with window band
  add(new THREE.BoxGeometry(26, 3.6, 8.4), mats.island, CX, Y0 + 14.4, CZ);
  add(new THREE.BoxGeometry(24, 1.4, 8.8), mats.glass, CX, Y0 + 14.9, CZ);

  // ---- nav bridge house: OPEN front, so the bridge view sees the bow ----
  add(new THREE.BoxGeometry(22, 0.5, 10), mats.island, CX, Y0 + 16.45, CZ);   // floor
  add(new THREE.BoxGeometry(23, 0.6, 10.6), mats.island, CX, Y0 + 20.7, CZ);  // roof
  add(new THREE.BoxGeometry(21.4, 3.4, 0.5), mats.island, CX, Y0 + 18.3, CZ + 4.85); // walls
  add(new THREE.BoxGeometry(21.4, 3.4, 0.5), mats.island, CX, Y0 + 18.3, CZ - 4.85);
  add(new THREE.BoxGeometry(0.5, 3.4, 10), mats.island, CX - 10.9, Y0 + 18.3, CZ);   // rear
  add(new THREE.BoxGeometry(0.5, 1.2, 22), mats.island, CX + 10.9, Y0 + 17.3, CZ);   // sill
  add(new THREE.BoxGeometry(0.5, 1.2, 22), mats.island, CX + 10.9, Y0 + 19.8, CZ);   // header
  add(new THREE.BoxGeometry(0.14, 2.0, 21.4), mats.glass, CX + 10.9, Y0 + 18.65, CZ);
  for (const mz of [CZ - 3, CZ + 3]) {                                          // mullions
    add(new THREE.BoxGeometry(0.3, 2.0, 0.3), mats.greyDark, CX + 10.9, Y0 + 18.65, mz);
  }

  // bridge wings: grated platforms out beyond the house walls
  for (const dz of [-6.6, 6.6]) {
    add(new THREE.BoxGeometry(9, 0.35, 3.2), mats.grey, CX, Y0 + 16.7, CZ + dz);
    for (const rx of [-4, 0, 4]) {
      add(new THREE.CylinderGeometry(0.05, 0.05, 1.05, 5), mats.greyDark,
        CX + rx, Y0 + 17.4, CZ + dz + (dz > 0 ? 1.4 : -1.4));
    }
    add(new THREE.BoxGeometry(9, 0.08, 0.08), mats.greyDark,
      CX, Y0 + 17.9, CZ + dz + (dz > 0 ? 1.4 : -1.4));
  }

  // exterior walkways with railings at the flag-bridge and nav-bridge
  // levels — crews stand on these; a blank-walled tower reads as a mausoleum
  const walkway = (y, w, d) => {
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), mats.grey);
    ledge.position.set(CX, y, CZ);
    ledge.castShadow = true; ledge.receiveShadow = true;
    g.add(ledge);
    const hw = w / 2 - 0.2, hd = d / 2 - 0.2;
    const post = [];
    for (let px = -hw; px <= hw; px += 2.6) {
      post.push([CX + px, y + 0.55, CZ + hd], [CX + px, y + 0.55, CZ - hd]);
    }
    for (let pz = -hd + 2.6; pz <= hd - 2.6; pz += 2.6) {
      post.push([CX - hw, y + 0.55, CZ + pz], [CX + hw, y + 0.55, CZ + pz]);
    }
    for (const [px, py, pz] of post) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.0, 5), mats.greyDark);
      p.position.set(px, py, pz);
      g.add(p);
    }
    const railW = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.06), mats.greyDark);
    railW.position.set(CX, y + 1.05, CZ + hd);
    g.add(railW);
    const railW2 = railW.clone(); railW2.position.z = CZ - hd; g.add(railW2);
    const railS = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, d), mats.greyDark);
    railS.position.set(CX - hw, y + 1.05, CZ);
    g.add(railS);
    const railS2 = railS.clone(); railS2.position.x = CX + hw; g.add(railS2);
  };
  walkway(Y0 + 16.85, 28, 10.6);    // flag-bridge gallery
  walkway(Y0 + 21.0, 24.5, 11.2);   // nav-bridge gallery

  // PriFly / air-traffic house above
  add(new THREE.BoxGeometry(16, 2.8, 8), mats.island, CX + 2, Y0 + 22.4, CZ);
  add(new THREE.BoxGeometry(14, 1.1, 8.4), mats.glass, CX + 2, Y0 + 22.6, CZ);

  // box mast: column, two yardarms, dome, whips
  add(new THREE.BoxGeometry(1.8, 10, 1.4), mats.grey, CX, Y0 + 28.6, CZ);
  add(new THREE.BoxGeometry(7, 0.25, 0.25), mats.greyDark, CX, Y0 + 26.6, CZ);
  add(new THREE.BoxGeometry(5, 0.25, 0.25), mats.greyDark, CX, Y0 + 29.4, CZ);
  add(new THREE.SphereGeometry(1.4, 12, 10), mats.white, CX, Y0 + 34.4, CZ);
  for (const wx of [-0.6, 0.6]) {
    add(new THREE.CylinderGeometry(0.05, 0.08, 6, 5), mats.greyDark,
      CX + wx, Y0 + 37, CZ, wx * 0.06);
  }
  // guy-wire stays from the masthead down to the roof — a stayed mast is
  // structural honesty you can see
  {
    const top = new THREE.Vector3(CX, Y0 + 33.6, CZ);
    const anchor = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const stay = (ax, ay, az) => {
      anchor.set(ax, ay, az);
      dir.copy(anchor).sub(top);
      const L = dir.length();
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, L, 5), mats.greyDark);
      s.position.copy(top).addScaledVector(dir, 0.5);
      s.quaternion.setFromUnitVectors(up, dir.normalize());
      g.add(s);
    };
    stay(CX - 8, Y0 + 21.2, CZ - 4);
    stay(CX + 8, Y0 + 21.2, CZ - 4);
    stay(CX, Y0 + 21.2, CZ + 4.4);
  }

  // rotating EASR panel (the only moving part — kept out of the static bake)
  const spin = new THREE.Group();
  add(new THREE.CylinderGeometry(0.4, 0.55, 1.2, 10), mats.greyDark, CX - 4, Y0 + 24.3, CZ);
  const dish = new THREE.Mesh(new THREE.BoxGeometry(5.5, 3.2, 0.4), mats.greyDark);
  spin.add(dish);
  spin.position.set(CX - 4, Y0 + 26, CZ);
  spin.userData.dynamic = true;   // rotates every frame; keep out of the bake
  g.add(spin);
  g.userData.spin = spin;

  return g;
}

/* ------------------------------------------------------------------ *
 * Air wing
 * ------------------------------------------------------------------ */
/**
 * F/A-18E/F Super Hornet, built up from lofted sections rather than stacked
 * primitives so the silhouette actually reads as a Hornet: the wide LEX
 * strakes, the rectangular box intakes under the wing roots, the canted twin
 * tails and the slab-sided fuselage are what make it recognisable at the
 * scale it is drawn (a 18 m aircraft on a 337 m deck).
 */
function buildHornet(mats) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };

  // ---- fuselage: lofted from station radii so it tapers properly ------
  // (a single cylinder reads as a flying pencil; the Hornet has a deep,
  //  slab-sided forward body and a fat engine bay aft)
  const fuseStations = [
    // [z, halfWidth, halfHeight, yCentre]
    [-7.4, 0.62, 0.60, 1.85],
    [-6.2, 0.78, 0.74, 1.85],
    [-4.0, 0.86, 0.82, 1.88],
    [-1.5, 0.92, 0.86, 1.90],
    [ 1.0, 0.90, 0.84, 1.92],
    [ 3.0, 0.80, 0.76, 1.92],
    [ 5.0, 0.62, 0.60, 1.90],
    [ 6.6, 0.42, 0.42, 1.88],
    [ 8.2, 0.20, 0.20, 1.86],
  ];
  {
    const verts = [], uvs = [], idx = [];
    const RING = 12;
    for (let s = 0; s < fuseStations.length; s++) {
      const [z, hw, hh, yc] = fuseStations[s];
      for (let i = 0; i <= RING; i++) {
        const a = (i / RING) * Math.PI * 2;
        // super-ellipse: squarer than a circle, like the real slab body
        const ca = Math.cos(a), sa = Math.sin(a);
        const p = 2.6;
        const x = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / p) * hw;
        const y = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / p) * hh;
        verts.push(x, yc + y, z);
        uvs.push(i / RING, s / (fuseStations.length - 1));
      }
    }
    const stride = RING + 1;
    for (let s = 0; s < fuseStations.length - 1; s++) {
      for (let i = 0; i < RING; i++) {
        const a = s * stride + i, b = a + 1, c = a + stride, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    fg.setIndex(idx);
    fg.computeVertexNormals();
    const fuse = new THREE.Mesh(fg, mats.jet);
    fuse.castShadow = true;
    g.add(fuse);
  }

  // ---- radome / nose cone -------------------------------------------
  const nose = add(new THREE.ConeGeometry(0.42, 2.4, 12), mats.jetDark, 0, 1.86, 8.9);
  nose.rotation.set(Math.PI / 2, 0, 0);

  // ---- canopy: teardrop, faired into the spine -----------------------
  const can = add(new THREE.SphereGeometry(0.72, 14, 10), mats.canopy, 0, 2.62, 2.7);
  can.scale.set(1.0, 0.68, 2.3);
  // windscreen frame
  add(new THREE.BoxGeometry(0.9, 0.10, 1.2), mats.jetDark, 0, 2.28, 4.4);

  // ---- LEX (leading-edge extensions) — the Hornet's signature --------
  for (const s of [1, -1]) {
    const lex = new THREE.Shape();
    lex.moveTo(0, 0);
    lex.lineTo(2.9, -1.5);       // outboard
    lex.lineTo(3.1, 0.5);        // trailing edge
    lex.lineTo(0, 1.6);          // back to the fuselage
    lex.closePath();
    const lg = new THREE.ExtrudeGeometry(lex, { depth: 0.16, bevelEnabled: false });
    lg.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(lg, mats.jet);
    m.position.set(s * 0.75, 1.62, 0.4);
    if (s < 0) m.scale.z = -1;
    m.castShadow = true;
    g.add(m);
  }

  // ---- box intakes under the wing roots -----------------------------
  for (const s of [1, -1]) {
    add(new THREE.BoxGeometry(0.30, 0.62, 1.5), mats.jetDark, s * 0.95, 1.55, 1.6);
    // intake lip shadow
    add(new THREE.BoxGeometry(0.12, 0.52, 0.16), mats.black, s * 1.12, 1.55, 2.35);
  }

  // ---- main wing: swept, with true trailing-edge kink ---------------
  const wing = new THREE.Shape();
  wing.moveTo(0, 0.0);
  wing.lineTo(2.2, -0.6);        // inboard leading edge, swept back
  wing.lineTo(6.4, -2.5);        // leading edge sweep to the tip
  wing.lineTo(6.5, -1.75);       // tip chord
  wing.lineTo(2.6, 1.15);        // trailing edge kink (flap / aileron break)
  wing.lineTo(0, 1.45);          // root trailing edge
  wing.closePath();
  const wg = new THREE.ExtrudeGeometry(wing, { depth: 0.22, bevelEnabled: false });
  wg.rotateX(Math.PI / 2);
  for (const s of [1, -1]) {
    const w = new THREE.Mesh(wg, mats.jet);
    w.position.set(s * 0.9, 1.72, -0.9);
    if (s < 0) w.scale.x = -1;
    w.castShadow = true;
    g.add(w);
    // wingtip missile rail (AIM-9)
    add(new THREE.CylinderGeometry(0.09, 0.09, 1.5, 8), mats.white,
        s * 7.0, 1.80, -2.1).rotation.set(Math.PI / 2, 0, 0);
    add(new THREE.CylinderGeometry(0.13, 0.13, 0.5, 8), mats.greyDark,
        s * 7.0, 1.80, -2.9).rotation.set(Math.PI / 2, 0, 0);
  }

  // ---- canted twin tails -------------------------------------------
  for (const s of [1, -1]) {
    const t = add(new THREE.BoxGeometry(0.20, 3.3, 2.1), mats.jet, s * 1.35, 3.25, -4.6);
    t.rotation.z = -s * 0.36;      // the real cant is ~20 deg outboard
    t.rotation.x = 0.06;
  }

  // ---- all-moving stabilators --------------------------------------
  for (const s of [1, -1]) {
    const st = new THREE.Shape();
    st.moveTo(0, 0); st.lineTo(3.3, -1.1);
    st.lineTo(3.4, -0.45); st.lineTo(0, 1.0);
    st.closePath();
    const sg = new THREE.ExtrudeGeometry(st, { depth: 0.16, bevelEnabled: false });
    sg.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(sg, mats.jet);
    m.position.set(s * 0.85, 1.95, -6.0);
    if (s < 0) m.scale.x = -1;
    m.castShadow = true;
    g.add(m);
  }

  // ---- engine bay + nozzles ----------------------------------------
  add(new THREE.BoxGeometry(1.9, 1.25, 1.3), mats.jetDark, 0, 1.85, -6.9);
  for (const s of [1, -1]) {
    add(new THREE.CylinderGeometry(0.52, 0.60, 0.9, 12), mats.jetDark, s * 0.95, 1.85, -7.6)
      .rotation.set(Math.PI / 2, 0, 0);
    add(new THREE.CylinderGeometry(0.44, 0.52, 0.35, 12), mats.black, s * 0.95, 1.85, -8.1)
      .rotation.set(Math.PI / 2, 0, 0);
  }

  // ---- fuselage spine / arrestor hook -------------------------------
  add(new THREE.BoxGeometry(0.34, 0.30, 3.4), mats.jet, 0, 2.62, -1.2);
  add(new THREE.BoxGeometry(0.10, 0.7, 0.10), mats.steel, 0, 1.5, -7.2)
    .rotation.x = 0.5;

  // ---- drop tanks on the inboard pylons ----------------------------
  for (const s of [1, -1]) {
    add(new THREE.CylinderGeometry(0.40, 0.40, 3.4, 10), mats.jetDark, s * 2.6, 1.15, -0.6)
      .rotation.set(Math.PI / 2, 0, 0);
    add(new THREE.ConeGeometry(0.40, 0.7, 10), mats.jetDark, s * 2.6, 1.15, 1.4)
      .rotation.set(Math.PI / 2, 0, 0);
    // pylon
    add(new THREE.BoxGeometry(0.16, 0.5, 0.9), mats.jetDark, s * 2.6, 1.45, -0.6);
  }

  // ---- landing gear -------------------------------------------------
  for (const [x, z, r] of [[0, 5.6, 0.13], [1.5, -1.0, 0.11], [-1.5, -1.0, 0.11]]) {
    add(new THREE.CylinderGeometry(r, r, 1.7, 6), mats.steel, x, 0.85, z);
    add(new THREE.CylinderGeometry(r * 1.7, r * 1.7, r * 2.2, 8), mats.black, x, 0.12, z)
      .rotation.z = Math.PI / 2;
  }
  return g;
}

function buildHawkeye(mats) {
  const g = buildHornet(mats);
  const radome = new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.0, 0.7, 20), mats.grey);
  radome.position.set(0, 4.6, -0.6);
  radome.castShadow = true;
  g.add(radome);
  const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.0, 1.6), mats.jet);
  pylon.position.set(0, 3.5, -0.6);
  g.add(pylon);
  return g;
}

function buildHelo(mats) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 5.5, 8, 12), mats.grey);
  body.rotation.z = Math.PI / 2;
  body.position.y = 2.4;
  body.castShadow = true;
  g.add(body);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.18, 5.5, 8), mats.grey);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-5.2, 3.2, 0);
  g.add(tail);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(13, 0.12, 0.55), mats.greyDark);
  rotor.position.y = 4.3;
  g.add(rotor);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.18), mats.grey);
  fin.position.set(-7.4, 4.0, 0);
  g.add(fin);
  return g;
}

/* ------------------------------------------------------------------ *
 * Deck clutter
 * ------------------------------------------------------------------ */
function buildDetails(mats) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    g.add(m);
    return m;
  };

  // ---- Phalanx CIWS -------------------------------------------------
  // Base pedestal -> yaw ring -> drum housing (search-radar dish inside the
  // white radome on top) -> the 20 mm Gatling cluster: six barrels in a
  // ring, muzzle clamp, ammunition drum aft. The barrel cluster is what
  // reads as "gun" from any distance, so it gets real geometry.
  const ciws = (x, z, ry) => {
    const b = new THREE.Group();
    const mk = (geo, mat, y, z = 0, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, y, z);
      m.rotation.x = rx;
      m.castShadow = true;
      b.add(m);
      return m;
    };
    // pedestal + trainable yaw ring
    mk(new THREE.CylinderGeometry(1.05, 1.35, 1.1, 14), mats.greyDark, 0.55);
    mk(new THREE.CylinderGeometry(0.95, 0.95, 0.5, 14), mats.steel, 1.35);
    // drum housing (the gun's body), pitched with the mount
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 2.6, 14), mats.white);
    body.position.set(0, 2.55, 0.25);
    body.rotation.x = Math.PI / 2 - 0.22;
    body.castShadow = true;
    b.add(body);
    // ammo drum aft of the housing
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 12), mats.white);
    drum.position.set(0, 2.45, -1.35);
    drum.rotation.x = Math.PI / 2 - 0.22;
    drum.castShadow = true;
    b.add(drum);
    // white search-radar radome above the muzzle end
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 12), mats.white);
    dome.position.set(0, 3.35, 0.95);
    dome.castShadow = true;
    b.add(dome);
    // six-barrel Gatling cluster
    const barrels = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const bar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.075, 0.075, 2.3, 8), mats.black);
      bar.position.set(Math.cos(a) * 0.30, Math.sin(a) * 0.30, -1.15);
      bar.rotation.x = Math.PI / 2;
      barrels.add(bar);
    }
    const clamp = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), mats.greyDark);
    clamp.rotation.x = Math.PI / 2;
    clamp.position.z = -2.2;
    barrels.add(clamp);
    const cluster = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.5, 12), mats.greyDark);
    cluster.rotation.x = Math.PI / 2;
    barrels.add(cluster);
    barrels.position.set(0, 2.55, 1.65);
    barrels.rotation.x = -0.22;
    barrels.traverse((o) => { o.castShadow = true; });
    b.add(barrels);

    b.position.set(x, SHIP.deckY, z);
    b.rotation.y = ry;
    g.add(b);
  };
  ciws(146, -17.5, -0.3);
  ciws(146, 18, 0.3);
  ciws(-158, 31, Math.PI);

  // ---- MK-29 ESSM launchers ------------------------------------------
  // Trainable pedestal under a box of eight launch tubes; the tube mouths
  // are dark cylinders inset in the box face, which is what makes it read
  // as a launcher instead of a shed.
  const essm = (x, z, ry) => {
    const b = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.3, 1.2, 12), mats.greyDark);
    base.position.y = 0.6; base.castShadow = true;
    b.add(base);
    const box = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.7, 2.5), mats.grey);
    box.position.y = 2.4;
    box.rotation.x = -0.55;
    box.castShadow = true;
    b.add(box);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      const mouth = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, 0.3, 10), mats.black);
      mouth.position.set(-1.6 + i * 1.05, 2.4 + (j - 0.5) * 0.78 + 0.95, 1.05);
      mouth.rotation.x = Math.PI / 2 - 0.55;
      b.add(mouth);
      const rim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.30, 0.30, 0.1, 10), mats.greyDark);
      rim.position.copy(mouth.position);
      rim.position.z -= 0.13;
      rim.rotation.x = Math.PI / 2 - 0.55;
      b.add(rim);
    }
    b.position.set(x, SHIP.deckY, z);
    b.rotation.y = ry;
    g.add(b);
  };
  essm(136, -19, -0.4);
  essm(136, 19, 0.4);

  // deck tractors
  const tractor = (x, z, ry) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 2.0), mats.yellow);
    b.position.set(x, SHIP.deckY + 0.9, z);
    b.rotation.y = ry; b.castShadow = true;
    g.add(b);
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.3, 1.8), mats.yellow);
    c.position.set(x + Math.cos(ry) * 0.6, SHIP.deckY + 2.2, z - Math.sin(ry) * 0.6);
    c.rotation.y = ry; g.add(c);
  };
  tractor(84, 26, 0.2); tractor(-46, 34, 1.6); tractor(-100, 30, 0.4);
  tractor(30, -34, -0.3); tractor(-130, 30, 0.9);

  // RIB boats stowed on the starboard sponsor, inboard of the deck edge
  for (const [x, z] of [[-20, 34], [-31, 34]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(7, 1.6, 2.6), mats.orange);
    b.position.set(x, SHIP.deckY + 0.9, z);
    b.castShadow = true;
    g.add(b);
  }

  // aircraft crane
  add(new THREE.CylinderGeometry(0.35, 0.4, 8, 8), mats.grey, -150, SHIP.deckY + 4, -30);
  // crane jib
  add(new THREE.BoxGeometry(9, 0.3, 0.3), mats.grey, -146, SHIP.deckY + 7.9, -30);

  // ---- deck-edge antenna farm (the clutter that makes it read as real) --
  // NB positions respect deckHalfWidth(): an antenna placed past the outline
  // floats in mid-air beside the ship.
  const whip = (x, z, h, ry = 0) => {
    add(new THREE.CylinderGeometry(0.06, 0.09, h, 5), mats.greyDark,
        x, SHIP.deckY + h / 2, z).rotation.z = ry;
  };
  for (const [x, z] of [[118, 24], [108, 24], [-80, 28], [-90, 28],
                        [-30, -40], [60, -31], [138, 20], [-140, 29]]) {
    whip(x, z, 3.2 + Math.random() * 2.6, (Math.random() - 0.5) * 0.25);
  }
  // radome / communication domes
  for (const [x, z, r] of [[-60, 28, 1.1], [70, -31, 0.9], [-120, 29, 1.3]]) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mats.white);
    d.position.set(x, SHIP.deckY + r, z);
    d.castShadow = true;
    g.add(d);
  }

  // ---- vents / ducting along the deck edge ---------------------------
  for (const [x, z, w] of [[-10, -38, 14], [30, -36, 12], [90, -30, 10]]) {
    add(new THREE.BoxGeometry(w, 1.0, 1.6), mats.greyDark, x, SHIP.deckY + 0.5, z);
  }

  // ---- IFLOLS ("the meatball"): the optical landing aid on the port deck
  // edge — a light box on legs that pilots line up on. Nothing says "working
  // carrier" to a carrier fan like this little box.
  {
    const z = -deckHalfWidth(-138, -1) + 2.5;
    for (const dz of [-1.4, 1.4]) {
      add(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6), mats.greyDark,
        -138, SHIP.deckY + 1.7, z + dz);
    }
    add(new THREE.BoxGeometry(3.6, 2.2, 1.1), mats.grey, -138, SHIP.deckY + 4.6, z);
    // the yellow-lit face toward the approach (aft)
    const face = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.4, 0.12),
      new THREE.MeshStandardMaterial({
        color: 0xffd23e, emissive: 0x996f00, roughness: 0.4,
      }));
    face.position.set(-138, SHIP.deckY + 4.6, z - 0.56);
    face.rotation.y = 0.32;
    g.add(face);
  }

  // ---- floodlight boxes under the gallery band, spaced along the hull ----
  for (let x = -140; x <= 140; x += 28) {
    for (const side of [1, -1]) {
      const z = side * (deckHalfWidth(x, side) - 0.9);
      add(new THREE.BoxGeometry(1.1, 0.5, 0.5), mats.greyDark,
        x, SHIP.deckY - 2.3, z);
    }
  }

  return g;
}

/* ------------------------------------------------------------------ *
 * Hull-side fittings
 *
 * A 337 m hull seen from the water is mostly a long grey slab. What makes a
 * real carrier read as a working ship is the *clutter bolted to the shell*:
 * rows of life-raft canisters, portholes, sponsons, bilge keels, davits and
 * the anchor gear. All of it is placed by walking the same station table the
 * hull loft uses, so every fitting sits exactly on the plating.
 * ------------------------------------------------------------------ */
function buildHullDetails(mats) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // a point on the shell at station t and height y, on the given side
  const at = (t, y, side) => {
    const [, keel] = lerpStations(t);
    const top = SHIP.hullTopY;
    const u = THREE.MathUtils.clamp((y + keel) / (top + keel), 0, 1);
    const { halfW } = hullSection(t, u);
    return new THREE.Vector3(-HALF_L + t * SHIP.length, y, side * halfW);
  };

  // ---- life-raft canisters: the white rows above the waterline ----------
  const canGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.9, 10);
  for (let i = 0; i < 17; i++) {
    const t = 0.09 + (i / 16) * 0.82;
    for (const side of [1, -1]) {
      const p = at(t, 13.6, side);
      // lie them fore-and-aft along the shell
      add(canGeo, mats.white, p.x, p.y, p.z, 0, 0, Math.PI / 2);
    }
  }

  // ---- portholes / vent boxes ------------------------------------------
  for (let i = 0; i < 24; i++) {
    const t = 0.07 + (i / 23) * 0.86;
    for (const side of [1, -1]) {
      const p = at(t, 9.6, side);
      add(new THREE.BoxGeometry(1.1, 0.8, 0.28), mats.greyDark, p.x, p.y, p.z);
    }
  }

  // ---- bilge keels: the long fin that damps roll -----------------------
  for (const side of [1, -1]) {
    const p = at(0.44, -3.4, side);
    add(new THREE.BoxGeometry(104, 2.6, 1.5), mats.greyDark,
      p.x, p.y, p.z, 0, 0, side * 0.10);
  }

  // ---- sponsons: platforms projecting from the shell --------------------
  for (const [t, side] of [[0.28, 1], [0.28, -1], [0.60, 1], [0.60, -1],
                           [0.74, 1], [0.74, -1]]) {
    const p = at(t, 16.4, side);
    add(new THREE.BoxGeometry(9, 0.55, 4.4), mats.grey,
      p.x, p.y, p.z + side * 1.9);
    // a lip so the edge is not a razor-thin plate
    add(new THREE.BoxGeometry(9, 0.5, 0.4), mats.greyDark,
      p.x, p.y - 0.35, p.z + side * 4.0);
  }

  // ---- boat davits amidships -------------------------------------------
  for (const side of [1, -1]) {
    const p = at(0.52, 17.4, side);
    add(new THREE.CylinderGeometry(0.15, 0.19, 4.4, 8), mats.grey,
      p.x, p.y + 1.7, p.z + side * 0.5, side * 0.34);
  }

  // ---- anchor gear at the bow ------------------------------------------
  for (const side of [1, -1]) {
    const p = at(0.905, 6.4, side);
    add(new THREE.BoxGeometry(1.3, 2.6, 1.1), mats.black, p.x, p.y, p.z);
  }

  // ---- accommodation ladder (starboard, amidships) ---------------------
  {
    const p = at(0.58, 8.0, 1);
    add(new THREE.BoxGeometry(7.5, 0.35, 0.9), mats.greyDark,
      p.x, p.y, p.z + 0.9, 0, 0, 0.42);
  }

  return g;
}

/* ------------------------------------------------------------------ *
 * Waterline outline — used for the bow-wave / hull foam ribbon
 * ------------------------------------------------------------------ */
export function waterlineOutline(stations = 72) {
  const pts = [];
  const push = (t, side) => {
    const [keel] = lerpStations(t).slice(1);
    const u = keel / (SHIP.hullTopY + keel);      // u where the section is at y = 0
    const { halfW } = hullSection(t, u);
    pts.push({ t, x: -HALF_L + t * SHIP.length, z: side * halfW, side });
  };
  for (let i = 0; i <= stations; i++) push(i / stations, 1);
  for (let i = stations; i >= 0; i--) push(i / stations, -1);
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
export function buildPatches(stations = 26, ring = 14) {
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

  // deck + superstructure, so a capsized hull still floats plausibly
  for (let j = 0; j < 10; j++) {
    const x = -150 + j * 32;
    for (let i = 0; i < 5; i++) {
      const z = -32 + i * 16;
      patches.push({
        pos: new THREE.Vector3(x, SHIP.deckY, z),
        nrm: new THREE.Vector3(0, 1, 0),
        area: 32 * 16 * 0.8,
        kind: 'deck',
      });
    }
  }
  for (let j = 0; j < 5; j++) {
    const x = 34 + j * 12;
    for (let i = 0; i < 3; i++) {
      const z = 25 + i * 5;
      patches.push({
        pos: new THREE.Vector3(x, SHIP.deckY + 42, z),
        nrm: new THREE.Vector3(0, 1, 0),
        area: 12 * 5 * 0.7,
        kind: 'deck',
      });
    }
  }
  return patches;
}

/* ------------------------------------------------------------------ *
 * Bow catapult sponson + stern ensign + elevator sills
 * ------------------------------------------------------------------ */

/** The port-bow catapult sponson — the wedge "chin" hanging under the port
 *  forward flight deck. Every supercarrier has one; without it the bow
 *  reads as a plain wedge. */
function buildBowSponson(mats) {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(95, -37);
  s.lineTo(148, -25.5);
  s.lineTo(148, -37);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 3.0, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, SHIP.deckY - 0.4, 0);
  const m = new THREE.Mesh(geo, mats.deckSide);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return g;
}

/** Raised sill frames around the deck elevators — the painted rectangles
 *  alone read as decals; a physical sill edge sells them as machinery. */
function buildElevatorSills(mats) {
  const g = new THREE.Group();
  const rects = [[0, 20, 16, 30], [-110, -90, 16, 30], [-62, -42, -38, -26]];
  for (const [x1, x2, z1, z2] of rects) {
    const ins = 0.45, t = 0.34, h = 0.14;
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    const lx = (x2 - x1) - ins * 2, lz = (z2 - z1) - ins * 2;
    for (const zz of [cz + lz / 2, cz - lz / 2]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(lx, h, t), mats.greyDark);
      m.position.set(cx, SHIP.deckY + h / 2, zz);
      m.castShadow = true;
      g.add(m);
    }
    for (const xx of [cx - lx / 2, cx + lx / 2]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(t, h, lz), mats.greyDark);
      m.position.set(xx, SHIP.deckY + h / 2, cz);
      m.castShadow = true;
      g.add(m);
    }
  }
  return g;
}

/** The ensign at the stern gaff, flying aft. The cloth is a plane whose
 *  vertices ride two travelling sine harmonics with amplitude growing from
 *  the hoist (fixed edge) to the fly (free edge) — a cheap, honest flag.
 *  `group.userData.animate(t)` advances it. */
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
  staff.position.set(-167, SHIP.deckY + 7.5, 0);
  staff.castShadow = true;
  g.add(staff);
  flag.position.set(-167, SHIP.deckY + 13.6, 0);
  flag.rotation.y = Math.PI / 2;         // plane spans aft
  g.add(flag);
  g.userData.animate = (t) => flag.userData.animate(t);
  return g;
}

/* ------------------------------------------------------------------ *
 * Static-geometry baking
 *
 * The model is authored as hundreds of small primitive meshes because that
 * is the only sane way to build it — but drawing ~900 separate buffers,
 * twice (main pass + shadow pass), is what melts the GPU. Every part that
 * never moves relative to the hull is merged into one vertex stream per
 * material. Subtrees flagged `userData.dynamic` (the rotating radar) are
 * left untouched, and materials used by a single mesh are left alone.
 * ------------------------------------------------------------------ */

/** Swap triangle vertex order (i, i+1, i+2 -> i, i+2, i+1) across all
 *  attributes of a non-indexed geometry — needed when a mesh's accumulated
 *  transform has a negative determinant (mirrored port-side parts). */
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

function bakeStatic(root) {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const byMat = new Map();
  const doomed = [];
  const m = new THREE.Matrix4();

  (function walk(node) {
    for (const child of node.children) {
      if (child.userData.dynamic) continue;
      if (child.isMesh) {
        const geo = child.geometry.index
          ? child.geometry.toNonIndexed()
          : child.geometry.clone();
        m.copy(rootInv).multiply(child.matrixWorld);
        geo.applyMatrix4(m);
        if (m.determinant() < 0) { flipWinding(geo); geo.computeVertexNormals(); }
        let list = byMat.get(child.material);
        if (!list) byMat.set(child.material, (list = []));
        list.push(geo);
        doomed.push(child);
      } else {
        walk(child);
      }
    }
  })(root);

  for (const [mat, geos] of byMat) {
    if (geos.length < 2) continue;
    const merged = mergeGeometries(geos, false);
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    for (const g of geos) g.dispose();
  }
  for (const mesh of doomed) mesh.parent?.remove(mesh);
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */
export function createCarrier({ quality = 'high' } = {}) {
  const group = new THREE.Group();
  const mats = shipMaterials();

  const hullStations = quality === 'low' ? 80 : 160;
  const ring = quality === 'low' ? 18 : 32;

  const hull = buildHull(mats.hull, mats.hullPort, hullStations, ring);
  group.add(hull);
  group.add(buildTransom(mats.hull));
  // NB: no bulbous bow — the Ford class does not carry one, and a sphere
  // glued to the stem reads as a cargo-ship part on a carrier.
  group.add(buildDeck(mats));
  const island = buildIsland(mats);
  group.add(island);
  group.add(buildDetails(mats));
  group.add(buildHullDetails(mats));
  group.add(buildBowSponson(mats));
  group.add(buildElevatorSills(mats));
  const ensign = buildEnsign();
  group.add(ensign);

  // ---- air wing: REMOVED by request — the ship is modelled as
  // infrastructure only (parked-aircraft outlines remain painted on the
  // deck texture). buildHornet/buildHawkeye/buildHelo are kept above for
  // when the air wing comes back.

  // one draw call per material for everything static (see bakeStatic)
  bakeStatic(group);

  group.userData = {
    mats,
    island,
    patches: buildPatches(
      quality === 'low' ? 18 : 26,
      quality === 'low' ? 10 : 14,
    ),
    spin: island.userData.spin,
    hull,
    flagAnimate: ensign.userData.animate,
  };

  group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return group;
}
