/** Current-candidate audit, run in the documented Ego Node runtime.
 * Layout is read from live DOM. The only synthetic geometry is a labelled
 * platform input injected into the same ViewportBoundary used by gameplay.
 */
import { writeFile, readFile, mkdir, readdir, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {FLEET} from '../src/fleet.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const sizes = [[320,568],[375,667],[414,736],[375,812],[414,896],[360,780],[390,844],[393,852],[430,932],[402,874],[440,956],[360,640],[360,800],[412,915],[344,882],[673,841]];
const defaultOutput = root + 'qa/2026-10-02/realism/mobile/';
const zero = {top:0,right:0,bottom:0,left:0};
export const mobileVariants = sizes.flatMap(([width,height]) => [
  {name:`${width}x${height}-portrait`,width,height,insets:zero,holes:[],source:'Chromium CSS viewport emulation; system safe-area values unavailable'},
  ...['left','right'].map(direction => ({name:`${height}x${width}-landscape-${direction}`,width:height,height:width,insets:zero,holes:[],source:'Chromium CSS viewport emulation; system safe-area values unavailable'})),
]).concat([
  {name:'synthetic-island-left',width:852,height:393,insets:{top:10,right:18,bottom:21,left:59},holes:[],source:'Synthetic asymmetric stress input, not a device measurement'},
  {name:'synthetic-island-right',width:852,height:393,insets:{top:10,right:59,bottom:21,left:18},holes:[],source:'Synthetic asymmetric stress input, not a device measurement'},
  {name:'synthetic-android-hole',width:412,height:915,insets:{top:32,right:10,bottom:26,left:8},holes:[{left:298,top:38,right:328,bottom:68}],source:'Synthetic internal occlusion and edge insets, not a device measurement'},
]);
async function sourceHashes() {
  const files=['index.html','tools/mobile-ui-audit.mjs',...(await readdir(root+'src')).filter(f=>f.endsWith('.js')).map(f=>'src/'+f)];
  return Object.fromEntries(await Promise.all(files.sort().map(async file => [file,createHash('sha256').update(await readFile(root+file)).digest('hex')])));
}
const sameHashes=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const gameHashes=hashes=>Object.fromEntries(Object.entries(hashes).filter(([file])=>file!=='tools/mobile-ui-audit.mjs'));
async function applySurface(page, variant) {
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:variant.width,height:variant.height,deviceScaleFactor:1,mobile:true});
  await page.evaluate(v=>{
    window.__viewport.setSource(()=>({left:0,top:0,width:innerWidth,height:innerHeight,insets:v.insets,occlusions:v.holes,source:v.source}));
  },variant);
}
/** Test every displayed control and every reachable scrolled control at its
 * actual browser coordinates. A scroll changes the tested view, not the bounds.
 */
function measureCandidate() {
  const boundary=window.__viewport,S={...boundary.rect},surface=boundary.surface;
  const V={left:0,top:0,right:innerWidth,bottom:innerHeight};
  const outer={left:surface.left+surface.insets.left,top:surface.top+surface.insets.top,right:surface.left+surface.width-surface.insets.right,bottom:surface.top+surface.height-surface.insets.bottom};
  const selector='button,.btn,.card:not(.locked),#lever';
  const name=e=>e?.id||e?.dataset.cam||e?.dataset.tier||e?.dataset.ship||e?.dataset.mode||(e?.dataset.panel?'panel:'+e.dataset.panel:null)||(e?.dataset.holdKey?'hold:'+e.dataset.holdKey:null)||(e?.dataset.inputAction?'action:'+e.dataset.inputAction:null)||e?.textContent?.trim().slice(0,50)||null;
  const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const intersects=(a,b)=>a.left<b.right-.1&&a.right>b.left+.1&&a.top<b.bottom-.1&&a.bottom>b.top+.1;
  const inside=(a,b)=>a.left>=b.left-.2&&a.right<=b.right+.2&&a.top>=b.top-.2&&a.bottom<=b.bottom+.2;
  const visible=e=>{for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  const clipFor=e=>{
    let clip={...V};const scroll=[];
    for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){
      const style=getComputedStyle(p),r=rect(p);
      // display:contents contributes children to the box tree but has no
      // principal box of its own: its overflow cannot define a clip/scroller.
      if(style.display==='contents')continue;
      if(/auto|scroll|hidden|clip/.test(style.overflowX)){clip.left=Math.max(clip.left,r.left+p.clientLeft);clip.right=Math.min(clip.right,r.left+p.clientLeft+p.clientWidth);}
      if(/auto|scroll|hidden|clip/.test(style.overflowY)){clip.top=Math.max(clip.top,r.top+p.clientTop);clip.bottom=Math.min(clip.bottom,r.top+p.clientTop+p.clientHeight);}
      if(/auto|scroll/.test(style.overflowY+style.overflowX))scroll.push(p);
    }
    return {clip,scroll};
  };
  const failures=[],controls=[],textBounds=[],gaps=[],testedViews=[];
  const record=(type,detail)=>failures.push({type,...detail});
  if(!inside(S,outer)||surface.occlusions.some(h=>intersects(S,h)))record('invalid-runtime-safe-rectangle',{safe:S,outer});
  const layoutRoot=document.querySelector('.screen:not(.hidden)')||document.getElementById('hud'),layoutBounds=rect(layoutRoot);
  if(['left','right','top','bottom'].some(k=>Math.abs(S[k]-layoutBounds[k])>.2))record('layout-boundary-diverges',{safe:S,layoutBounds});
  const all=[...document.querySelectorAll(selector)].filter(visible);
  const activeAt=(x,y)=>document.elementFromPoint(x,y)?.closest(selector);
  const checkView=label=>{
    const shown=all.map(el=>({el,id:name(el),bounds:rect(el)})).filter(a=>visible(a.el)&&inside(a.bounds,clipFor(a.el).clip));
    testedViews.push({label,ids:shown.map(a=>a.id)});
    for(let i=0;i<shown.length;i++)for(let j=i+1;j<shown.length;j++){
      const a=shown[i],b=shown[j];if(a.el.contains(b.el)||b.el.contains(a.el))continue;
      const dx=Math.max(a.bounds.left-b.bounds.right,b.bounds.left-a.bounds.right,0),dy=Math.max(a.bounds.top-b.bounds.bottom,b.bounds.top-a.bounds.bottom,0),gap=Math.hypot(dx,dy);
      if(intersects(a.bounds,b.bounds))record('overlapping-actions',{ids:[a.id,b.id],view:label});
      else if(gap<7.9)record('action-gap-under-8',{ids:[a.id,b.id],gap,view:label});
      if(gap>=8&&gap<65){
        const mid=(al,ar,bl,br)=>Math.max(al,bl)<=Math.min(ar,br)?(Math.max(al,bl)+Math.min(ar,br))/2:(Math.min(ar,br)+Math.max(al,bl))/2;
        const px=mid(a.bounds.left,a.bounds.right,b.bounds.left,b.bounds.right),py=mid(a.bounds.top,a.bounds.bottom,b.bounds.top,b.bounds.bottom);
        const hit=activeAt(px,py);gaps.push({x:px,y:py,hit:name(hit),ids:[a.id,b.id],view:label});
        if(hit&&(hit===a.el||hit===b.el))record('gap-triggers-adjacent-action',{ids:[a.id,b.id],hit:name(hit),view:label});
      }
    }
  };
  checkView('initial');
  for(const el of all){
    const first=rect(el),originalClip=clipFor(el),saved=originalClip.scroll.map(p=>[p,p.scrollTop,p.scrollLeft]);
    const scrolled=!inside(first,originalClip.clip)&&saved.length>0;
    if(scrolled)el.scrollIntoView({block:'center',inline:'nearest'});
    const r=rect(el),clip=clipFor(el).clip,id=name(el),shortSide=Math.min(r.width,r.height);
    const points=[[.5,.5],[.03,.5],[.97,.5],[.5,.03],[.5,.97]].map(([x,y])=>({x:r.left+r.width*x,y:r.top+r.height*y}));
    const hits=points.map(p=>({point:p,id:name(activeAt(p.x,p.y)),same:activeAt(p.x,p.y)===el}));
    controls.push({id,tag:el.tagName,disabled:!!el.disabled,bounds:r,scrolled,hits});
    if(!Number.isFinite(r.left+r.top+r.width+r.height)||shortSide<=0)record('invalid-control-bounds',{id,bounds:r});
    if(shortSide<47.9)record('touch-target-under-48',{id,shortSide});
    if(!inside(r,S))record('outside-safe-area',{id,bounds:r});
    if(!inside(r,clip))record('unreachable-clipped-control',{id,bounds:r,clip});
    if(surface.occlusions.some(h=>intersects(r,h)))record('system-occlusion',{id});
    if(hits.some(h=>!h.same))record('ambiguous-hit',{id,hits});
    if(scrolled)checkView('reach:'+id);
    for(const [p,y,x] of saved){p.scrollTop=y;p.scrollLeft=x;}
  }
  // Real text line boxes, including dynamic labels, numbers and all existing
  // screen copy. Text in scrolling dialogs must be reachable as well.
  const textSelector='#inst .row .k,#inst .row .v,#shipStatusLabel,#alert .a1,#alert .a2,#dmg .hlbl,#dmgState,#help .kk span,#help .note,#help h3,#anchorStatus,#thrPct,#thrOrder,.touch-note,.screen:not(.hidden) .title,.screen:not(.hidden) .sub,.screen:not(.hidden) h1,.screen:not(.hidden) h2,.screen:not(.hidden) h3,.screen:not(.hidden) p,.screen:not(.hidden) .stat,.screen:not(.hidden) .tag,.screen:not(.hidden) .tip,.screen:not(.hidden) .barmeta span,.screen:not(.hidden) .rgrid .k,.screen:not(.hidden) .rgrid .v,.screen:not(.hidden) .rbig,#pause.on h2,button,.btn';
  const initialText=[];
  for(const el of document.querySelectorAll(textSelector)){
    if(!visible(el)||!el.textContent.trim())continue;
    const original=clipFor(el),saved=original.scroll.map(p=>[p,p.scrollTop,p.scrollLeft]);
    const initialVisible=inside(rect(el),original.clip);
    if(!initialVisible&&saved.length)el.scrollIntoView({block:'center',inline:'nearest'});
    const range=document.createRange();range.selectNodeContents(el);
    const lines=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}));
    const clip=clipFor(el).clip,text=el.textContent.trim().slice(0,120),fontSize=parseFloat(getComputedStyle(el).fontSize);
    textBounds.push({id:name(el),text,lines,fontSize});
    if(initialVisible)initialText.push({el,text,lines});
    if(lines.some(r=>!inside(r,S)||!inside(r,clip)||surface.occlusions.some(h=>intersects(r,h))))record('critical-text-clipped',{text,lines,clip});
    for(const [p,y,x] of saved){p.scrollTop=y;p.scrollLeft=x;}
  }
  for(let i=0;i<initialText.length;i++)for(let j=i+1;j<initialText.length;j++){
    const a=initialText[i],b=initialText[j];
    if(a.el.contains(b.el)||b.el.contains(a.el))continue;
    if(a.lines.some(x=>b.lines.some(y=>intersects(x,y))))record('critical-text-overlap',{texts:[a.text,b.text]});
  }
  const forbidden=[{x:Math.max(0,S.left-2),y:(S.top+S.bottom)/2},{x:Math.min(innerWidth-1,S.right+2),y:(S.top+S.bottom)/2},{x:(S.left+S.right)/2,y:Math.max(0,S.top-2)},{x:(S.left+S.right)/2,y:Math.min(innerHeight-1,S.bottom+2)},...surface.occlusions.map(h=>({x:(h.left+h.right)/2,y:(h.top+h.bottom)/2}))].filter(p=>!boundary.contains(p.x,p.y));
  const forbiddenHits=forbidden.map(p=>({...p,hit:name(activeAt(p.x,p.y))}));
  for(const p of forbiddenHits)if(p.hit)record('forbidden-area-hits-action',p);
  return {viewport:{width:innerWidth,height:innerHeight,visualScale:visualViewport?.scale},surface,safe:S,layoutBounds,controls,textBounds,gaps,forbiddenHits,testedViews,failures:[...new Map(failures.map(f=>[JSON.stringify(f),f])).values()]};
}
function setCandidateState({state,ship}){
    const g=__game;g.running=false;g.paused=false;g.showHelp=false;
    if(g.vessel.id!==ship)g.selectVessel(ship);
    g.mode=state==='mode-random'||state.startsWith('random-')||state.startsWith('meteor-')?'random':'free';
    g.manualNight=state.startsWith('night-');g.screens.setMode(g.mode);
    g.skySys.setStorm(.42,g.mode==='random'||g.manualNight?1:0);g.meteors.reset();
    g.input.release();g.setCamera(state==='walk'?'walk':'orbit');g.input.walkMode=state==='walk';
    g.screens.hideAll();g.hud.show(!['loading','loading-ready','lobby','mode','mode-random','result'].includes(state));g.cockpit.show(false);
    g.phys.anchor.reset();g.tsunami.reset();g.damage.reset();g.activeVessel.station.reset();g.shipMesh.userData.weapons.reset();
    const requestedPanel=state.split('-').at(-1);
    const panel=['helm','weapons','waves','cameras','stats'].includes(requestedPanel)?requestedPanel:state.startsWith('wave:')?'waves':'helm';
    document.getElementById('hud').dataset.panel=panel;
    for(const b of document.querySelectorAll('button[data-panel]'))b.setAttribute('aria-pressed',String(b.dataset.panel===panel));
    if(['loading','loading-ready','lobby','mode','mode-random'].includes(state)){
      g.screens.show(state.startsWith('loading')?'loading':state.startsWith('mode')?'mode':state);
      g.screens.enableEnter(state==='loading-ready');
      if(state==='loading')g.screens.setProgress(57,'装配海洋交互特效');
    } else if(state==='result')g.screens.showResult({title:'舰 体 倾 覆',sub:'大量进水导致储备浮力耗尽，舰体缓慢下沉。',roll:179.9,pitch:89.9,wave:100,time:9999});
    else {
      if(state==='restart'){g.startGame('free');g.running=false;}
      if(state.startsWith('wave:')){g.running=true;g.fireTsunami(state.slice(5));g.running=false;}
      if(state.startsWith('anchor-')){g.phys.anchor.drop(g.phys.position);g.phys.anchor.step(state==='anchor-set'?3:1.2);}
      if(state==='guns-port-weapons')g.shipMesh.userData.weapons.setSide(-1);
      if(state==='guns-salvo-weapons')g.shipMesh.userData.weapons.requestSalvo();
      if(g.vessel.submarine&&(state==='submarine-shore-helm'||state==='submarine-scope-cameras')){g.activeVessel.station.dive();if(state==='submarine-scope-cameras'){g.activeVessel.station.togglePeriscope();g.setCamera('bridge');}}
      if(state.startsWith('meteor-'))g.meteors.launch(g.phys,100,g.time);
      g.paused=state==='pause';g.showHelp=state==='help';
      g.hud.update(.16,g.hudState());
      for(const [id,text] of [['iSpeed',g.vessel.speedUnit==='km/h'?'511.0':'99.9'],['iHdg','359'],['iRoll','179.9°'],['iPitch','89.9°'],['iWave','100.0'],['iRudder','35°']])document.getElementById(id).textContent=text;
      if(state==='stats')document.getElementById('dmgState').textContent='大量进水 · 弃船';
    }
    for(const el of document.querySelectorAll('.wrap,#loading .inner,#help .box,#helmPanel,#controls,#port')){el.scrollTop=0;el.scrollLeft=0;}
}
async function chooseState(page,state,ship){await page.evaluate(setCandidateState,{state,ship});}
async function captureCase(page,output,name,result,shots){
  await page.evaluate(()=>{const g=__game;g.rig.update(0,g.shipMesh,g.field,g.tsunami.dir,0,g.cameraView());g.render();});
  await page.screenshot({path:output+name+'.png'});shots.push(name+'.png');
  await page.evaluate(({result})=>{
    const c=document.createElement('canvas');c.id='audit-debug';c.width=innerWidth;c.height=innerHeight;c.style='position:fixed;inset:0;z-index:200;pointer-events:none';document.body.appendChild(c);
    const x=c.getContext('2d'),s=result.safe;x.fillStyle='rgba(255,60,60,.22)';x.fillRect(0,0,innerWidth,s.top);x.fillRect(0,s.bottom,innerWidth,innerHeight-s.bottom);x.fillRect(0,s.top,s.left,s.bottom-s.top);x.fillRect(s.right,s.top,innerWidth-s.right,s.bottom-s.top);
    for(const h of result.surface.occlusions)x.fillRect(h.left,h.top,h.right-h.left,h.bottom-h.top);
    x.strokeStyle='#50ff9b';for(const c of result.controls.filter(c=>!c.scrolled)){const r=c.bounds;x.strokeRect(r.left,r.top,r.width,r.height);}
    x.font='11px monospace';x.fillStyle='#ff8181';x.fillText('CSS PX / SYNTHETIC SAFE AREA / LIVE HIT BOUNDS',8,12);
  },{result});
  await page.screenshot({path:output+name+'-debug.png'});shots.push(name+'-debug.png');
  await page.evaluate(()=>document.getElementById('audit-debug').remove());
}
async function touchAudit(page,tiers,ships,output){
  const checks=[],taps=[],actions=[];
  await writeFile(output+'mobile-touch-actions.jsonl','');
  await page.evaluate(()=>{
    window.__auditTouchEvents={touches:[],events:[],sequence:0,activePointers(){
      const active=new Map();
      for(const e of this.events){
        if(e.phase!=='consumed')continue;
        if(e.type==='pointerdown'||(e.type==='pointermove'&&active.has(e.pointerId)))active.set(e.pointerId,{pointerId:e.pointerId,x:e.x,y:e.y});
        if(e.type==='pointerup'||e.type==='pointercancel')active.delete(e.pointerId);
      }
      return [...active.values()];
    }};
    window.__auditTouchController=new AbortController();
    for(const type of ['touchstart','touchmove','touchend','touchcancel'])document.addEventListener(type,event=>{
      const evidence=window.__auditTouchEvents;
      evidence.touches=[...event.touches].map(t=>({id:t.identifier,x:t.clientX,y:t.clientY}));
      evidence.events.push({sequence:++evidence.sequence,type,time:performance.now(),touches:evidence.touches});
    },{capture:true,passive:true,signal:window.__auditTouchController.signal});
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture']){
      const recordPointer=(event,phase)=>{
        const evidence=window.__auditTouchEvents,g=__game;
        evidence.events.push({sequence:++evidence.sequence,type,phase,time:performance.now(),pointerId:event.pointerId,
          x:event.clientX,y:event.clientY,buttons:event.buttons,defaultPrevented:event.defaultPrevented,
          target:event.target.id||event.target.dataset.holdKey||event.target.tagName,
          ...(phase==='consumed'?{input:{throttle:g.input.throttle,rudder:g.input.rudder,keys:[...g.input.keys],contacts:g.input.contacts.size},camera:{mode:g.rig.mode,theta:g.rig.theta,phi:g.rig.phi,radius:g.rig.radius}}:{})});
      };
      document.addEventListener(type,event=>recordPointer(event,'capture'),{capture:true,passive:true,signal:window.__auditTouchController.signal});
      // This bubbling listener runs after the candidate target handlers. It
      // proves event consumption without waiting for an expected game value.
      window.addEventListener(type,event=>recordPointer(event,'consumed'),{passive:true,signal:window.__auditTouchController.signal});
    }
  });
  const checkpoint=()=>writeFile(output+'mobile-touch-progress.json',JSON.stringify({checks,taps,actions},null,2));
  const liveTouches=()=>page.evaluate(()=>__auditTouchEvents.activePointers());
  const record=(name,pass,evidence)=>checks.push({name,pass:!!pass,evidence});
  // Chromium rejects a second end/cancel, and can itself cancel contacts on
  // rotation. Gesture termination consumes the actual observed PointerEvent
  // stream. Legacy touchmove has a browser slop threshold and may be absent
  // even when a small pointermove has already reached candidate handlers.
  const dispatch=async(type,touchPoints=[])=>{
    const action={sequence:actions.length+1,type,touchPoints,before:await liveTouches(),beforeEventSequence:await page.evaluate(()=>__auditTouchEvents.sequence)};actions.push(action);
    try{
      if((type==='touchEnd'||type==='touchCancel')&&action.before.length===0)action.outcome='already-released';
      else {
        await page.cdp('Input.dispatchTouchEvent',{type,touchPoints:touchPoints.map((p,i)=>({...p,id:p.id??i+1,radiusX:1,radiusY:1,force:1}))});
        action.outcome='dispatched';
        const changed=type==='touchStart'||type==='touchMove'?
          touchPoints.filter(p=>!action.before.some(old=>Math.hypot(p.x-old.x,p.y-old.y)<.01)):action.before;
        const pointerType={touchStart:'pointerdown',touchMove:'pointermove',touchEnd:'pointerup',touchCancel:'pointercancel'}[type];
        await page.waitForFunction(({first,type,changed})=>{
          const events=__auditTouchEvents.events.filter(e=>e.sequence>first&&e.type===type&&e.phase==='consumed');
          return changed.every(p=>events.some(e=>Math.hypot(e.x-p.x,e.y-p.y)<.5));
        },{first:action.beforeEventSequence,type:pointerType,changed},{timeout:5000});
        await page.waitForFunction(({type,points})=>{
          const contacts=__auditTouchEvents.activePointers();
          return type==='touchEnd'||type==='touchCancel'?contacts.length===0:
            contacts.length===points.length&&points.every(p=>contacts.some(c=>Math.hypot(c.x-p.x,c.y-p.y)<.5));
        },{type,points:touchPoints},{timeout:5000});
        action.consumed=await page.evaluate(first=>__auditTouchEvents.events.filter(e=>e.sequence>first&&e.phase==='consumed'),action.beforeEventSequence);
      }
      action.after=await liveTouches();
      action.legacyTouchSnapshot=await page.evaluate(()=>__auditTouchEvents.touches);
    }catch(error){action.outcome='error';action.error=String(error);throw error;}
    finally{await appendFile(output+'mobile-touch-actions.jsonl',JSON.stringify(action)+'\n');}
  };
  const flush=()=>page.evaluate(()=>{const g=__game;g.input.walkMode=g.rig.mode==='walk';g.hud.update(.16,g.hudState());});
  const point=selector=>page.evaluate(selector=>{
    const el=[...document.querySelectorAll(selector)].find(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');if(!el)throw new Error('Missing current-candidate control: '+selector);
    el.scrollIntoView({block:'center',inline:'nearest'});const r=el.getBoundingClientRect();
    const p={x:r.left+r.width/2,y:r.top+r.height/2};
    if(!window.__viewport.contains(p.x,p.y)||!el.contains(document.elementFromPoint(p.x,p.y)))throw new Error('Control is unreachable: '+selector);
    return {...p,bounds:{left:r.left,top:r.top,width:r.width,height:r.height}};
  },selector);
  const tap=async selector=>{await flush();const p=await point(selector);await dispatch('touchStart',[{x:p.x,y:p.y,id:1}]);await dispatch('touchEnd');await flush();taps.push({selector,point:{x:p.x,y:p.y}});};
  const panel=async name=>{await tap(`button[data-panel="${name}"]`);record('panel-'+name,await page.evaluate(name=>document.getElementById('hud').dataset.panel===name,name),{name});};
  const sample=()=>page.evaluate(()=>{const g=__game;return {ship:g.vessel.id,panel:document.getElementById('hud').dataset.panel,mode:g.rig.mode,gameMode:g.mode,night:g.manualNight,nightValue:g.skySys.night,lights:g.shipMesh.userData.searchlights.lamps.map(l=>l.light.intensity),theta:g.rig.theta,phi:g.rig.phi,radius:g.rig.radius,walkX:g.rig.walkX,walkZ:g.rig.walkZ,walkYaw:g.rig.walkYaw,walkRun:g.rig.walkRun,keys:[...g.input.keys],contacts:g.input.contacts.size,throttle:g.input.throttle,rudder:g.input.rudder,paused:g.paused,help:g.showHelp,anchor:g.phys.anchor.phase,tier:g.tsunami.tier?.id,screen:g.screens.current,time:g.time};});
  const canvasPoints=()=>page.evaluate(()=>{
    const {rect:r}=window.__viewport,canvas=__game.renderer.domElement,pts=[];
    for(let y=r.top+14;y<r.bottom-14;y+=16)for(let x=r.left+14;x<r.right-14;x+=16)if(document.elementFromPoint(x,y)===canvas)pts.push({x,y});
    for(const a of pts)for(const b of pts)if(Math.abs(a.y-b.y)<1&&b.x-a.x>=90&&document.elementFromPoint(a.x+20,a.y+8)===canvas&&document.elementFromPoint(b.x-20,b.y+8)===canvas)return [a,b];
    throw new Error('No reachable Canvas region large enough for multi-touch');
  });
  const test=async(name,run)=>{
    const firstAction=actions.length;
    try{await run();}
    catch(error){
      checks.push({name,pass:false,error:String(error),firstAction,lastAction:actions.length});
      // Cleanup is isolated from the recorded failure; a broken protocol
      // session must not erase all preceding layout and input evidence.
      try{await dispatch('touchCancel');await page.evaluate(()=>__game.input.release());}
      catch(cleanupError){checks.push({name:name+'-cleanup',pass:false,error:String(cleanupError)});}
    }finally{await checkpoint();}
  };
  const exerciseRelease=async(kind,ship)=>{
    await panel('helm');const p=await point('[data-hold-key="a"]');await dispatch('touchStart',[{x:p.x,y:p.y,id:1}]);
    const before=await sample();
    if(kind==='cancel')await dispatch('touchCancel');
    if(kind==='leave'){await dispatch('touchMove',[{x:p.x,y:p.bounds.top-12,id:1}]);}
    if(kind==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    if(kind==='rotate')await applySurface(page,mobileVariants.find(v=>v.name==='393x852-portrait'));
    const after=await sample();record(`${ship}-release-${kind}`,before.keys.includes('a')&&!after.keys.length&&after.contacts===0,{before,after,source:kind==='blur'?'Browser blur event dispatched into candidate release handler':kind==='rotate'?'Actual CDP viewport rotation -> runtime safeareachange':'Actual CDP touch event'});
    await dispatch('touchCancel');
    if(kind==='rotate')await applySurface(page,mobileVariants.find(v=>v.name==='synthetic-island-left'));
  };
  await applySurface(page,mobileVariants.find(v=>v.name==='synthetic-island-left'));
  await page.evaluate(()=>{const g=__game;g.running=false;g.hud.show(false);g.screens.show('loading');g.screens.enableEnter();});
  await test('loading-entry',async()=>{await tap('#enterBtn');const s=await sample();record('loading-entry',s.screen==='lobby',s);});
  for(const ship of ships){
    await test(`${ship}-entry-flow`,async()=>{
      await page.evaluate(()=>{const g=__game;g.running=false;g.paused=false;g.showHelp=false;g.hud.show(false);g.screens.show('lobby');});
      await tap(`[data-ship="${ship}"]`);const selected=await sample();record(`${ship}-selection`,selected.ship===ship,selected);
      await tap('#toMode');record(`${ship}-mode-screen`,(await sample()).screen==='mode',await sample());
      await tap('[data-mode="free"]');
      await page.evaluate(()=>{const g=__game;g.manualNight=false;g.screens.setNight(false,'free');});
      await tap('#nightOption');record(`${ship}-night-option`,(await sample()).night,await sample());
      await tap('#startGame');
      await page.evaluate(()=>__game._govDone=true);
      const s=await sample();record(`${ship}-start`,s.ship===ship&&s.screen===null&&!s.paused&&s.night&&s.lights.every(v=>v>0),s);
    });
    await test(`${ship}-camera-buttons`,async()=>{
      await panel('cameras');
      for(const mode of ['orbit','chase','bridge','deck','cinema','walk']){await tap(`[data-cam="${mode}"]`);const s=await sample();record(`${ship}-camera-${mode}`,s.mode===mode,s);}
      await tap('[data-cam="orbit"]');const before=await sample();await tap('[data-input-action="zoom-in"]');const near=await sample();await tap('[data-input-action="zoom-out"]');const far=await sample();
      record(`${ship}-zoom-buttons`,near.radius<before.radius&&far.radius>near.radius,{before:before.radius,near:near.radius,far:far.radius});
    });
    await test(`${ship}-wave-buttons`,async()=>{
      await panel('waves');for(const tier of tiers){await tap(`[data-tier="${tier}"]`);const s=await sample();record(`${ship}-wave-${tier}`,s.tier===tier,s);}
      await tap('#nightBtn');record(`${ship}-night-toggle-off`,!(await sample()).night,await sample());
      await tap('#nightBtn');record(`${ship}-night-toggle-on`,(await sample()).night,await sample());
      await page.evaluate(()=>__game.tsunami.reset());
    });
    await test(`${ship}-multitouch-helm-orbit`,async()=>{
      await panel('helm');const hold=await point('[data-hold-key="a"]'),[look]=await canvasPoints(),before=await sample();
      await dispatch('touchStart',[{x:hold.x,y:hold.y,id:1},{...look,id:2}]);
      await dispatch('touchMove',[{x:hold.x,y:hold.y,id:1},{x:look.x+20,y:look.y+8,id:2}]);
      await page.evaluate(()=>__game.input.update(.1));const during=await sample();await dispatch('touchEnd');const after=await sample();
      record(`${ship}-multitouch-helm-orbit`,during.keys.includes('a')&&during.rudder<0&&Math.abs(during.theta-before.theta)>.01&&!after.keys.length&&after.contacts===0,{before,during,after});
    });
    await test(`${ship}-multitouch-helm-throttle`,async()=>{
      const hold=await point('[data-hold-key="d"]'),lever=await point('#lever');
      await dispatch('touchStart',[{x:hold.x,y:hold.y,id:1},{x:lever.x,y:lever.bounds.top+lever.bounds.height*.5,id:2}]);
      const samples=[];
      for(const f of [.1,.9]){await dispatch('touchMove',[{x:hold.x,y:hold.y,id:1},{x:lever.x,y:lever.bounds.top+lever.bounds.height*f,id:2}]);samples.push({fraction:f,expected:-.35+(1-f)*1.35,...await sample()});}
      await dispatch('touchCancel');const after=await sample();
      record(`${ship}-multitouch-helm-throttle`,samples.every(s=>s.keys.includes('d')&&Math.abs(s.throttle-s.expected)<.025)&&!after.keys.length,{samples,after});
      await tap('[data-input-action="stop"]');record(`${ship}-stop-button`,(await sample()).throttle===0,await sample());
    });
    await test(`${ship}-weapons`,async()=>{
      const capability=await page.evaluate(()=>({main:__game.shipMesh.userData.weapons.hasMain,ciws:__game.shipMesh.userData.weapons.hasCIWS,salvo:__game.shipMesh.userData.weapons.hasSalvo}));
      if(capability.main||capability.ciws)await panel('weapons');
      if(capability.salvo)await page.waitForFunction(()=>__game.shipMesh.userData.weapons.mounts.filter(m=>m.spec.type!=='ciws'&&m.spec.operable!==false&&(!m.spec.side||m.spec.side===__game.shipMesh.userData.weapons.selectedSide)).every(m=>m.aligned),undefined,{timeout:20000});
      if(capability.main){
        const count=()=>page.evaluate(()=>__game.shipMesh.userData.weapons.mounts.find(m=>m.spec.type==='main').shots);
        const before=await count();await tap('#mainFireBtn');const after=await count();record(`${ship}-main-gun-touch`,after>before,{before,after});
      }
      if(capability.ciws){
        const p=await point('#ciwsFireBtn'),helm=await point('[data-hold-key="a"]');
        await dispatch('touchStart',[{x:p.x,y:p.y,id:1},{x:helm.x,y:helm.y,id:2}]);
        await page.waitForFunction(()=>__game.shipMesh.userData.weapons.mounts.some(m=>m.spec.type==='ciws'&&m.shots>0));
        const during=await sample();await dispatch('touchCancel');const after=await sample();
        record(`${ship}-ciws-helm-multitouch`,during.keys.includes('v')&&during.keys.includes('a')&&!after.keys.length,{during,after});
      }
      record(`${ship}-weapon-capabilities`,await page.evaluate(()=>document.getElementById('mainFireBtn').hidden===!__game.shipMesh.userData.weapons.hasMain&&document.getElementById('ciwsFireBtn').hidden===!__game.shipMesh.userData.weapons.hasCIWS),capability);
    });
    if(['yamato','iowa'].includes(ship))await test(`${ship}-broadside-controls`,async()=>{
      await panel('weapons');
      for(const side of [-1,1]){
        const before=await page.evaluate(()=>__game.shipMesh.userData.weapons.mounts.reduce((n,m)=>n+m.shots,0));
        await tap(side<0?'#portGunsBtn':'#starboardGunsBtn');await tap('#salvoBtn');
        await page.waitForFunction(n=>!__game.shipMesh.userData.weapons.salvoPending&&__game.shipMesh.userData.weapons.mounts.reduce((v,m)=>v+m.shots,0)>n,before,{timeout:25000});
        record(`${ship}-salvo-${side}`,await page.evaluate(side=>__game.shipMesh.userData.weapons.selectedSide===side,side));
      }
      const aim=await page.evaluate(()=>__game.shipMesh.userData.weapons.aimOffset),p=await point('[data-hold-key="j"]');
      await dispatch('touchStart',[{x:p.x,y:p.y,id:1}]);await page.waitForFunction(a=>__game.shipMesh.userData.weapons.aimOffset<a-.03,aim,{timeout:5000});
      await dispatch('touchCancel');record(`${ship}-turret-hold-release`,!(await sample()).keys.length);
      await panel('helm');
    });
    if(ship==='typhoon')await test('typhoon-station-touch',async()=>{
      await panel('helm');await tap('#diveBtn');record('typhoon-dive',await page.evaluate(()=>__game.activeVessel.station.station==='shore'));
      await tap('#periscopeBtn');await panel('cameras');await tap('[data-cam="bridge"]');
      await page.waitForFunction(()=>!document.getElementById('periscopeView').hidden);record('typhoon-scope',await page.evaluate(()=>__game.activeVessel.station.mirrorView(__game.rig.mode)));
      await panel('helm');await tap('#boardBtn');record('typhoon-board',await page.evaluate(()=>__game.activeVessel.station.station==='aboard'&&!__game.activeVessel.station.periscope));
    });
    await test(`${ship}-pinch`,async()=>{
      // Radius zoom belongs to orbit/chase/cinema; the submarine station
      // flow intentionally leaves the fixed bridge/periscope camera active.
      await panel('cameras');await tap('[data-cam="orbit"]');await panel('helm');
      const [a,b]=await canvasPoints(),before=await sample();await dispatch('touchStart',[{...a,id:1},{...b,id:2}]);
      await dispatch('touchMove',[{x:a.x+20,y:a.y,id:1},{x:b.x-20,y:b.y,id:2}]);const during=await sample();await dispatch('touchEnd');
      record(`${ship}-pinch`,during.radius>before.radius&&during.contacts===2,{before,during,after:await sample()});
    });
    for(const kind of ['cancel','leave','blur','rotate'])await test(`${ship}-release-${kind}`,()=>exerciseRelease(kind,ship));
    for(const kind of ['blur','rotate'])await test(`${ship}-lever-release-${kind}`,async()=>{
      await panel('helm');const p=await point('#lever');
      await dispatch('touchStart',[{x:p.x,y:p.y,id:1}]);const before=await sample();
      const pointerId=await page.evaluate(()=>__auditTouchEvents.events.filter(e=>e.type==='pointerdown').at(-1).pointerId);
      if(kind==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
      else await applySurface(page,mobileVariants.find(v=>v.name==='393x852-portrait'));
      const nativeContacts=await liveTouches();let moveSource='Actual CDP touchMove';
      if(nativeContacts.length)await dispatch('touchMove',[{x:p.x,y:p.bounds.top+p.bounds.height*.1,id:1}]);
      else {
        // Rotation can terminate the browser's touch sequence. A new native
        // touchMove would be invalid protocol, so explicitly replay a stale
        // PointerEvent to prove the lever discarded its old owner as well.
        moveSource='Synthetic stale PointerEvent after observed native touch cancellation';
        await page.evaluate(({pointerId,p})=>document.getElementById('lever').dispatchEvent(new PointerEvent('pointermove',{pointerId,pointerType:'touch',clientX:p.x,clientY:p.bounds.top+p.bounds.height*.1,bubbles:true})),{pointerId,p});
      }
      const after=await sample();await dispatch('touchCancel');
      record(`${ship}-lever-release-${kind}`,Math.abs(after.throttle-before.throttle)<1e-9,{before,after,nativeContacts,moveSource});
      if(kind==='rotate')await applySurface(page,mobileVariants.find(v=>v.name==='synthetic-island-left'));
    });
    await test(`${ship}-walk`,async()=>{
      await panel('cameras');await tap('[data-cam="walk"]');await panel('helm');
      const hold=await point('[data-hold-key="w"]'),[look]=await canvasPoints(),before=await sample();
      await dispatch('touchStart',[{x:hold.x,y:hold.y,id:1},{...look,id:2}]);await dispatch('touchMove',[{x:hold.x,y:hold.y,id:1},{x:look.x+20,y:look.y+8,id:2}]);
      await page.waitForFunction(()=>__game.rig.walkVX!==0||__game.rig.walkVZ!==0,undefined,{timeout:5000});
      const during=await sample();await dispatch('touchEnd');await tap('[data-input-action="run"]');const after=await sample();
      record(`${ship}-walk`,during.keys.includes('w')&&Math.hypot(during.walkX-before.walkX,during.walkZ-before.walkZ)>.001&&Math.abs(during.walkYaw-before.walkYaw)>.01&&after.walkRun!==before.walkRun&&!after.keys.length,{before,during,after});
      await panel('cameras');await tap('[data-cam="orbit"]');await panel('helm');
    });
    await test(`${ship}-pause-help-reset`,async()=>{
      await tap('#utility [data-input-action="help"]');const help=await sample();record(`${ship}-help-open`,help.help,help);
      await tap('#help [data-input-action="help"]');record(`${ship}-help-close`,!(await sample()).help,await sample());
      await tap('#utility [data-input-action="pause"]');const pause=await sample();record(`${ship}-pause`,pause.paused,pause);
      await tap('#pause [data-input-action="reset"]');const reset=await sample();record(`${ship}-pause-reset`,reset.paused&&reset.throttle===0&&reset.anchor==='stowed',reset);
      await tap('#btnResume');record(`${ship}-resume`,!(await sample()).paused,await sample());
    });
    await test(`${ship}-anchor-three-seconds`,async()=>{
      await panel('helm');const before=await sample(),wallStart=Date.now();await tap('#anchorBtn');const lowering=await sample();
      await page.waitForFunction(()=>__game.phys.anchor.elapsed>=2.5,undefined,{timeout:15000});
      const near=await page.evaluate(()=>({phase:__game.phys.anchor.phase,elapsed:__game.phys.anchor.elapsed,text:document.getElementById('anchorStatus').textContent}));
      await page.waitForFunction(()=>__game.phys.anchor.phase==='set',undefined,{timeout:15000});await flush();
      const done=await page.evaluate(()=>({phase:__game.phys.anchor.phase,elapsed:__game.phys.anchor.elapsed,text:document.getElementById('anchorStatus').textContent,time:__game.time}));
      record(`${ship}-anchor-three-seconds`,lowering.anchor==='lowering'&&near.phase==='lowering'&&done.elapsed===3&&done.text==='锚链已经到底',{before,lowering,near,done,wallMilliseconds:Date.now()-wallStart});
      await tap('#anchorBtn');record(`${ship}-weigh-anchor`,(await sample()).anchor==='stowed',await sample());
    });
    await test(`${ship}-forbidden-touch`,async()=>{
      await applySurface(page,mobileVariants.find(v=>v.name==='synthetic-android-hole'));
      const points=await page.evaluate(()=>{const v=__viewport;return [{x:2,y:innerHeight/2},...v.surface.occlusions.map(h=>({x:(h.left+h.right)/2,y:(h.top+h.bottom)/2}))];});
      const before=await sample();
      for(const p of points){
        await dispatch('touchStart',[{...p,id:1}]);await dispatch('touchMove',[{x:p.x+5,y:p.y+5,id:1}]);const during=await sample();
        const actionKeys=['panel','mode','theta','phi','radius','walkYaw','walkRun','throttle','paused','help','anchor','tier','screen'];
        record(`${ship}-forbidden-contact`,during.contacts===0&&!during.keys.length&&actionKeys.every(key=>during[key]===before[key]),{point:p,before,during,actionKeys});await dispatch('touchEnd');
        const after=await sample();record(`${ship}-forbidden-release`,after.contacts===0&&!after.keys.length&&actionKeys.every(key=>after[key]===before[key]),{point:p,before,after,actionKeys});
      }
      await applySurface(page,mobileVariants.find(v=>v.name==='synthetic-island-left'));
    });
    await test(`${ship}-result-and-return-flows`,async()=>{
      const result=()=>page.evaluate(()=>{const g=__game;g.running=false;g.hud.show(false);g.screens.showResult({title:'舰 体 倾 覆',sub:'大量进水导致储备浮力耗尽，舰体缓慢下沉。',roll:179.9,pitch:89.9,wave:30,time:9999});});
      await result();await tap('#againBtn');record(`${ship}-result-restart`,(await sample()).screen===null,await sample());
      await tap('#utility [data-input-action="pause"]');await tap('#btnBackLobby');record(`${ship}-pause-return-lobby`,(await sample()).screen==='lobby',await sample());
      await tap('#toMode');await tap('#backLobby');record(`${ship}-mode-back-lobby`,(await sample()).screen==='lobby',await sample());
      await result();await tap('#toLobbyBtn');record(`${ship}-result-return-lobby`,(await sample()).screen==='lobby',await sample());
    });
    await test(`${ship}-random-mode`,async()=>{
      await tap('#toMode');await tap('[data-mode="random"]');
      record(`${ship}-random-night-automatic`,await page.evaluate(()=>document.getElementById('nightOption').disabled&&document.getElementById('nightOption').textContent==='昼夜自动交替'));
      await tap('#startGame');const started=await sample();record(`${ship}-random-start`,started.gameMode==='random'&&started.screen===null,started);
      await panel('waves');const before=await sample();
      for(const tier of tiers)await tap(`[data-tier="${tier}"]`);
      const blocked=await sample();record(`${ship}-random-manual-waves-blocked`,blocked.tier===before.tier&&await page.evaluate(()=>document.getElementById('nightBtn').hidden&&[...document.querySelectorAll('[data-tier]')].every(b=>b.disabled)),{before,blocked});
      await panel('helm');
      await page.evaluate(()=>{const g=__game,random=Math.random;g.randomSea.nightTarget=1;g.randomSea.nextEventAt=g.time;try{Math.random=()=>.5;g.advance(1/60);}finally{Math.random=random;}});
      record(`${ship}-random-meteor-warning`,await page.evaluate(()=>__game.meteors.active&&document.getElementById('alertT').textContent==='陨石来袭'));
      if(await page.evaluate(()=>__game.shipMesh.userData.weapons.hasCIWS)){await panel('weapons');}
      if(await page.evaluate(()=>__game.shipMesh.userData.weapons.hasCIWS))for(const kind of ['blur','rotate']){
        const cannon=await point('#ciwsFireBtn'),helm=await point('[data-hold-key="a"]');
        await dispatch('touchStart',[{x:cannon.x,y:cannon.y,id:1},{x:helm.x,y:helm.y,id:2}]);const held=await sample();
        if(kind==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
        else await applySurface(page,mobileVariants.find(v=>v.name==='393x852-portrait'));
        const released=await sample();record(`${ship}-random-ciws-${kind}-release`,held.keys.includes('v')&&held.keys.includes('a')&&!released.keys.length&&released.contacts===0,{held,released});
        await dispatch('touchCancel');if(kind==='rotate')await applySurface(page,mobileVariants.find(v=>v.name==='synthetic-island-left'));
      }
      await tap('#utility [data-input-action="pause"]');const paused=await sample();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const frozen=await sample();record(`${ship}-random-pause-clock`,frozen.paused&&frozen.time===paused.time,{paused,frozen});
      await tap('#pause [data-input-action="reset"]');
      record(`${ship}-random-reset-clear`,await page.evaluate(()=>!__game.meteors.active&&__game.field.packets.length===0&&__game.shipMesh.userData.weapons.tracers.bullets.length===0));
      await tap('#btnBackLobby');
    });
  }
  await page.evaluate(()=>{__game.paused=true;__game.hud.update(.16,__game.hudState());});
  const browserEvents=await page.evaluate(()=>{__auditTouchController.abort();return __auditTouchEvents.events;});
  return {checks,taps,actions,browserEvents,passed:checks.every(c=>c.pass),limitations:['Blur is an explicitly dispatched browser event, not an observed mobile OS app-switch. Physical background/foreground lifecycle remains unverified.','If native rotation cancels the old touch sequence, lever ownership is additionally checked by an explicitly labelled stale PointerEvent replay.']};
}
async function prepareCandidate(page){
  await page.events();
  await page.cdp('Page.bringToFront');await page.cdp('Emulation.setFocusEmulationEnabled',{enabled:true});await page.cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.goto('http://127.0.0.1:8765/index.html');
  await page.waitForFunction(()=>document.getElementById('enterBtn')?.classList.contains('on'),undefined,{timeout:120000});
  return page.evaluate(()=>{
    const g=__game;g.running=false;g._govDone=true;
    const style=document.createElement('style');style.id='audit-timing';style.textContent='*{transition:none!important;animation:none!important}';document.head.appendChild(style);
    return {userAgent:navigator.userAgent,viewportMeta:document.querySelector('meta[name=viewport]').content,devicePixelRatio,safeAreaSource:__viewport.surface,canvas:g.renderer.domElement.getBoundingClientRect().toJSON(),touchPoints:navigator.maxTouchPoints};
  });
}
export async function auditMobile(task,{pageLabel='p1',output=defaultOutput,variants=mobileVariants,capture=true}={}){
  if(!output.endsWith('/'))output+='/';await mkdir(output,{recursive:true});
  const page=task.page(pageLabel),hashes=await sourceHashes(),provenance=await prepareCandidate(page);
  const {tiers,ships}=await page.evaluate(()=>({tiers:[...document.querySelectorAll('[data-tier]')].map(e=>e.dataset.tier),ships:[...document.querySelectorAll('#shipCards .card:not(.locked)')].map(e=>e.dataset.ship)}));
  const requiredCoverage={tiers:JSON.stringify([...tiers].sort())===JSON.stringify(['broad','large','rogue']),ships:JSON.stringify([...ships].sort())===JSON.stringify(FLEET.map(e=>e.spec.id).sort())};
  const states=['loading','loading-ready','lobby','mode','mode-random','helm','weapons','waves','cameras','stats','walk',...tiers.map(t=>'wave:'+t),'anchor-lowering','anchor-set','help','pause','result','restart','night-helm','night-waves','random-helm','random-waves','meteor-helm','meteor-stats','guns-port-weapons','guns-salvo-weapons','submarine-shore-helm','submarine-scope-cameras'];
  const shotCases=new Set(['320x568-portrait:carrier:helm','320x568-portrait:tanker:lobby','320x568-portrait:carrier:result','375x812-portrait:carrier:helm','synthetic-island-left:carrier:helm','synthetic-island-right:tanker:wave:large','synthetic-android-hole:carrier:waves','673x841-portrait:tanker:help','568x320-landscape-left:carrier:pause','390x844-portrait:tanker:wave:broad','393x852-portrait:carrier:walk','320x568-portrait:carrier:cameras','320x568-portrait:tanker:stats']);
  for(const key of ['320x568-portrait:destroyer:helm','568x320-landscape-left:battleship:helm','393x852-portrait:pilot:helm','synthetic-android-hole:destroyer:lobby'])shotCases.add(key);
  for(const key of ['320x568-portrait:carrier:mode-random','320x568-portrait:pilot:night-waves','375x812-portrait:destroyer:night-helm','synthetic-island-left:carrier:meteor-helm','synthetic-island-right:battleship:night-helm','synthetic-android-hole:destroyer:meteor-stats','568x320-landscape-left:carrier:random-waves'])shotCases.add(key);
  for(const key of ['320x568-portrait:yamato:guns-port-weapons','568x320-landscape-left:iowa:guns-salvo-weapons','375x812-portrait:typhoon:submarine-shore-helm','synthetic-island-right:typhoon:submarine-scope-cameras','synthetic-android-hole:spirit:helm'])shotCases.add(key);
  const cases=[],shots=[];await writeFile(output+'mobile-layout-cases.jsonl','');
  for(let i=0;i<variants.length;i++){
    const v=variants[i];await applySurface(page,v);
    const firstCase=cases.length;
    const batch=await page.evaluate(({ships,states,setState,measure})=>{
      const choose=(0,eval)('('+setState+')'),read=(0,eval)('('+measure+')'),cases=[];
      for(const ship of ships)for(const state of states){choose({state,ship});cases.push({ship,state,...read()});}
      return cases;
    },{ships,states,setState:setCandidateState.toString(),measure:measureCandidate.toString()});
    for(const result of batch){
      const {ship,state}=result;cases.push({name:v.name,source:v.source,...result});
      if(capture&&shotCases.has(`${v.name}:${ship}:${state}`)){await chooseState(page,state,ship);await captureCase(page,output,`${v.name}-${ship}-${state.replace(':','-')}`,result,shots);}
    }
    await appendFile(output+'mobile-layout-cases.jsonl',cases.slice(firstCase).map(c=>JSON.stringify(c)).join('\n')+'\n');
    if((i+1)%4===0)console.log({mobileViewports:i+1,total:variants.length,cases:cases.length,failingCases:cases.filter(c=>c.failures.length).length});
    await writeFile(output+'mobile-ui-progress.json',JSON.stringify({viewports:i+1,total:variants.length,cases:cases.length,lastViewport:v.name}));
  }
  const counts={};for(const c of cases)for(const f of c.failures)counts[f.type]=(counts[f.type]||0)+1;
  const layoutReport={status:'incomplete',phase:'layout-complete-touch-pending',generatedAt:new Date().toISOString(),hashes,provenance,coverage:{deviceGroups:16,viewportCases:variants.length,stateCases:cases.length,states,ships,tiers,requiredCoverage},shots,failures:counts,cases};
  await writeFile(output+'mobile-layout-audit.json',JSON.stringify(layoutReport,null,2));
  await writeFile(output+'mobile-ui-audit.json',JSON.stringify(layoutReport,null,2));
  console.log({mobilePhase:'layout-complete',cases:cases.length,failures:counts,saved:output+'mobile-layout-audit.json'});
  await writeFile(output+'mobile-touch-progress.json',JSON.stringify({checks:[],taps:[],actions:[]}));
  let touch;
  try{touch=await touchAudit(page,tiers,ships,output);}
  catch(error){
    const progress=JSON.parse(await readFile(output+'mobile-touch-progress.json','utf8'));
    touch={...progress,passed:false,fatalError:String(error)};
    console.log({mobilePhase:'touch-fatal',error:String(error),preservedChecks:touch.checks.length});
  }
  await writeFile(output+'mobile-touch-audit.json',JSON.stringify(touch,null,2));
  const events=(await page.events()).filter(e=>e.method==='Runtime.exceptionThrown'||(e.method==='Log.entryAdded'&&e.params?.entry?.level==='error'));
  await page.evaluate(()=>{document.getElementById('audit-timing').remove();__viewport.resetSource();});
  const finalHashes=await sourceHashes(),unchanged=sameHashes(hashes,finalHashes);
  const failed=cases.some(c=>c.failures.length)||!touch.passed||events.length>0||Object.values(requiredCoverage).some(v=>!v);
  const report={status:failed?'failed':'incomplete',automatedStatus:failed?'failed':unchanged?'passed':'incomplete',platforms:{chromiumEmulation:'pending-visual-review',iOS:'unverified',android:'unverified'},generatedAt:new Date().toISOString(),hashes,finalHashes,sourceUnchanged:unchanged,provenance,coverage:{deviceGroups:16,viewportCases:variants.length,stateCases:cases.length,states,ships,tiers,requiredCoverage},shots,visualReview:null,failures:counts,cases,touch,events,limitations:['No physical iOS/Android device or official simulator is available; actual system safe-area and lifecycle behavior remain unverified.','Synthetic safe areas and occlusions are injected into the real runtime platform boundary; they are not device measurements.','Screenshot generation is not visual inspection. Overall emulation status remains incomplete until each representative screenshot is opened and reviewed.']};
  await writeFile(output+'mobile-ui-audit.json',JSON.stringify(report,null,2));
  console.log({output,status:report.status,automatedStatus:report.automatedStatus,sourceUnchanged:unchanged,coverage:report.coverage,failures:counts,touchFailures:touch.checks.filter(c=>!c.pass),events,shots});
  return report;
}
/** Reuse only an unchanged game's completed layout evidence. The old report,
 * screenshots, tool revision and failed touch log remain preserved; the new
 * touch run has its own directory and explicit source/tool provenance. */
export async function verifyMobileTouch(task,{pageLabel='p1',output=defaultOutput}={}){
  if(!output.endsWith('/'))output+='/';
  const report=JSON.parse(await readFile(output+'mobile-ui-audit.json','utf8'));
  const hashes=await sourceHashes();
  if(!sameHashes(gameHashes(report.hashes),gameHashes(hashes)))throw new Error('Game source changed after layout audit; rerun the full current-candidate audit.');
  if(report.cases.length!==report.coverage.stateCases||report.cases.some(c=>c.failures.length))throw new Error('Only completed, passing layout cases may be reused.');
  const runName='touch-recheck-'+new Date().toISOString().replace(/[:.]/g,'-'),runOutput=output+runName+'/';
  await mkdir(runOutput,{recursive:true});
  await writeFile(runOutput+'prior-mobile-ui-audit.json',JSON.stringify(report,null,2));
  await writeFile(runOutput+'mobile-touch-progress.json',JSON.stringify({checks:[],taps:[],actions:[]}));
  const page=task.page(pageLabel),provenance=await prepareCandidate(page);
  let touch;
  try{touch=await touchAudit(page,report.coverage.tiers,report.coverage.ships,runOutput);}
  catch(error){touch={...JSON.parse(await readFile(runOutput+'mobile-touch-progress.json','utf8')),passed:false,fatalError:String(error)};}
  await writeFile(runOutput+'mobile-touch-audit.json',JSON.stringify(touch,null,2));
  const events=(await page.events()).filter(e=>e.method==='Runtime.exceptionThrown'||(e.method==='Log.entryAdded'&&e.params?.entry?.level==='error'));
  await page.evaluate(()=>{document.getElementById('audit-timing').remove();__viewport.resetSource();});
  const finalHashes=await sourceHashes();
  report.evidenceRuns??={layout:{hashes:report.hashes,generatedAt:report.generatedAt,report:'mobile-layout-audit.json',screenshots:report.shots},touchHistory:[]};
  report.evidenceRuns.touchHistory.push({directory:runName,hashes,finalHashes,provenance,generatedAt:new Date().toISOString(),status:touch.passed?'passed':'failed'});
  report.touch=touch;report.events=events;report.finalHashes=finalHashes;
  report.sourceUnchanged=sameHashes(gameHashes(report.hashes),gameHashes(finalHashes))&&sameHashes(hashes,finalHashes);
  report.automatedStatus=!touch.passed||events.length?'failed':report.sourceUnchanged?'passed':'incomplete';
  report.status=report.automatedStatus==='failed'?'failed':'incomplete';report.platforms.chromiumEmulation='pending-visual-review';
  report.touchRecheck={directory:runName,toolHash:hashes['tools/mobile-ui-audit.mjs'],reason:'PointerEvent consumption is authoritative; legacy touchmove may be absent below browser movement threshold. Layout code and game sources were unchanged.'};
  await writeFile(output+'mobile-ui-audit.json',JSON.stringify(report,null,2));
  console.log({status:report.status,automatedStatus:report.automatedStatus,reusedLayoutCases:report.cases.length,sourceUnchanged:report.sourceUnchanged,touchChecks:touch.checks.length,touchFailures:touch.checks.filter(c=>!c.pass),events,touchRecheck:report.touchRecheck});
  return report;
}
export async function finalizeMobileAudit(output=defaultOutput,{reviewedShots,notes}={}){
  if(!output.endsWith('/'))output+='/';
  const report=JSON.parse(await readFile(output+'mobile-ui-audit.json','utf8'));
  if(!Array.isArray(reviewedShots)||!notes)throw new Error('Provide actually opened reviewedShots and concrete visual inspection notes.');
  const missing=report.shots.filter(s=>!reviewedShots.includes(s));
  report.visualReview={reviewedAt:new Date().toISOString(),reviewedShots,notes,missing};
  const currentHashes=await sourceHashes(),lastRunHashes=report.evidenceRuns?.touchHistory.at(-1)?.hashes??report.hashes;
  report.sourceUnchanged=report.sourceUnchanged&&sameHashes(gameHashes(report.hashes),gameHashes(currentHashes))&&sameHashes(lastRunHashes,currentHashes);
  const failed=report.automatedStatus==='failed',complete=!missing.length&&report.sourceUnchanged&&report.automatedStatus==='passed'&&report.coverage.viewportCases===51;
  report.status=failed?'failed':complete?'passed':'incomplete';
  report.platforms.chromiumEmulation=report.status;
  await writeFile(output+'mobile-ui-audit.json',JSON.stringify(report,null,2));
  await writeFile(output+'README.md',`# Current-candidate mobile audit\n\nChromium emulation: **${report.status}**. iOS / Android runtime system boundaries: **unverified**.\n\n${report.coverage.viewportCases} viewport cases × ${report.coverage.ships.length} vessels × ${report.coverage.states.length} UI states = ${report.coverage.stateCases} layout cases. ${report.touch.checks.length} actual-input checks.\n\n48 CSS px controls; 8 px action gaps; live text line bounds; unique center/edge hit tests; runtime safe-area injection; CDP multi-touch, throttle, steering, orbit, pinch, deck walking, cancellation, blur-event, viewport rotation, pause/help/reset, and 3-second anchor.\n\nVisual review: ${notes}\n\n${report.limitations.join('\n\n')}\n\nCandidate source unchanged: ${report.sourceUnchanged}. See mobile-ui-audit.json for source hashes, source measurements, failures and per-action evidence.\n`);
  console.log({status:report.status,platforms:report.platforms,sourceUnchanged:report.sourceUnchanged,missing});return report.status;
}
