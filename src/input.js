/** Keyboard and Pointer inputs share one press-source map and viewport boundary. */
import { TSUNAMI_TIERS } from './tsunami.js';
import { viewport } from './viewport.js';
const smoothRudder=(value,want,dt)=>value+(want-value)*Math.min(1,dt*(want===0?2.6:3.4));

export class Input {
  constructor(domElement, hooks = {}) {
    this.dom = domElement;
    this.hooks = hooks;
    this.presses = new Map();
    this.contacts = new Map();
    this.throttle = 0;
    this.rudder = 0;
    this.rudderTarget = 0;
    this.enabled = true;
    this._walkMode = false;
    this.hud = document.getElementById('hud');
    this._events = new AbortController();
    this.dom.style.touchAction='none';
    this._bind();
  }
  get keys(){return new Set(this.presses.values());}
  get walkMode(){return this._walkMode;}
  set walkMode(value){
    if(value===this._walkMode)return;
    this.release();this._walkMode=value;
    this.hud.dataset.walking=String(value);
    document.querySelector('.touch-note').textContent=value?'方向键行走 · 拖动画面转头':'按住方向转舵 · 拖动画面观察';
  }
  get interactive(){return this.enabled&&this.hud.classList.contains('on')&&!document.querySelector('#help.on,#pause.on');}
  listen(target,type,callback,options={}){target.addEventListener(type,callback,{...options,signal:this._events.signal});}
  release(){
    this.presses.clear();this.contacts.clear();this.rudderTarget=0;this.rudder=0;
    document.querySelectorAll('[data-hold-key].pressed').forEach(el=>el.classList.remove('pressed'));
  }
  _bind() {
    this.listen(window,'keydown',e=>{
      const k=e.key.toLowerCase();
      if(e.defaultPrevented||([' ','enter'].includes(k)&&e.target.closest?.('button,[role=button]')))return;
      if(!this.enabled||!this.hud.classList.contains('on'))return;
      if(e.repeat){e.preventDefault();return;}
      if(['p','escape','h'].includes(k)){
        this.release();
        if(k==='h')this.hooks.onHelp?.();else this.hooks.onPause?.();
        e.preventDefault();return;
      }
      if(!this.interactive)return;
      this.presses.set(`key:${k}`,k);
      if(this.walkMode&&['w','a','s','d','e'].includes(k)){
        if(k==='e')this.hooks.onToggleRun?.();e.preventDefault();return;
      }
      if(k==='w')this.nudgeThrottle(.05);
      if(k==='s')this.nudgeThrottle(-.05);
      if(k==='x')this.setThrottle(0);
      if(k==='shift')this.setThrottle(1);
      if(k==='control')this.setThrottle(-.35);
      if(k===' '){e.preventDefault();this.hooks.onAnchor?.();}
      const wave=Object.values(TSUNAMI_TIERS).find(tier=>tier.key===k);
      if(wave)this.hooks.onTsunami?.(wave.id);
      if(k==='c')this.hooks.onCamera?.();
      if(k==='r')this.hooks.onReset?.();
      if(k==='m')this.hooks.onMute?.();
      if(k==='f')this.hooks.onMainFire?.();
      if(k==='g')this.hooks.onSalvo?.();
      if(k===',')this.hooks.onGunSide?.(-1);
      if(k==='.')this.hooks.onGunSide?.(1);
      if(k==='t')this.hooks.onPeriscope?.();
      if(k==='b')this.hooks.onMissile?.();
      if(['w','a','s','d'].includes(k))e.preventDefault();
    });
    this.listen(window,'keyup',e=>this.presses.delete(`key:${e.key.toLowerCase()}`));
    this.listen(window,'blur',()=>this.release());
    this.listen(window,'safeareachange',()=>this.release());
    this.listen(document,'visibilitychange',()=>{if(document.hidden)this.release();});
    this.listen(this.dom,'pointerdown',e=>{
      if(!this.interactive||!viewport.contains(e.clientX,e.clientY))return;
      this.contacts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      this.dom.setPointerCapture(e.pointerId);e.preventDefault();
    });
    this.listen(this.dom,'pointermove',e=>{
      if(!this.contacts.has(e.pointerId))return;
      if(!this.interactive||!viewport.contains(e.clientX,e.clientY)){this.contacts.delete(e.pointerId);return;}
      const before=gesture(this.contacts);
      this.contacts.set(e.pointerId,{x:e.clientX,y:e.clientY});
      const after=gesture(this.contacts);
      this.hooks.onOrbit?.(after.x-before.x,after.y-before.y);
      if(before.span>0&&after.span>0)this.hooks.onZoom?.(Math.log(before.span/after.span)/Math.log(1.0016));
      e.preventDefault();
    });
    for(const type of ['pointerup','pointercancel','lostpointercapture'])this.listen(this.dom,type,e=>this.contacts.delete(e.pointerId));
    this.listen(this.dom,'wheel',e=>{if(this.interactive&&viewport.contains(e.clientX,e.clientY))this.hooks.onZoom?.(e.deltaY);},{passive:true});
    this.listen(this.dom,'contextmenu',e=>e.preventDefault());
    for(const el of document.querySelectorAll('[data-hold-key]')){
      el.style.touchAction='none';
      const end=e=>{this.presses.delete(`pointer:${e.pointerId}`);el.classList.remove('pressed');};
      this.listen(el,'pointerdown',e=>{
        if(!this.interactive||!viewport.contains(e.clientX,e.clientY))return;
        this.presses.set(`pointer:${e.pointerId}`,el.dataset.holdKey);el.classList.add('pressed');
        el.setPointerCapture(e.pointerId);e.preventDefault();
      });
      this.listen(el,'pointermove',e=>{
        const r=el.getBoundingClientRect();
        if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)end(e);
      });
      for(const type of ['pointerup','pointercancel','lostpointercapture'])this.listen(el,type,end);
    }
    const actions={pause:()=>this.hooks.onPause?.(),help:()=>this.hooks.onHelp?.(),
      'zoom-in':()=>this.hooks.onZoom?.(-100),'zoom-out':()=>this.hooks.onZoom?.(100),
      stop:()=>this.setThrottle(0),run:()=>this.hooks.onToggleRun?.(),reset:()=>this.hooks.onReset?.(),
      'main-fire':()=>this.hooks.onMainFire?.(),'salvo':()=>this.hooks.onSalvo?.(),
      'port-guns':()=>this.hooks.onGunSide?.(-1),'starboard-guns':()=>this.hooks.onGunSide?.(1),
      periscope:()=>this.hooks.onPeriscope?.(),'aim-reset':()=>this.hooks.onAimReset?.()};
    for(const el of document.querySelectorAll('[data-input-action]'))this.listen(el,'click',()=>{
      if(['pause','help','reset'].includes(el.dataset.inputAction))this.release();
      actions[el.dataset.inputAction]();
    });
    for(const el of document.querySelectorAll('button[data-panel]'))this.listen(el,'click',()=>{
      this.release();this.setPanel(el.dataset.panel);
    });
  }
  setPanel(panel){
    this.hud.dataset.panel=panel;
    for(const b of document.querySelectorAll('button[data-panel]'))b.setAttribute('aria-pressed',String(b.dataset.panel===panel));
  }
  nudgeThrottle(delta){this.setThrottle(this.throttle+delta);}
  setThrottle(value){this.throttle=Math.max(-.35,Math.min(1,value));this.hooks.onThrottle?.(this.throttle);}
  update(dt,response){
    if(!this.interactive||this.walkMode){this.rudder=0;return;}
    const keys=this.keys,want=Number(keys.has('d'))-Number(keys.has('a'));
    this.rudderTarget=want;
    this.rudder=(response??smoothRudder)(this.rudder,want,dt);
  }
  dispose(){this.release();this._events.abort();}
}
function gesture(contacts){
  const points=[...contacts.values()],n=points.length;
  const x=points.reduce((sum,p)=>sum+p.x,0)/n,y=points.reduce((sum,p)=>sum+p.y,0)/n;
  const span=Math.sqrt(points.reduce((sum,p)=>sum+(p.x-x)**2+(p.y-y)**2,0)/n);
  return {x,y,span};
}
