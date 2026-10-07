/**
 * ui.js — screen flow: loading → lobby → mode → game → result.
 */
import { SHIP } from './carrier-layout.js';
import {FLEET} from './fleet.js';
import './viewport.js';

const $ = (id) => document.getElementById(id);

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

export class Screens {
  constructor(h) {
    this.h = h;
    this.sel = SHIP.id;
    this.mode = 'free';
    $('fleetSummary').textContent=`${FLEET.length} 艘舰船可用。选择下方船型，再选择航行模式。`;
    $('shipCards').replaceChildren(...FLEET.map(({spec:S,icon,type,description,load})=>{
      const card=document.createElement('div');card.className='card'+(S.id===this.sel?' sel':'');card.dataset.ship=S.id;
      const tag=document.createElement('div');tag.className='tag';tag.textContent='可 用';
      const ico=document.createElement('div');ico.className='ico';ico.textContent=icon;
      const title=document.createElement('h3');title.textContent=`${S.displayName} · ${S.designation}`;
      const body=document.createElement('p');body.textContent=description;
      const stat=document.createElement('div');stat.className='stat';
      stat.textContent=`船长 ${S.length} m · 船宽 ${(S.deckHalfWidth*2).toFixed(1)} m\n吃水 ${S.operatingDraft.toFixed(2)} m · ${type}\n${load}`;
      card.append(tag,ico,title,body,stat);return card;
    }));
    document.querySelectorAll('.btn,.card:not(.locked)').forEach(el=>{
      el.tabIndex=0;el.setAttribute('role','button');
      el.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){event.preventDefault();el.click();}
      });
    });
    this.setVessel(SHIP);
    // lobby
    document.querySelectorAll('#shipCards .card').forEach((c) => {
      c.addEventListener('click', () => {
        if (c.classList.contains('locked')) return;
        document.querySelectorAll('#shipCards .card').forEach((x) => x.classList.remove('sel'));
        c.classList.add('sel');
        this.sel = c.dataset.ship;this.h.onVessel?.(this.sel);
        $('selName').textContent = c.querySelector('h3').textContent;
      });
    });
    document.querySelectorAll('#mode .card').forEach((c) => {
      c.addEventListener('click', () => {
        if (c.classList.contains('locked')) return;
        document.querySelectorAll('#mode .card').forEach((x) => x.classList.remove('sel'));
        c.classList.add('sel');
        this.mode = c.dataset.mode;
        this.setNight(this.h.getNight(),this.mode);
      });
    });

    $('toMode').addEventListener('click', () => this.show('mode'));
    $('backLobby').addEventListener('click', () => this.show('lobby'));
    $('startGame').addEventListener('click', () => this.h.onStart?.(this.mode));
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
    for(const c of document.querySelectorAll('#shipCards .card'))c.classList.toggle('sel',c.dataset.ship===spec.id);
    $('mainFireBtn').hidden=!spec.weapons.some(w=>w.type==='main');
    $('ciwsFireBtn').hidden=!spec.weapons.some(w=>w.type==='ciws');
    $('weaponPanelBtn').hidden=!spec.weapons.some(w=>w.type==='ciws'||w.type==='main'&&w.operable!==false);
    $('broadsideControls').hidden=!spec.battery?.broadside;
    $('submarineControls').hidden=!spec.submarine;
    $('speedUnit').textContent=spec.speedUnit??'kn';
    document.querySelector('[data-cam="bridge"]').textContent=spec.submarine?'舰岛 / 潜望镜':'舰桥';
  }

  setMode(mode){
    this.mode=mode;
    for(const c of document.querySelectorAll('#mode .card'))c.classList.toggle('sel',c.dataset.mode===mode);
    this.setNight(this.h.getNight(),mode);
  }
  setNight(on,mode){
    const button=$('nightOption');button.setAttribute('aria-pressed',String(on));button.disabled=mode==='random';
    button.textContent=mode==='random'?'昼夜自动交替':on?'黑夜 · 已开启':'黑夜 · 关闭';
  }

  show(id) {
    for (const s of ['loading', 'lobby', 'mode', 'result']) {
      $(s).classList.toggle('hidden', s !== id);
    }
    this.current = id;
  }

  hideAll() {
    for (const s of ['loading', 'lobby', 'mode', 'result']) $(s).classList.add('hidden');
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

  showResult({ title, sub, roll, pitch, wave, time }) {
    $('rTitle').textContent = title;
    $('rSub').textContent = sub;
    $('rRoll').textContent = roll.toFixed(1);
    $('rPitch').textContent = pitch.toFixed(1);
    $('rWave').textContent = wave.toFixed(1);
    $('rTime').textContent = Math.round(time);
    this.show('result');
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
