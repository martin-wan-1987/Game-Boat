import {mkdir,writeFile} from 'node:fs/promises';
import {FLEET} from '../src/fleet.js';

/** Current models on the running game renderer, with the same water, camera,
 * material and light path used in play. Run in the Ego Node runtime. */
export async function reviewFleet(page,{output}={}){
  await mkdir(output+'/models',{recursive:true});
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await page.waitForFunction(()=>document.getElementById('enterBtn')?.classList.contains('on'),undefined,{timeout:60000});
  await page.evaluate(()=>{
    const style=document.createElement('style');style.id='review-timing';style.textContent='*{transition:none!important;animation:none!important}';document.head.appendChild(style);
    __game.clock.stop();__game.running=false;__game._govDone=true;
  });
  const report=[];
  for(const {spec:{id}} of FLEET){
    await page.evaluate(id=>{
      const g=__game;g.selectVessel(id);g.startGame('free');g.advance(5);g.running=false;g.hud.show(false);g.screens.hideAll();
    },id);
    const frames=[];
    for(const [name,theta,phi,radius] of [['quarter',-.72,1.15,1.12],['side',Math.PI,1.45,1.00],['top',Math.PI,.22,1.34]]){
      const data=await page.evaluate(({theta,phi,radius})=>{
        const g=__game;g.rig.setMode('orbit');g.rig.theta=theta;g.rig.phi=phi;g.rig.radius=g.vessel.length*radius;g.rig._snap=true;g.rig.update(0,g.shipMesh,g.field,g.tsunami.dir);g.render();
        return {camera:g.camera.position.toArray(),origin:g.shipMesh.position.toArray(),drawCalls:g.renderer.info.render.calls,triangles:g.renderer.info.render.triangles,programs:g.renderer.info.programs.length};
      },{theta,phi,radius});
      const path=output+'/models/'+id+'-'+name+'.png';await page.screenshot({path});frames.push({name,path,...data});
    }
    const details=await page.evaluate(()=>({id:__game.vesselId,mounts:__game.shipMesh.userData.weapons.mounts.length,aircraft:__game.activeVessel.aircraft.onDeck,cargo:__game.activeVessel.cargo?.bodies.length??0}));
    report.push({...details,frames});console.log({reviewedModel:id,...details});
  }
  await page.evaluate(()=>document.getElementById('review-timing').remove());
  await writeFile(output+'/model-frames.json',JSON.stringify(report,null,2));return report;
}
