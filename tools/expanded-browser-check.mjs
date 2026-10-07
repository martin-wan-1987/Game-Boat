import {mkdir,writeFile} from 'node:fs/promises';
const root='/Users/martinwan/codex-project/Game-Boat/',output=root+'qa/2026-10-04/expanded-fleet/';
export async function inspectFleet(page){
  await mkdir(output+'models',{recursive:true});const results=[];
  const ships=await page.evaluate(()=>Object.keys(__game.vessels));
  for(const id of ships){
    const result=await page.evaluate(id=>{
      const g=__game;g.running=false;g._govDone=true;g.paused=g.showHelp=false;g.selectVessel(id);g.hud.show(false);
      g.rig.setMode('orbit');g.rig.radius=g.vessel.length*1.36;g.rig.theta=.74;g.rig.phi=1.02;g.rig._snap=true;g.rig.update(0,g.shipMesh,g.field,g.tsunami.dir);g.render();
      const mounts=g.shipMesh.userData.weapons.mounts;let triangles=0,meshes=0;
      g.shipMesh.traverseVisible(m=>{if(m.isMesh){meshes++;triangles+=(m.geometry.index?.count??m.geometry.attributes.position.count)/3;}});
      return {id,meshes,triangles,mass:g.phys.mass,aircraft:g.activeVessel.aircraft.onDeck,weapons:mounts.map(m=>({id:m.spec.id,type:m.spec.type,operable:m.spec.operable!==false})),programs:g.renderer.info.programs.length};
    },id);
    await page.screenshot({path:output+'models/'+id+'-quarter.png'});
    await page.evaluate(()=>{const g=__game;g.rig.theta=Math.PI/2;g.rig.phi=.21;g.rig._snap=true;g.rig.update(0,g.shipMesh,g.field,g.tsunami.dir);g.render();});
    await page.screenshot({path:output+'models/'+id+'-top.png'});
    results.push(result);console.log(result);
  }
  await page.evaluate(()=>{const g=__game;g.selectVessel('destroyer');g.setCamera('bridge');g.rig.update(0,g.shipMesh,g.field,g.tsunami.dir);g.render();});
  await page.screenshot({path:output+'models/destroyer-bridge.png'});
  await writeFile(output+'models.json',JSON.stringify(results,null,2));return results;
}
export async function verifyExpandedControls(page){
  // Shader tracing freezes the clock, while these are live UI actions whose
  // availability is derived by the normal HUD tick.
  await page.evaluate(()=>__game.clock.start());
  const checks=[];const record=(name,pass,evidence)=>{checks.push({name,pass,evidence});console.log({name,pass});};
  for(const id of ['yamato','iowa']){
    await page.evaluate(id=>{const g=__game;g.selectVessel(id);g.startGame('free');g._govDone=true;},id);
    await page.click('[data-panel="weapons"]');
    for(const side of [-1,1]){
      await page.evaluate(()=>{__game.running=true;__game.shipMesh.userData.weapons.reset();__game.__shots=[];if(!__game.__gunOriginal){__game.__gunOriginal=__game.gunShot;__game.gunShot=function(shot){this.__shots.push({id:shot.spec.id,side:shot.spec.side,z:shot.direction.z,at:this.time});return this.__gunOriginal(shot);};}});
      await page.click(side<0?'#portGunsBtn':'#starboardGunsBtn');await page.click('#salvoBtn');
      const result=await page.evaluate(()=>{
        const g=__game;g.running=false;
        for(let i=0;i<400&&!g.__shots.length;i++)g.advance(1/60);
        const shots=g.__shots.slice(),expected=g.vessel.weapons.filter(w=>w.type!=='ciws'&&w.operable!==false&&(!w.side||w.side===g.shipMesh.userData.weapons.selectedSide)).reduce((n,w)=>n+w.barrels,0);
        g.rig.update(0,g.shipMesh,g.field,g.tsunami.dir);g.render();return {shots,expected,velocity:g.phys.velocity.toArray(),omega:g.phys.omega.toArray(),smoke:g.particles.kind.reduce((n,k,i)=>n+(k===3&&g.particles.life[i]>0),0),programs:g.renderer.info.programs.length};
      });
      record(id+'-'+(side<0?'port':'starboard')+'-salvo',result.shots.length===result.expected&&result.shots.every(s=>s.z*side>0),result);
      await page.screenshot({path:output+id+'-'+(side<0?'port':'starboard')+'-salvo.png'});
    }
    await page.evaluate(()=>__game.running=true);await page.keyboard.down('l');
    const rotation=await page.evaluate(()=>{const g=__game;g.running=false;const before=g.shipMesh.userData.weapons.aimOffset;g.advance(.6);return {before,after:g.shipMesh.userData.weapons.aimOffset,keys:[...g.input.keys]};});
    await page.keyboard.up('l');record(id+'-rotation-key',rotation.after>rotation.before,rotation);
  }
  await page.evaluate(()=>{const g=__game;g.selectVessel('typhoon');g.startGame('free');g._govDone=true;});
  await page.click('[data-panel="helm"]');await page.click('#diveBtn');
  const shore=await page.evaluate(()=>{const g=__game;g.running=false;g.advance(1/60);return {station:g.activeVessel.station.station,position:g.phys.position.toArray(),camera:g.camera.position.toArray(),separation:g.camera.position.distanceTo(g.phys.position)};});
  record('submarine-dive-shore',shore.station==='shore'&&shore.separation>100,shore);await page.screenshot({path:output+'typhoon-shore.png'});
  await page.evaluate(()=>__game.running=true);await page.click('#periscopeBtn');
  if(await page.evaluate(()=>document.documentElement.classList.contains('compact-ui')))await page.click('[data-panel="cameras"]');
  await page.click('[data-cam="bridge"]');
  const scope=await page.evaluate(()=>{const g=__game;g.running=false;g.advance(1/60);g.running=true;g.render();g.running=false;return {station:g.activeVessel.station.station,periscope:g.activeVessel.station.periscope,view:g.activeVessel.station.mirrorView(g.rig.mode),mask:!document.getElementById('periscopeView').hidden,camera:g.camera.position.toArray(),position:g.phys.position.toArray()};});
  record('submarine-periscope-bridge',scope.view&&scope.mask&&scope.periscope,scope);await page.screenshot({path:output+'typhoon-periscope.png'});
  await page.evaluate(()=>__game.running=true);await page.click('[data-panel="helm"]');await page.click('#boardBtn');
  const aboard=await page.evaluate(()=>{const g=__game;g.running=false;g.advance(1/60);return {station:g.activeVessel.station.station,periscope:g.activeVessel.station.periscope,y:g.phys.position.y};});
  record('submarine-board-surface',aboard.station==='aboard'&&!aboard.periscope&&aboard.y>-15,aboard);
  const aircraft=await page.evaluate(()=>{
    const g=__game;g.selectVessel('carrier');const a=g.activeVessel.aircraft;const before=a.onDeck;g.shipMesh.quaternion.setFromAxisAngle(new g.camera.up.constructor(1,0,0),.6);g.phys.quaternion.copy(g.shipMesh.quaternion);g.phys.omega.set(0,0,0);g.phys.velocity.set(0,0,0);a.previousVelocity.set(0,0,0);a.previousOmega.set(0,0,0);
    for(let i=0;i<60*18;i++)a.update(1/60,g.shipMesh,g.phys,g.field,g.particles);
    return {before,onDeck:a.onDeck,splashed:a.splashed,states:a.planes.map(p=>p.state)};
  });
  record('aircraft-gravity-friction-slip-splash',aircraft.before>=1&&aircraft.before<=5&&aircraft.splashed>0,aircraft);
  await writeFile(output+'controls-expanded.json',JSON.stringify({status:checks.every(c=>c.pass)?'passed':'failed',checks},null,2));return checks;
}
