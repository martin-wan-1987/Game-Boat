import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUTPUT = fileURLToPath(new URL('../qa/2026-10-02/realism/', import.meta.url));

/** Stable axis: one differentiable wave surface. Change axis: spectrum,
 * vessel placement, packet direction and time. The CPU and production GLSL
 * must agree at the same base coordinates; no test-only wave implementation.
 * Run through the existing Ego TaskSpace's page, without opening a browser.
 */
export async function verifyPulseGPU(page, output = DEFAULT_OUTPUT) {
  await mkdir(output, { recursive: true });
  const report = await page.evaluate(async () => {
    const THREE = await import('three');
    const { WaveField, MAX_SEA, makeWaveUniforms, applyWaveUniforms, glslWaves } = await import('/src/waves.js');
    const { TsunamiManager, TSUNAMI_TIERS, SEA_STATE } = await import('/src/tsunami.js');
    const { ShipPhysics } = await import('/src/physics.js');
    const { createHullLoft } = await import('/src/hull-loft.js');
    const { meteorWave } = await import('/src/meteors.js');
    const renderer = __game.renderer;
    const gl = renderer.getContext();
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Float render targets unavailable: GPU equality unverified');
    const uniforms = makeWaveUniforms(THREE);
    Object.assign(uniforms, { uProbePoints: { value: null }, uProbeCount: { value: 0 }, uProbeMode: { value: 0 } });
    const scene = new THREE.Scene(), camera = new THREE.Camera();
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      uniforms, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'void main(){gl_Position=vec4(position,1.0);}',
      fragmentShader: `${glslWaves()}
        uniform sampler2D uProbePoints;
        uniform float uProbeCount;
        uniform int uProbeMode;
        void main(){
          vec2 p=texture2D(uProbePoints,vec2(gl_FragCoord.x/uProbeCount,0.5)).xy;
          WaveSample w=sampleWaves(p);
          if(uProbeMode==0)gl_FragColor=vec4(w.pos,w.jac);
          else if(uProbeMode==1)gl_FragColor=vec4(w.nrm,1.0);
          else gl_FragColor=vec4(w.vel,1.0);
        }`,
    });
    const quad = new THREE.Mesh(geometry, material); quad.frustumCulled = false; scene.add(quad);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, depthBuffer: false });
    const previous = renderer.getRenderTarget();
    const cases = [];
    let seed = 0x65c0ffee;
    const seeded = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const field = new WaveField();
    // buildSea intentionally accepts Math.random; scope the seeded generator
    // to synchronous setup, then restore it before the application's next turn.
    const random = Math.random;
    try { Math.random = seeded; field.buildSea(SEA_STATE.hs, 1, 0, SEA_STATE.spread, SEA_STATE.peakLength, SEA_STATE.directions); }
    finally { Math.random = random; }
    const manager = new TsunamiManager(field);
    const probes = (time) => {
      const rows = [];
      // The two-dimensional background also catches direction/normal errors
      // away from pulse centre lines and where independent packets overlap.
      for (let ix = 0; ix < 17; ix++) for (let iz = 0; iz < 17; iz++) rows.push([-800 + ix * 100, -800 + iz * 100]);
      const along = [-1.0001, -1, -.8, -.3, 0, .3, .8, 1, 1.1, 1.25, 1.5, 1.6999, 1.7001];
      const across = [-1.0001, -.65, 0, .65, 1.0001];
      for (const p of field.packets) {
        if (p.radial) {
          rows.push([p.x,p.z]);
          for(const u of along)for(let a=0;a<8;a++){
            const radius=p.trailingExtent+p.speed*(time-p.t0)-u*p.width;
            if(radius>=0)rows.push([p.x+radius*Math.cos(a*Math.PI/4),p.z+radius*Math.sin(a*Math.PI/4)]);
          }
        } else for (const u of along) for (const v of across) {
          const s = u * p.width - p.speed * (time - p.t0), r = v * p.lateral;
          rows.push([p.x + p.dx * s - p.dz * r, p.z + p.dz * s + p.dx * r]);
        }
      }
      const data = new Float32Array(rows.length * 4);
      rows.forEach(([x, z], i) => { data[i * 4] = x; data[i * 4 + 1] = z; });
      return data;
    };
    const run = (vessel, tier, time) => {
      field.time = time; applyWaveUniforms(uniforms, field);
      const points = probes(time), count = points.length / 4;
      const texture = new THREE.DataTexture(points, count, 1, THREE.RGBAFormat, THREE.FloatType);
      texture.needsUpdate = true;
      uniforms.uProbePoints.value = texture; uniforms.uProbeCount.value = count;
      target.setSize(count, 1);
      const result = { vessel, tier, time, count, seaCount: field.sea.length, packetCount: field.packets.length,
        packetKind:field.packets[0]?.radial?'radial':'plane',
        packetDirections: [...new Set(field.packets.map(p => `${p.dx.toFixed(5)},${p.dz.toFixed(5)}`))],
        finite: true, positionError: 0, normalError: 0, velocityError: 0, jacobianError: 0, worst: {} };
      const reference = Array.from({ length: count }, (_, i) => field.sampleBase(points[i * 4], points[i * 4 + 1], {}));
      const kinds = [['positionError', ['x', 'y', 'z']], ['normalError', ['nx', 'ny', 'nz']], ['velocityError', ['vx', 'vy', 'vz']]];
      try {
        for (let mode = 0; mode < kinds.length; mode++) {
          uniforms.uProbeMode.value = mode;
          renderer.setRenderTarget(target); renderer.render(scene, camera);
          const values = new Float32Array(count * 4);
          renderer.readRenderTargetPixels(target, 0, 0, count, 1, values);
          result.finite &&= values.every(Number.isFinite);
          const [name, keys] = kinds[mode];
          for (let i = 0; i < count; i++) {
            for (let axis = 0; axis < 3; axis++) {
              const error = Math.abs(values[i * 4 + axis] - reference[i][keys[axis]]);
              if (error > result[name]) {
                result[name] = error;
                result.worst[name] = { point: [points[i * 4], points[i * 4 + 1]], axis: keys[axis], gpu: values[i * 4 + axis], cpu: reference[i][keys[axis]] };
              }
            }
            if (mode === 0) result.jacobianError = Math.max(result.jacobianError, Math.abs(values[i * 4 + 3] - reference[i].jac));
          }
        }
      } finally { texture.dispose(); }
      cases.push(result);
    };
    try {
      run('spectrum', 'ambient', 13.75);
      for (const [id, entry] of Object.entries(__game.vessels)) {
        const spec=entry.mesh.userData.vessel;
        const ship = new ShipPhysics(createHullLoft(spec).buildPatches(), { vessel: spec });
        ship.reset(130, -74, .73);
        for (const tier of Object.keys(TSUNAMI_TIERS)) {
          field.time = 3.25;
          try { Math.random = seeded; manager.trigger(tier, ship, field.time); }
          finally { Math.random = random; }
          for (const elapsed of [0, 13.5, 38.75]) run(id, tier, 3.25 + elapsed);
        }
      }
      const spec=__game.vessel,ship=new ShipPhysics(createHullLoft(spec).buildPatches(),{vessel:spec});
      ship.reset(130,-74,.73);
      for(const height of [20,60,100]){
        field.time=3.25;
        manager.triggerSpec(meteorWave(height),ship,field.time,{height,epicentre:new THREE.Vector3(-123,0,219)});
        const delay=field.packets[1].t0-field.packets[0].t0;
        for(const elapsed of [-.001,0,.001,1,2,delay-.001,delay,delay+1,38.75])run('meteor',String(height),3.25+elapsed);
      }
    } finally {
      renderer.setRenderTarget(previous); geometry.dispose(); material.dispose(); target.dispose();
    }
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { date: new Date().toISOString(), maxSea: MAX_SEA, seed: '0x65c0ffee', spectrum: field.sea,
      units: { positionError: 'metres', normalError: 'unit-vector component', velocityError: 'metres/second', jacobianError: 'dimensionless' },
      tolerances: { positionError: .001, normalError: .001, velocityError: .001, jacobianError: .0001 },
      gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), cases };
  });
  await writeFile(resolve(output, 'pulse-gpu.json'), JSON.stringify(report, null, 2));
  for (const row of report.cases) {
    const name = `${row.vessel}/${row.tier}/t=${row.time}`;
    assert.ok(row.finite, `${name}: non-finite float target`);
    assert.equal(row.seaCount, report.maxSea, `${name}: full ambient spectrum missing`);
    if (row.tier !== 'ambient'&&row.packetKind==='plane') assert.equal(row.packetDirections.length, 4, `${name}: incomplete directional coverage`);
    if(row.packetKind==='radial')assert.equal(row.packetCount,3,`${name}: incomplete ring train`);
    for (const [metric, tolerance] of Object.entries(report.tolerances)) assert.ok(row[metric] < tolerance, `${name}: ${metric}=${row[metric]} >= ${tolerance}`);
  }
  console.log({ gpuCases: report.cases.length, samples: report.cases.reduce((sum, c) => sum + c.count, 0),
    maxima: Object.fromEntries(Object.keys(report.tolerances).map(k => [k, Math.max(...report.cases.map(c => c[k]))])) });
  return report;
}
