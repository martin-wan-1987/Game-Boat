/**
 * ui.js — screen flow: loading → lobby → mode → game → result.
 */
import { SHIP } from './carrier-layout.js';
import {FLEET,COMBAT_FLEET} from './fleet.js';
import {combatProfile,COMBAT_RULES} from './combat-rules.js';
import './viewport.js';

const $ = (id) => document.getElementById(id);
const SCREEN_IDS=['loading','lobby','mode','combat','combatLobby','result'];

const LOAD_STEPS = [
  ['初始化渲染管线', '创建 WebGL 上下文与后处理链'],
  ['生成海面波形场', '四向交叉涌浪 · 初始海况 5–6 米'],
  ['构建舰体结构', `${FLEET.length} 种舰船 · ${FLEET.map(e=>e.spec.displayName).join(' / ')}`],
  ['求解浮力模型', '共享水动力求解器 · 逐帧静水压力积分'],
  ['烘焙天空环境', '生成反射立方体贴图与光照探针'],
  ['装配海洋交互特效', '艏波 · 尾流 · 飞沫 · 破浪白沫'],
  ['就绪', '欢迎登舰'],
];

const TIPS = [
  '提示：大幅横摇会让甲板和开口入水，持续进水将损失储备浮力。',
  '提示：前后左右都有浪，保持航速才能保持舵效。',
  '提示：失去航速后，涌浪会把你推成横向 —— 那才是最危险的姿态。',
  '提示：大型海啸不一定会翻船，海况本身带有随机性。',
  '提示：拖动右侧马力拉杆可以无级调节主机功率。',
  '提示：抛锚能定住舰艏方向，但也会让你失去机动能力。',
];


function vesselCard({spec:S,icon,type,description,load,combat},selected,combatMode=false){
      const card=document.createElement('div');card.className='card'+(S.id===selected?' sel':'');card.dataset.ship=S.id;
      const tag=document.createElement('div');tag.className='tag';tag.textContent='可 用';
      const ico=document.createElement('div');ico.className='ico';ico.textContent=icon;
      const title=document.createElement('h3');title.textContent=`${S.displayName} · ${S.designation}`;
      const profile=combatMode?combatProfile({spec:S,combat}):null;
      const body=document.createElement('p');body.textContent=combatMode?[
        profile.mainBarrels?(profile.salvo?'全主炮齐射':'自动舰炮'):null,
        profile.ciwsMounts?'近防炮 · 可调瞄准':null,profile.missiles?`地图锁定 · ${profile.missiles} 发导弹`:null,
      ].filter(Boolean).join(' · '):description;
      const stat=document.createElement('div');stat.className='stat';
      stat.textContent=combatMode?`血量 ${profile.health}\n船长 ${S.length} m · ${type}`:`船长 ${S.length} m · 船宽 ${(S.deckHalfWidth*2).toFixed(1)} m\n吃水 ${S.operatingDraft.toFixed(2)} m · ${type}\n${load}`;
      card.append(tag,ico,title,body,stat);return card;

}

export class Screens {
  constructor(h) {
    this.h = h;
    this.sel = SHIP.id;
    this.mode = 'free';
    $('fleetSummary').textContent=`${FLEET.length} 艘舰船可用。选择下方船型，再选择航行模式。`;
    $('shipCards').replaceChildren(...FLEET.map(e=>vesselCard(e,this.sel)));
    $('combatShipCards').replaceChildren(...COMBAT_FLEET.map(e=>vesselCard(e,this.sel,true)));
    const {gun,salvo,ciws}=COMBAT_RULES;
    $('combatRulesSummary').textContent=`敌舰随机生成。自动炮每分钟${60/gun.interval}发，每发${gun.damage}；战列舰每${salvo.interval}秒全炮齐射，全命中${salvo.damage}。导弹需在战术地图锁定。`;
    $('combatCIWSHelp').textContent=`跟踪敌舰，可上下左右微调。连续射击${ciws.hotSeconds}秒过热，冷却${ciws.coolSeconds}秒恢复。`;
    $('combatHelp').textContent=`对抗：F切换自动炮或战列舰齐射，V按住近防炮，I/K上下、J/L左右微调；在地图锁定敌舰后按B或发射按钮。近防炮连续${ciws.hotSeconds}秒过热，冷却${ciws.coolSeconds}秒。`;
    document.querySelectorAll('.btn,.card:not(.locked)').forEach(el=>{
      el.tabIndex=0;el.setAttribute('role','button');
      el.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}
      });
    });
    this.setVessel(SHIP);
    // lobby
    document.querySelectorAll('#shipCards .card,#combatShipCards .card').forEach((c) => {
      c.addEventListener('click', () => {
        if (c.classList.contains('locked')) return;
        document.querySelectorAll('#shipCards .card,#combatShipCards .card').forEach((x) => x.classList.remove('sel'));
        c.classList.add('sel');
        this.sel = c.dataset.ship;this.h.onVessel?.(this.sel);
        $('selName').textContent = c.querySelector('h3').textContent;
      });
    });
    document.querySelectorAll('#mode .card').forEach((c) => {
      c.addEventListener('click', () => {
        if (c.classList.contains('locked')) return;
        this.setMode(c.dataset.mode);
        if(this.mode==='combat')this.show('combat');
      });
    });

    $('toMode').addEventListener('click', () => this.show('mode'));
    $('chooseAI').addEventListener('click',()=>{
      if(!COMBAT_FLEET.some(e=>e.spec.id===this.sel))this.h.onVessel(COMBAT_FLEET[0].spec.id);
      this.show('combatLobby');
    });
    $('backModes').addEventListener('click',()=>this.show('mode'));
    $('backCombat').addEventListener('click',()=>this.show('combat'));
    $('startCombat').addEventListener('click',()=>this.h.onStart('combat'));
    $('backLobby').addEventListener('click', () => this.show('lobby'));
    $('startGame').addEventListener('click', () => this.mode==='combat'?this.show('combat'):this.h.onStart?.(this.mode));
    $('nightOption').addEventListener('click',()=>this.h.onNight());
    this.setNight(this.h.getNight(),this.mode);
    $('againBtn').addEventListener('click', () => this.h.onAgain?.());
    $('toLobbyBtn').addEventListener('click', () => { this.show('lobby'); this.h.onExit?.(); });
    $('btnResume').addEventListener('click', () => this.h.onResume?.());
    $('btnBackLobby').addEventListener('click', () => { this.show('lobby'); this.h.onExit?.(); });
  }

  setVessel(spec){
    this.sel=spec.id;
    $('shipStatusLabel').textContent=`${spec.name} · 舰况`;
    $('selName').textContent=`${spec.displayName} · ${spec.designation}`;
    for(const c of document.querySelectorAll('#shipCards .card,#combatShipCards .card'))c.classList.toggle('sel',c.dataset.ship===spec.id);
    $('mainFireBtn').hidden=!spec.weapons.some(w=>w.type==='main');
    $('ciwsFireBtn').hidden=!spec.weapons.some(w=>w.type==='ciws');
    $('mainFireBtn').textContent='舰炮 F';$('mainFireBtn').setAttribute('aria-pressed','false');
    $('ciwsFireBtn').textContent='近防炮 V';
    $('weaponPanelBtn').hidden=!spec.weapons.some(w=>w.type==='ciws'||w.type==='main'&&w.operable!==false);
    $('broadsideControls').hidden=!spec.battery?.broadside;
    $('submarineControls').hidden=!spec.submarine;
    $('speedUnit').textContent=spec.speedUnit??'kn';
    document.querySelector('[data-cam="bridge"]').textContent=spec.submarine?'舰岛 / 潜望镜':'舰桥';
  }

  setMode(mode){
    this.mode=mode;
    $('startGame').textContent=mode==='combat'?'选择对抗方式':'启 航';
    for(const c of document.querySelectorAll('#mode .card'))c.classList.toggle('sel',c.dataset.mode===mode);
    this.setNight(this.h.getNight(),mode);
    const combat=mode==='combat';
    $('helpMain').textContent=combat?'切换自动炮 / 请求全主炮齐射':'主炮开火 · 火光、烟雾与后坐力';
    $('helpCIWS').textContent=combat?'长按射击 · 攻击敌舰 / 热量限制':'长按射击 · 自动拦截陨石碎块';
    $('helpSalvo').textContent=combat?'战列舰：全部主炮齐射':'大和、衣阿华：选舷后全炮齐射';
    $('helpAim').textContent=combat?'J/L 左右、I/K 上下微调近防炮':'长按旋转炮塔；逗号 / 句号选左 / 右舷';
  }
  setNight(on,mode){
    const button=$('nightOption');button.setAttribute('aria-pressed',String(on));button.disabled=mode==='random';
    button.textContent=mode==='random'?'昼夜自动交替':on?'黑夜 · 已开启':'黑夜 · 关闭';
  }

  show(id) {
    for (const s of SCREEN_IDS) {
      $(s).classList.toggle('hidden', s !== id);
    }
    this.current = id;
  }

  hideAll() {
    for (const s of SCREEN_IDS) $(s).classList.add('hidden');
    this.current = null;
  }

  setProgress(pct, msg) {
    const p = Math.max(1, Math.min(100, Math.round(pct)));
    $('barFill').style.right = `${100 - p}%`;
    $('barPct').textContent = `${p}%`;
    if (msg) $('barMsg').textContent = msg;
  }

  setTip(t) { $('tip').textContent = t; }

  enableEnter(on = true) { $('enterBtn').classList.toggle('on', on); }

  renderResult({title,sub,fields}){
    $('rTitle').textContent=title;$('rSub').textContent=sub;
    const labels=document.querySelectorAll('#result .rgrid .k'),values=document.querySelectorAll('#result .rgrid .v');
    fields.forEach(([label,value],i)=>{labels[i].textContent=label;values[i].textContent=String(value);});this.show('result');
  }
  showResult({title,sub,roll,pitch,wave,time}){
    this.renderResult({title,sub,fields:[['最大横摇',roll.toFixed(1)+'°'],['最大纵摇',pitch.toFixed(1)+'°'],['最大浪高',wave.toFixed(1)+' m'],['坚持时长',Math.round(time)+' s']]});
  }
  showCombatResult({outcome,player,enemy,time}){
    this.renderResult({title:{victory:'对 战 胜 利',defeat:'对 战 失 败',draw:'双 方 沉 没'}[outcome],
      sub:`随机对手：${enemy.spec.displayName} ${enemy.spec.designation} · ${outcome==='victory'?'敌舰已被击败':outcome==='defeat'?'我舰血量耗尽':'双方血量耗尽'}`,
      fields:[['我舰剩余血量',Math.ceil(player.hp)],['敌舰剩余血量',Math.ceil(enemy.hp)],['造成伤害',Math.round(player.damageDealt)],['对战时长',Math.round(time)+' s']]});
  }

  /** Drives the 1% -> 100% loading bar across `steps`, yielding to the browser. */
  async runLoading(steps) {
    const t0 = performance.now();
    const MIN_MS = 2600;
    const n = steps.length;
    for (let i = 0; i < n; i++) {
      const [name, desc] = LOAD_STEPS[Math.min(i, LOAD_STEPS.length - 1)];
      this.setProgress(((i + 0.15) / n) * 100, name);
      this.setTip(desc);
      await nextFrame();
      const t = performance.now();
      steps[i]();
      await nextFrame();
      const pct = ((i + 1) / n) * 100;
      this.setProgress(pct, name);
      // keep the bar visibly creeping rather than jumping
      const elapsed = performance.now() - t0;
      const want = (elapsed / MIN_MS) * 100;
      if (pct > want) await sleep(60);
    }
    // crawl the last percent so it always reaches exactly 100
    const elapsed = performance.now() - t0;
    if (elapsed < MIN_MS) await sleep(MIN_MS - elapsed);
    this.setProgress(100, '就绪');
    this.setTip(TIPS[Math.floor(Math.random() * TIPS.length)]);
    // boot() enables entry only after compiling and warming the render path.
  }
}

export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
export { TIPS };
