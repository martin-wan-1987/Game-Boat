import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--headless=new', '--no-sandbox', '--use-gl=angle',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const fails = [];
page.on('requestfailed', (r) => fails.push(r.url()));
page.on('response', (r) => { if (r.status() >= 400) fails.push(`${r.status()} ${r.url()}`); });
await page.goto('http://127.0.0.1:8765/index.html', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 12000));

const info = await page.evaluate(() => {
  const g = window.__game;
  const out = { shipFound: !!g.shipMesh, mats: [], geo: {} };
  if (g.shipMesh) {
    const seen = new Set();
    g.shipMesh.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (seen.has(m.uuid)) return;
      seen.add(m.uuid);
      out.mats.push({
        type: m.type,
        color: '#' + m.color.getHexString(),
        hasMap: !!m.map,
        mapImg: m.map?.image ? `${m.map.image.width}x${m.map.image.height}` : null,
        mapFlipY: m.map?.flipY,
        mapColorSpace: m.map?.colorSpace,
        roughness: m.roughness, metalness: m.metalness,
        name: o.name || o.geometry.type,
      });
    });
  }
  // ocean
  const oc = g.ocean;
  out.ocean = {
    hasEnv: !!oc?.uniforms.uEnvMap.value,
    seaCount: oc?.uniforms.uSeaCount.value,
    tsuCount: oc?.uniforms.uTsuCount.value,
    camDist: oc?.uniforms.uCamDist.value,
    fogDensity: oc?.uniforms.uFogDensity.value,
    ripple: !!oc?.uniforms.uRippleNrm.value,
    finestCell: oc?.finestCell,
    firstSeaAmp: oc?.uniforms.uSeaA.value?.[0]?.z,
    seaAmps: Array.from({ length: 8 }, (_, i) => +(oc.uniforms.uSeaA.value[i].z).toFixed(3)),
    seaLens: Array.from({ length: 8 }, (_, i) => +(2 * Math.PI / oc.uniforms.uSeaB.value[i].x).toFixed(1)),
  };
  // deck geometry uv range
  let deck = null;
  g.shipMesh.traverse((o) => { if (o.isMesh && o.material.map && o.geometry.attributes.uv && o.geometry.type === 'ShapeGeometry') deck = o; });
  if (deck) {
    const uv = deck.geometry.attributes.uv;
    let u0 = 9, u1 = -9, v0 = 9, v1 = -9;
    for (let i = 0; i < uv.count; i++) {
      u0 = Math.min(u0, uv.getX(i)); u1 = Math.max(u1, uv.getX(i));
      v0 = Math.min(v0, uv.getY(i)); v1 = Math.max(v1, uv.getY(i));
    }
    out.geo.deckUV = { u0: +u0.toFixed(3), u1: +u1.toFixed(3), v0: +v0.toFixed(3), v1: +v1.toFixed(3) };
  }
  out.physDraft = +g.phys.position.y.toFixed(3);
  out.roll = +(g.phys.attitude.roll * 57.3).toFixed(2);
  return out;
});

console.log(JSON.stringify(info, null, 1));
console.log('FAILED REQUESTS:', fails.length ? fails : '(none)');
await browser.close();
