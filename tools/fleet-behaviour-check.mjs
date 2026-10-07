import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

/** Exercise the candidate's actual objects and renderer. Controlled deck
 * attitude isolates individual payload contacts; cargo triggering below uses
 * the game's unmodified wave/physics/update path. */
export async function verifyFleetBehaviours(page,{output}={}){
  await mkdir(output,{recursive:true});
  await page.waitForFunction(()=>document.getElementById('enterBtn')?.classList.contains('on'),undefined,{timeout:120000});
  await page.evaluate(()=>{const g=__game;g.clock.stop();g.clock.autoStart=false;g._govDone=true;g.input.release();});
  const checks=[];
  const record=(name,pass,evidence)=>{checks.push({name,pass,evidence});console.log({name,pass});};
  const support=await page.evaluate(()=>{
    const g=__game,rows=[];
    for(const entry of g.vesselActors){
      const lights=entry.mesh.userData.searchlights;
      lights.update(1,g.searchlightUniforms,0,0);entry.mesh.updateMatrixWorld(true);
      const positions=lights.lamps.map(l=>({light:l.light.position.toArray(),lens:l.mount.children.find(m=>m.geometry?.type==='CircleGeometry').position.toArray()}));
      const warnings=lights.warnings.map(w=>({support:w.fixture.userData.support,mount:w.fixture.position.toArray(),bulb:w.bulb.position.toArray(),light:w.light.position.toArray()}));
      rows.push({id:entry.mesh.userData.vessel.id,positions,warnings});
    }
    return {actors:rows.length,rows,failedPrograms:g.renderer.info.programs.filter(p=>p.diagnostics?.runnable===false).length};
  });
  record('every actor has surface-mounted emitters',support.failedPrograms===0&&support.rows.every(r=>r.positions.every(p=>p.light.every((v,i)=>v===p.lens[i]))&&r.warnings.every(w=>w.support.every(Number.isFinite)&&w.light.every((v,i)=>v===w.bulb[i]))),support);

  for(const id of ['yamato','iowa','battleship']){
    const guns=await page.evaluate(id=>{
      const g=__game;g.selectVessel(id);g.startGame('free');g.running=false;
      const w=g.shipMesh.userData.weapons,results=[];
      for(const side of [-1,1]){
        w.reset();w.setSide(side);w.requestSalvo();const shots=[];
        for(let i=0;i<60*7;i++)w.update(1/60,{onShot:shot=>{shots.push({id:shot.spec.id,position:shot.origin.toArray(),direction:shot.direction.toArray()});g.gunShot(shot);}});
        const expected=g.vessel.weapons.filter(s=>s.type!=='ciws'&&s.operable!==false&&(!s.side||s.side===side)).reduce((n,s)=>n+s.barrels,0);
        const Matrix=w.renderMatrix.constructor,actual=new Matrix(),wanted=new Matrix();let matrixError=0;
        w.syncTransforms();
        for(const batch of w.renderBatches)batch.parts.forEach((part,i)=>{batch.mesh.getMatrixAt(i,actual);wanted.multiplyMatrices(w.renderInverse,part.matrixWorld);matrixError=Math.max(matrixError,...actual.elements.map((v,j)=>Math.abs(v-wanted.elements[j])));});
        results.push({side,expected,shots,matrixError});
      }
      g.setCamera('orbit');g.rig._snap=true;g.rig.update(0,g.shipMesh,g.field,g.tsunami.dir);g.render();return {mounts:w.mounts.length,results};
    },id);
    record(id+' complete selected battery and rendered joints',guns.results.every(r=>r.shots.length===r.expected&&r.shots.every(s=>s.position.every(Number.isFinite)&&s.direction.every(Number.isFinite))&&r.matrixError<.001),guns);
    await page.screenshot({path:output+'/'+id+'-battery.png'});
  }

  await page.evaluate(()=>{const g=__game;g.selectVessel('typhoon');g.startGame('free');g.hud.show(true);g.hud.update(.2,g.hudState());g.setCamera('orbit');});
  await page.keyboard.press('t');
  const scope=await page.evaluate(()=>{
    const g=__game;g.advance(2.3);const scope=g.shipMesh.userData.periscope;
    const raised={extension:scope.extension,visible:scope.group.visible,attached:scope.group.parent===g.shipMesh};
    g.setCamera('bridge');g.advance(.1);g.render();const bridgeMask=!document.getElementById('periscopeView').hidden;
    g.setCamera('orbit');g.advance(.1);g.render();const orbitMask=!document.getElementById('periscopeView').hidden;
    g.rig.radius=90;g.rig._snap=true;g.rig.update(0,g.shipMesh,g.field,g.tsunami.dir);g.render();
    return {raised,bridgeMask,orbitMask,diveAbsent:!document.getElementById('diveBtn')};
  });
  record('visible periscope and bridge-only optics',scope.raised.extension===1&&scope.raised.visible&&scope.raised.attached&&scope.bridgeMask&&!scope.orbitMask&&scope.diveAbsent,scope);
  await page.screenshot({path:output+'/typhoon-raised-scope.png'});

  const aircraft=await page.evaluate(()=>{
    const g=__game;g.selectVessel('liaoning');const random=Math.random;
    try{Math.random=()=>.999;g.startGame('free');}finally{Math.random=random;}
    const a=g.activeVessel.aircraft,motion=g.activeVessel.deckMotion,V=g.phys.position.constructor;
    g.phys.quaternion.setFromAxisAngle(new V(1,0,0),.44);g.shipMesh.quaternion.copy(g.phys.quaternion);g.phys.omega.set(0,0,0);g.phys.velocity.set(0,0,0);
    motion.reset(g.phys);motion.update(1/60,g.shipMesh,g.phys);
    for(let i=0;i<60*35;i++)a.update(1/60,g.shipMesh,g.phys,g.field,g.particles,motion);
    const states=a.planes.map(p=>({state:p.state,tied:p.tied,position:p.position.toArray(),visible:p.mesh.visible}));
    g.shipMesh.updateMatrixWorld(true);g.rig.setMode('orbit');g.rig.radius=360;g.rig.theta=-.9;g.rig.phi=.85;g.rig._snap=true;g.rig.update(0,g.shipMesh,g.field,g.tsunami.dir);g.render();
    return {states,splashed:a.splashed,independent:new Set(a.planes.map(p=>p.mesh)).size===5};
  });
  record('five aircraft retain separate ties and falls',aircraft.independent&&aircraft.states.slice(0,3).every(p=>!p.tied&&p.state!=='deck')&&aircraft.states.slice(3).every(p=>p.tied&&p.state==='deck')&&aircraft.splashed>0,aircraft);
  await page.screenshot({path:output+'/independent-aircraft.png'});

  for(const id of ['msc-irina','ever-fortune','oocl-hong-kong']){
    await page.evaluate(id=>{const g=__game;g.selectVessel(id);g.startGame('free');g.manualNight=false;g.fireTsunami('broad');g.hud.show(false);g.screens.hideAll();},id);
    for(let i=0;i<40;i++){
      const ready=await page.evaluate(()=>{__game.advance(2);return __game.activeVessel.cargo.splashed>0;});
      if(ready)break;
    }
    const cargo=await page.evaluate(()=>{
      const g=__game,c=g.activeVessel.cargo,counts={};for(const b of c.bodies)counts[b.state]=(counts[b.state]??0)+1;
      const floats=[...c.active].filter(b=>b.state==='floating');
      if(!floats.length)return {id:g.vesselId,triggered:c.release.triggered,released:c.release.released,counts,success:false};
      const b=floats[0],before=b.position.toArray();g.advance(10);
      const persisted=b.state==='floating',Camera=g.camera.constructor,cam=new Camera(48,1440/900,.1,5000);
      cam.position.copy(b.position).add(new g.phys.position.constructor(26,18,24));cam.lookAt(b.position);cam.updateProjectionMatrix();cam.updateMatrixWorld();c.cull(cam);
      const retained=b.state==='floating';g.camera.position.copy(cam.position);g.camera.quaternion.copy(cam.quaternion);g.camera.updateMatrixWorld();g.render();
      window.__cargoViewed=b;
      return {id:g.vesselId,triggered:c.release.triggered,released:c.release.released,budget:c.release.budget,total:c.bodies.length,splashes:c.splashed,counts,before,after:b.position.toArray(),persisted,retained,success:true};
    });
    await page.screenshot({path:output+'/'+id+'-floating-box.png'});
    const retired=await page.evaluate(()=>{
      const g=__game,c=g.activeVessel.cargo,b=window.__cargoViewed;if(!b)return false;
      g.camera.lookAt(g.camera.position.clone().multiplyScalar(2).sub(b.position));g.camera.updateMatrixWorld();c.cull(g.camera);const out=b.state==='retired';
      delete window.__cargoViewed;c.reset();return out&&c.retired===0&&c.bodies.every(b=>b.state==='stowed')&&!c.release.triggered;
    });
    record(id+' actual wave, splash, persistence, frustum and reset',cargo.success&&cargo.triggered&&cargo.released<=cargo.budget&&cargo.persisted&&cargo.retained&&retired,{...cargo,retiredOutsideAndReset:retired});
  }

  const islands=await page.evaluate(async()=>{
    const {ISLANDS,terrainHeight,shoreRadius}=await import('/src/islands.js'),g=__game;let maxError=0,sampled=0;
    const lands=g.islands.group.children.filter(m=>m.material?.name==='Eroded coastal terrain');
    lands.forEach((mesh,i)=>{const p=mesh.geometry.attributes.position;for(let k=0;k<p.count;k+=67){maxError=Math.max(maxError,Math.abs(p.getY(k)-terrainHeight(ISLANDS[i],p.getX(k),p.getZ(k))));sampled++;}});
    g.selectVessel('pilot');g.phys.reset(ISLANDS[0].x+shoreRadius(ISLANDS[0],0)+2,ISLANDS[0].z,0);g.phys.velocity.set(-2,0,0);
    const before=g.phys.position.toArray(),impulse=g.islands.collide(g.phys,1/120),after=g.phys.position.toArray();
    g.camera.position.set(1200,170,-260);g.camera.lookAt(900,35,-560);g.camera.updateMatrixWorld();g.skySys.setStorm(.42,0);g.ocean.setFog(g.skySys.scene.fog.color,g.skySys.fogDensity);g.render();
    return {lands:lands.length,scenery:g.islands.scenery,maxError,sampled,impulse,before,after};
  });
  record('terrain mesh matches height source and contact preserves position',islands.lands===8&&islands.maxError<.001&&islands.scenery.trees>0&&islands.scenery.rocks>0&&islands.impulse>0&&islands.before.every((v,i)=>v===islands.after[i]),islands);
  await page.screenshot({path:output+'/island-terrain-contact.png'});

  const report={at:new Date().toISOString(),status:checks.every(c=>c.pass)?'passed':'failed',checks};
  await writeFile(output+'/fleet-behaviours.json',JSON.stringify(report,null,2));
  assert.equal(report.status,'passed','See saved behavioural evidence');return report;
}
