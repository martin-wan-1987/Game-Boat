import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';

// Continue the same large event after the 131-frame summon audit, then run
// the broad wave from approach through recovery. Each sample is a real render.
export async function reviewVoyages(page,output) {
  await page.cdp('Page.bringToFront');
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await page.evaluate(()=>{
    const g=__game;g.running=false;g.paused=false;g._govDone=true;
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    window.__voyageFrames=[];
    window.__sampleVoyage=()=>{
      g.render();context.drawImage(g.renderer.domElement,0,0,160,90);
      const pixels=context.getImageData(0,0,160,90).data;let dark=0;
      for(let i=0;i<pixels.length;i+=4)if(.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2]<12)dark++;
      const cam=g.camera.position,water=g.field.heightAt(cam.x,cam.z),ship=g.phys;
      const row={time:g.time,eventTime:g.time-g.tsunami.tStart,tier:g.tsunami.tier?.id,state:g.tsunami.state,
        mode:g.rig.mode,darkRatio:dark/14400,cameraY:cam.y,waterY:water,under:cam.y<water,
        y:ship.position.y,vy:ship.velocity.y,roll:ship.attitude.roll*180/Math.PI,pitch:ship.attitude.pitch*180/Math.PI,
        damage:g.damage.state,flood:g.damage.flood};
      __voyageFrames.push(row);return row;
    };
  });
  const modes=['orbit','bridge','deck','chase','cinema'];
  let end;
  for(let i=0;i<130;i++) {
    end=await page.evaluate(mode=>{const g=__game;g.setCamera(mode);g.advance(4);return __sampleVoyage();},modes[i%5]);
    if(end.state==='idle')break;
  }
  const large=await page.evaluate(()=>__voyageFrames);
  await writeFile(output+'large-completion.json',JSON.stringify(large,null,2));
  assert.equal(end.state,'idle');assert.ok(large.every(r=>r.darkRatio<=.2&&!r.under));

  await page.evaluate(()=>{const g=__game;g.resetScenario();g.input.setThrottle(1);g.hud.show(false);g.cockpit.show(false);});
  for(let i=0;i<10;i++)await page.evaluate(()=>__game.advance(10));
  const plan=await page.evaluate(()=>{
    const g=__game;g.running=true;g.fireTsunami('broad');g.running=false;window.__voyageFrames=[];
    const f=g.field,extent=g.tsunami.hullExtent(g.phys),distance=g.tsunami.distanceToCrest(g.phys.position);
    const encounter=f.tsuSpeed+g.phys.velocity.x*f.tsuDirX+g.phys.velocity.z*f.tsuDirZ;
    const duration=(distance+f.trailingExtent+extent)/encounter+30;
    return {step:duration/131,crest:distance/encounter,halfWave:f.tsuWidth/encounter,halfHull:extent/encounter,
      beforeY:g.phys.position.y};
  });
  const shots=new Map([
    [Math.round((plan.crest-plan.halfWave*.75)/plan.step),'broad-climb'],
    [Math.round(plan.crest/plan.step),'broad-crest'],
    [Math.round((plan.crest+plan.halfHull)/plan.step),'broad-descent'],
    [Math.round((plan.crest+plan.halfHull+plan.halfWave+3)/plan.step),'broad-dip'],
  ]);
  for(let i=0;i<131;i++) {
    const mode=shots.has(i)?'orbit':modes[Math.floor(i/27)];
    end=await page.evaluate(({mode,shot,step})=>{
      const g=__game;g.setCamera(mode);if(shot)Object.assign(g.rig,{theta:.15,phi:1.27,radius:565,_snap:true});
      g.advance(step);g.cockpit.show(false);return __sampleVoyage();
    },{mode,shot:shots.has(i),step:plan.step});
    if(shots.has(i))await page.screenshot({path:output+shots.get(i)+'.png'});
  }
  const broad=await page.evaluate(()=>__voyageFrames);
  await writeFile(output+'broad-voyage.json',JSON.stringify(broad,null,2));
  assert.equal(end.state,'idle');assert.ok(broad.every(r=>r.darkRatio<=.2&&!r.under));
  assert.ok(broad.every(r=>r.damage==='ok'&&r.flood===0));
  assert.ok(Math.max(...broad.map(r=>r.y))>3);
  // Dip is relative to the ship's pre-wave floating position. A fixed
  // -0.5 m world threshold belonged to the former 1800 m wave; it does not
  // express the requested slight dip after a concentrated wave.
  const peakIndex=broad.reduce((best,r,i)=>r.y>broad[best].y?i:best,0);
  assert.ok(broad.slice(peakIndex+1).some(r=>r.vy<-.7));
  assert.ok(Math.min(...broad.slice(peakIndex+1).map(r=>r.y))<plan.beforeY);
  const summary={large:{frames:large.length,end:large.at(-1)},broad:{frames:broad.length,end:broad.at(-1),
    peak:Math.max(...broad.map(r=>r.y)),dip:Math.min(...broad.map(r=>r.y)),plan},
    dark:[...large,...broad].filter(r=>r.darkRatio>.2).length,underwater:[...large,...broad].filter(r=>r.under).length};
  await writeFile(output+'voyage-summary.json',JSON.stringify(summary,null,2));console.log(summary);
}
