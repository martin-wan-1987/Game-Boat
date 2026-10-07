import * as THREE from 'three';
import {COMBAT_FLEET} from './fleet.js';
import {combatProfile,COMBAT_RULES} from './combat-rules.js';
const $=id=>document.getElementById(id);

/** Geometry allocation follows the maximum lifetime × cadence in the registry. */
export class BattleEffects{
  constructor(){
    this.group=new THREE.Group();this.group.name='Combat projectiles and enemy marker';
    this.lines={};
    for(const kind of ['shell','ciws','missile']){
      const capacity=2*Math.max(...COMBAT_FLEET.map(e=>{
        const p=combatProfile(e),r=kind==='ciws'?COMBAT_RULES.ciws:p.main;
        const secondary=COMBAT_RULES.secondary;
        return kind==='missile'?(p.missiles??0):(Math.ceil(r.range/r.speed/r.interval)+1)*(kind==='ciws'?p.ciwsMounts:p.mainBarrels)+
          (kind==='shell'?(Math.ceil(secondary.range/secondary.speed/secondary.interval)+1)*p.secondaryBarrels:0);
      }));
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(capacity*6),3));
      geometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(capacity*6),3));
      const mesh=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:kind==='ciws'?.8:1,depthWrite:false,toneMapped:false}));
      mesh.frustumCulled=false;geometry.setDrawRange(0,0);this.group.add(mesh);this.lines[kind]=mesh;
    }
    this.marker=new THREE.ArrowHelper(new THREE.Vector3(0,-1,0),new THREE.Vector3(),50,0xff665b,16,10);
    this.group.add(this.marker);this.group.visible=false;
  }
  warmup(on){this.group.visible=on;for(const line of Object.values(this.lines))line.geometry.setDrawRange(0,on?2:0);}
  update(session){
    this.group.visible=!!session;if(!session)return;
    this.marker.position.copy(session.enemy.targetPoint()).add(new THREE.Vector3(0,90,0));this.marker.visible=session.enemy.alive;
    for(const [kind,line] of Object.entries(this.lines)){
      const shots=session.projectiles.filter(s=>s.kind===kind),p=line.geometry.attributes.position,c=line.geometry.attributes.color;
      for(let i=0;i<shots.length;i++){
        const s=shots[i],tail=s.position.clone().addScaledVector(s.velocity,-Math.min(s.age,kind==='missile'?.12:.035));
        p.setXYZ(2*i,...s.position.toArray());p.setXYZ(2*i+1,...tail.toArray());
        const color=new THREE.Color(s.actor.side==='player'?0xffedb3:0xff665b);c.setXYZ(2*i,color.r,color.g,color.b);c.setXYZ(2*i+1,color.r,color.g,color.b);
      }
      p.needsUpdate=c.needsUpdate=true;line.geometry.setDrawRange(0,shots.length*2);
    }
  }
}

export class CombatHUD{
  constructor(sessionSource,onMissile){
    this.sessionSource=sessionSource;this.canvas=$('battleMap');this.context=this.canvas.getContext('2d');
    $('mapEnemy').addEventListener('click',()=>{const s=this.sessionSource();if(s)s.lock(s.player,s.enemy);this.update(s);});
    $('missileBtn').addEventListener('click',onMissile);
  }
  update(session){
    const hud=$('hud');hud.dataset.combat=String(!!session);
    for(const el of document.querySelectorAll('.combat-only'))el.hidden=!session;
    if(!session)return;
    const {player:p,enemy:e}=session;
    for(const [label,actor] of [['player',p],['enemy',e]]){
      $(label+'HP').textContent=String(Math.ceil(actor.hp));
      $(label+'HPBar').max=actor.profile.health;$(label+'HPBar').value=actor.hp;
    }
    $('combatEnemyName').textContent=`敌舰 · ${e.spec.displayName} ${e.spec.designation}`;
    $('combatDistance').textContent=`距离 ${Math.round(p.physics.position.distanceTo(e.physics.position))} m`;
    const mounts=p.battery.mounts.filter(m=>m.spec.type==='main');
    const reload=Math.max(0,...mounts.map(m=>m.lastShot+p.profile.main.interval-session.time));
    $('combatGunStatus').textContent=mounts.length?`${p.profile.salvo?'全炮齐射':'自动舰炮'} · ${reload>.01?'装填 '+reload.toFixed(1)+' 秒':'就绪'}`:'本舰无主炮';
    $('mainFireBtn').textContent=p.profile.salvo?'全炮齐射 F/G':p.mainAuto?'关闭自动炮 F':'开启自动炮 F';
    $('mainFireBtn').setAttribute('aria-pressed',String(p.mainAuto));
    $('mainFireBtn').hidden=!mounts.length;
    $('ciwsFireBtn').hidden=!p.profile.ciwsMounts;
    $('ciwsFireBtn').textContent=p.thermal.locked?'过热 · 冷却中':'按住近防炮 V';
    $('combatCIWSStatus').textContent=p.profile.ciwsMounts?(p.thermal.locked?`过热 / 无弹 · ${p.thermal.remaining.toFixed(1)} 秒恢复`:`近防炮 · 热量 ${Math.round(p.thermal.heat/COMBAT_RULES.ciws.hotSeconds*100)}% · 无限弹药`):'本舰无近防炮';
    $('ciwsAim').hidden=!p.profile.ciwsMounts;
    $('combatAimStatus').textContent=`左右 ${Math.round(p.aimYaw*180/Math.PI)}° · 上下 ${Math.round(p.aimPitch*180/Math.PI)}°`;
    const locked=p.lockedTarget===e&&e.alive;
    $('missileStatus').textContent=p.profile.missiles?`导弹 ${p.missiles} / ${p.profile.missiles} · ${locked?'已锁定':'点地图上的敌舰锁定'}`:'本舰无导弹 · 地图可锁定敌舰';
    $('mapEnemy').setAttribute('aria-pressed',String(locked));$('mapEnemy').disabled=!e.alive;
    $('missileBtn').hidden=!p.profile.missiles;
    const cooldown=Math.max(0,p.lastMissile+COMBAT_RULES.missile.interval-session.time);
    const inRange=p.physics.position.distanceTo(e.physics.position)<=COMBAT_RULES.missile.range;
    $('missileBtn').disabled=!locked||!inRange||p.missiles===0||cooldown>0||!p.alive;
    $('missileBtn').textContent=p.missiles===0?'导弹耗尽':!inRange?'目标超出射程':cooldown>0?'导弹装填中':`发射导弹 · ${COMBAT_RULES.missile.damage}伤害`;
    this.drawMap(session);
  }
  drawMap(session){
    const box=this.canvas.getBoundingClientRect();if(box.width<=0||box.height<=0)return;
    const w=box.width,h=box.height,dpr=devicePixelRatio;
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);}
    const c=this.context;c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,w,h);c.fillStyle='#071c29';c.fillRect(0,0,w,h);
    c.strokeStyle='#274454';c.lineWidth=1;
    for(let i=1;i<4;i++){c.beginPath();c.moveTo(w*i/4,0);c.lineTo(w*i/4,h);c.moveTo(0,h*i/4);c.lineTo(w,h*i/4);c.stroke();}
    const p=session.player.physics,e=session.enemy.physics,delta=e.position.clone().sub(p.position),range=Math.max(1400,delta.length()*1.35);
    const x=w/2+delta.x/(2*range)*(w-48),y=h/2+delta.z/(2*range)*(h-48);
    $('mapEnemy').style.left=`${x-24}px`;$('mapEnemy').style.top=`${y-24}px`;
    c.save();c.translate(w/2,h/2);c.rotate(p.heading);c.fillStyle='#4fd6ff';c.beginPath();c.moveTo(12,0);c.lineTo(-7,-6);c.lineTo(-7,6);c.closePath();c.fill();c.restore();
    c.fillStyle='#b5ccd9';c.font='12px sans-serif';c.fillText('我舰',w/2-14,h/2+23);
  }
}
