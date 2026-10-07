import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {COMBAT_FLEET} from '../src/fleet.js';
import {preparePage,installTrace} from './shader-warmup-probe.mjs';
export async function verifyCombatBrowser(page,{output}={}){
 await mkdir(output,{recursive:true});await preparePage(page);
 await page.goto('http://127.0.0.1:8765/index.html?play=1');
 await page.waitForFunction(()=>window.__game?.running&&document.getElementById('enterBtn').classList.contains('on'),undefined,{timeout:120000});
 await page.evaluate(()=>{const g=__game;g._govDone=true;g.clock.stop();g.clock.autoStart=false;g.manualNight=false;});
 const before=await installTrace(page),cases=[];
 try{
  for(let index=0;index<COMBAT_FLEET.length;index++){
   const id=COMBAT_FLEET[index].spec.id;
   await page.evaluate(({id,index,count})=>{
    const g=__game;g.selectVessel(id);const random=Math.random;
    try{Math.random=()=>(index+.1)/count;g.startGame('combat');}finally{Math.random=random;}
    g.hud.show(false);g.cockpit.show(false);g.combat.player.salvoRequested=true;
    g.combat.player.mainAuto=!g.combat.player.profile.salvo;g.combat.lock(g.combat.player,g.combat.enemy);
    if(g.combat.player.missiles)g.combat.fireMissile(g.combat.player);
    g.input.presses.set('qa-ciws','v');
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const context=canvas.getContext('2d',{willReadFrequently:true});
    const rows=[];window.__combatRender={rows,context,canvas};
    __shaderProbe.phase='combat-'+id;
   },{id,index,count:COMBAT_FLEET.length});
   // 135 actual rendered frames per vessel; all five camera modes recur.
   for(let batch=0;batch<45;batch++)await page.evaluate(batch=>{
    const g=__game,{context,canvas,rows}=__combatRender;
    for(let j=0;j<3;j++){
     const mode=['orbit','bridge','deck','chase','cinema'][batch%5];g.setCamera(mode);g.advance(.04);
     g.cockpit.show(false);g.render();context.drawImage(g.renderer.domElement,0,0,160,90);
     const pixels=context.getImageData(0,0,160,90).data;let dark=0;
     for(let i=0;i<pixels.length;i+=4)if(.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2]<12)dark++;
     const camera=g.camera.position,clearance=camera.y-g.field.heightAt(camera.x,camera.z),required={orbit:6,bridge:1.2,deck:1.2,chase:12,cinema:22}[mode];
     rows.push({mode,time:g.combat.time,darkRatio:dark/14400,clearance,required,projectiles:g.combat.projectiles.length,hp:g.combat.actors.map(a=>a.hp),
      finite:g.combat.actors.every(a=>[...a.physics.position.toArray(),...a.physics.quaternion.toArray()].every(Number.isFinite))&&g.combat.projectiles.every(s=>s.position.toArray().every(Number.isFinite)),
      buffersFit:Object.values(g.battleEffects.lines).every(line=>line.geometry.drawRange.count<=line.geometry.attributes.position.count)});
    }
   },batch);
   const trial=await page.evaluate(()=>({id:__game.vesselId,enemy:__game.combat.enemy.spec.id,independent:__game.shipMesh!==__game.combat.enemy.entry.mesh,
     rows:__combatRender.rows,shots:__game.combat.actors.map(a=>a.shots),hits:__game.combat.actors.map(a=>a.hits),calls:__shaderProbe.calls.filter(c=>c.phase==='combat-'+__game.vesselId),errors:__shaderProbe.errors}));
   await page.evaluate(()=>{const g=__game;g.setCamera('orbit');g.rig.theta=.65;g.rig.phi=.75;g.rig._snap=true;g.rig.update(0,g.shipMesh,g.field,g.tsunami.dir,0,g.cameraView());g.render();});
   await page.screenshot({path:output+'/combat-'+id+'.png'});
   await writeFile(output+'/render-'+id+'.json',JSON.stringify(trial,null,2));cases.push(trial);
   console.log({id,enemy:trial.enemy,frames:trial.rows.length,compileCalls:trial.calls.length,dark:trial.rows.filter(r=>r.darkRatio>.2).length,underwater:trial.rows.filter(r=>r.clearance<0).length});
  }
  const after=await page.evaluate(()=>({programs:__shaderProbe.programs(),calls:__shaderProbe.calls,errors:__shaderProbe.errors}));
  const report={at:new Date().toISOString(),before,after,cases};await writeFile(output+'/combat-render.json',JSON.stringify(report,null,2));
  for(const trial of cases){
   assert.equal(trial.enemy,trial.id);assert.ok(trial.independent);assert.equal(trial.calls.length,0);assert.deepEqual(trial.errors,[]);
   assert.ok(trial.rows.every(r=>r.darkRatio<=.2&&r.clearance+1e-6>=r.required&&r.finite&&r.buffersFit),trial.id+' render/camera');
  }
  assert.equal(after.calls.length,0);assert.deepEqual(after.programs,before.programs);return {status:'passed',vessels:cases.length,frames:cases.reduce((n,c)=>n+c.rows.length,0)};
 }finally{await page.evaluate(()=>{__shaderProbe.restore();delete window.__combatRender;__game.input.release();});}
}
