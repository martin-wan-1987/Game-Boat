/** Actual Game.step/render, real keys, existing Ego page; no second browser. */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {preparePage,installTrace} from './shader-warmup-probe.mjs';
export async function verifyRandomEffects(page,{vessel,output}){
  await mkdir(output,{recursive:true});await preparePage(page);
  await page.goto(`http://127.0.0.1:8765/index.html?play=1&ship=${vessel}`);
  await page.waitForFunction(()=>window.__game?.running&&getComputedStyle(document.getElementById('loading')).opacity==='0',undefined,{timeout:120000});
  await page.evaluate(()=>{const g=__game;g._govDone=true;g.clock.stop();g.clock.autoStart=false;g.paused=false;g.showHelp=false;g.hud.update(.16,g.hudState());});
  const before=await installTrace(page);let report;
  try{
    const initial=await page.evaluate(()=>({ciws:__game.shipMesh.userData.weapons.hasCIWS,main:__game.shipMesh.userData.weapons.hasMain,bullets:__game.shipMesh.userData.weapons.tracers.bullets.length}));
    if(initial.main){await page.evaluate(()=>{if(__game.shipMesh.userData.weapons.hasSalvo)__game.advance(3);});await page.keyboard.press('f');}
    const main=await page.evaluate(()=>({bullets:__game.shipMesh.userData.weapons.tracers.bullets.length,shots:__game.shipMesh.userData.weapons.mounts.filter(m=>m.spec.type==='main'&&m.spec.operable!==false).map(m=>m.shots)}));
    if(await page.evaluate(()=>document.documentElement.classList.contains('compact-ui')))await page.click('loc=css:button[data-panel="waves"]');
    await page.click('loc=css:#nightBtn');
    await page.click('loc=css:button[data-panel="helm"]');
    for(let i=0;i<8;i++)await page.evaluate(()=>{__game.advance(1);__game.render();});
    const lights=await page.evaluate(async()=>{
      const THREE=await import('three'),g=__game,S=g.vessel,lights=g.shipMesh.userData.searchlights;
      const fixtures=lights.lamps.map(({mount,light},i)=>{
        const origin=light.getWorldPosition(new THREE.Vector3()),uniform=g.searchlightUniforms.uSearchPosition.value[i];
        const roofPoint=new THREE.Vector3(mount.position.x,S.bridgeRoof.y,mount.position.z);
        g.phys.localToWorld(roofPoint,roofPoint);const direction=new THREE.Vector3(0,-1,0).applyQuaternion(g.phys.quaternion);
        const ray=new THREE.Raycaster(roofPoint.clone().addScaledVector(direction,-.05),direction,0,100);
        const hit=ray.intersectObject(g.shipMesh,true).find(h=>{for(let p=h.object;p;p=p.parent)if(p===lights.group)return false;return !h.object.material.transparent;});
        return {local:mount.position.toArray(),roof:S.bridgeRoof,supportDistance:hit?.distance,sourceError:origin.distanceTo(new THREE.Vector3(uniform.x,uniform.y,uniform.z)),power:light.intensity};
      });return {night:g.manualNight,blend:g.skySys.night,fixtures};
    });
    await page.screenshot({path:resolve(output,`night-${vessel}.png`)});
    let tracers=null;
    if(initial.ciws){
      await page.keyboard.down('v');
      for(let i=0;i<4;i++)await page.evaluate(()=>{__game.advance(1);__game.render();});
      tracers=await page.evaluate(()=>({bullets:__game.shipMesh.userData.weapons.tracers.bullets.length,opacity:__game.shipMesh.userData.weapons.tracers.material.opacity,shots:__game.shipMesh.userData.weapons.mounts.filter(m=>m.spec.type==='ciws').map(m=>m.shots)}));
      await page.screenshot({path:resolve(output,`tracers-${vessel}.png`)});await page.keyboard.up('v');
    }
    const meteor=await page.evaluate(()=>{const g=__game;g.mode='random';g.randomSea.nightTarget=1;g.randomSea.nextPhaseAt=Infinity;g.randomSea.nextEventAt=Infinity;return g.meteors.launch(g.phys,60,g.time);});
    for(let i=0;i<18;i++)await page.evaluate(()=>{__game.advance(1);__game.render();});
    const after=await page.evaluate(()=>({programs:__shaderProbe.programs(),calls:__shaderProbe.calls,errors:__shaderProbe.errors,stats:__game.meteors.stats,radial:__game.field.packets.every(p=>p.radial),height:__game.tsunami.height,state:__game.tsunami.state}));
    report={at:new Date().toISOString(),vessel,before,initial,main,lights,tracers,meteor,after};
    await writeFile(resolve(output,`effects-${vessel}.json`),JSON.stringify(report,null,2));
  }finally{await page.keyboard.up('v');await page.evaluate(()=>window.__shaderProbe?.restore());}
  assert.deepEqual(report.after.programs,report.before.programs,`${vessel}: new shader variant`);
  assert.equal(report.after.calls.length,0);assert.deepEqual(report.after.errors,[]);
  assert.equal(report.main.bullets,0);if(report.initial.main)assert.ok(report.main.shots.every(n=>n>0));
  assert.ok(report.lights.night&&report.lights.blend>.98);
  assert.ok(report.lights.fixtures.every(f=>f.sourceError<1e-6&&f.supportDistance>=.049&&f.supportDistance<.06&&f.power>290000),`${vessel}: light is unsupported or source diverges`);
  if(report.initial.ciws)assert.ok(report.tracers.bullets>0&&report.tracers.opacity>.98&&report.tracers.shots.every(n=>n>0));
  assert.equal(report.after.height,60);assert.ok(report.after.radial&&report.after.stats.seaHits>=1);
  console.log({vessel,programsBefore:report.before.programs.length,programsAfter:report.after.programs.length,compileLink:report.after.calls.length,roofSupports:report.lights.fixtures.map(f=>f.supportDistance),tracers:report.tracers?.bullets,seaHits:report.after.stats.seaHits});
  return report;
}
export async function pairedMeteorTrials(page,{vessel,seed=941,output}){
  await mkdir(output,{recursive:true});await preparePage(page);
  const trials=[];
  for(const intercept of [false,true]){
    const initial=await page.evaluate(({vessel,seed})=>{
      const g=__game;g.running=true;g._govDone=true;g.paused=false;g.showHelp=false;g.clock.stop();g.clock.autoStart=false;g.mode='random';g.selectVessel(vessel);
      g.randomSea.nightTarget=1;g.randomSea.nextEventAt=g.randomSea.nextPhaseAt=Infinity;g.skySys.setStorm(.42,1);
      let n=seed;const rng=()=>((n=(Math.imul(n,1664525)+1013904223)>>>0)/4294967296),random=Math.random;
      try{Math.random=rng;g.meteors.launch(g.phys,60,g.time);}finally{Math.random=random;}
      const impact=g.damage.impact,probe={rng,impactLoss:0,impacts:[],restore(){g.damage.impact=impact;delete window.__pairedMeteor;}};
      g.damage.impact=function(...args){const before=this.integrity;impact.apply(this,args);probe.impactLoss+=before-this.integrity;probe.impacts.push({time:args[2],loss:before-this.integrity,local:args[1].toArray()});};
      window.__pairedMeteor=probe;
      return g.meteors.rocks.map(r=>({kind:r.kind,position:r.position.toArray(),velocity:r.velocity.toArray(),radius:r.radius}));
    },{vessel,seed});
    if(intercept)await page.keyboard.down('v');
    let trial;
    try{
      for(let i=0;i<18;i++)await page.evaluate(()=>{const random=Math.random;try{Math.random=__pairedMeteor.rng;__game.advance(1);}finally{Math.random=random;}});
      trial=await page.evaluate(()=>({stats:{...__game.meteors.stats},impactLoss:__pairedMeteor.impactLoss,impacts:__pairedMeteor.impacts,integrity:__game.damage.integrity,events:__game.damage.events,shots:__game.shipMesh.userData.weapons.mounts.map(m=>m.shots),height:__game.tsunami.height,packets:__game.field.packets.length}));
    }finally{await page.keyboard.up('v');await page.evaluate(()=>window.__pairedMeteor?.restore());}
    trials.push({intercept,seed,initial,...trial});
  }
  await writeFile(resolve(output,`paired-${vessel}.json`),JSON.stringify(trials,null,2));
  assert.deepEqual(trials[0].initial,trials[1].initial,'Paired shower must have identical initial rocks');
  assert.ok(trials[0].stats.hullHits>0&&trials[0].impactLoss>0,`${vessel}: no baseline hull impacts`);
  assert.ok(trials[1].stats.intercepted>0&&trials[1].stats.hullHits<trials[0].stats.hullHits&&trials[1].impactLoss<trials[0].impactLoss,`${vessel}: interception did not reduce real hull impacts`);
  assert.ok(trials.every(t=>t.height===60&&t.packets===3));
  console.log({vessel,seed,trials:trials.map(t=>({intercept:t.intercept,...t.stats,impactLoss:t.impactLoss}))});return trials;
}
