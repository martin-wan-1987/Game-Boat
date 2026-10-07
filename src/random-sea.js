import {rand} from './waves.js';
import {TSUNAMI_TIERS} from './tsunami.js';

/** Scheduling alone changes between modes. The map, waves and body solver
 * stay shared. Deadlines consume the simulation clock, including pauses. */
export class RandomSea {
  constructor(){this.reset();}
  reset(time=0){this.nightTarget=Math.random()<.5?0:1;this.nextPhaseAt=time+rand(45,95);this.nextEventAt=time+rand(12,22);this.events=0;}
  update(time,ship,tsunami,meteors){
    let phaseChanged=false;
    while(time>=this.nextPhaseAt){this.nightTarget=1-this.nightTarget;this.nextPhaseAt+=rand(45,95);phaseChanged=true;}
    let event=null;
    if(time>=this.nextEventAt&&tsunami.state==='idle'&&!meteors.active){
      if(Math.random()<(this.nightTarget?.88:.12)){
        const height=rand(20,100);event={kind:'meteor',...meteors.launch(ship,height,time)};
      }else{
        const height=rand(6,30),tier={...TSUNAMI_TIERS.large,id:'random',label:'随机海啸',hMin:height,hMax:height,danger:Math.min(1,height/30)};
        tsunami.triggerSpec(tier,ship,time,{height,heading:rand(-Math.PI,Math.PI)});event={kind:'wave',height};
      }
      this.nextEventAt=time+rand(18,36);this.events++;
    }
    return {phaseChanged,event};
  }
}
