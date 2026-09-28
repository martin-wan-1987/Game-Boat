/**
 * ui.js — screen flow: loading → lobby → mode → game → result.
 */
const $ = (id) => document.getElementById(id);

const LOAD_STEPS = [
  ['初始化渲染管线', '创建 WebGL 上下文与后处理链'],
  ['生成海面波形场', '叠加 8 组 Gerstner 波 · 长周期涌浪模型'],
  ['构建舰体结构', '337 m 舰体放样 · 飞行甲板 · 舰岛 · 舰载机'],
  ['求解浮力模型', '约 800 个水动力面元 · 逐帧静水压力积分'],
  ['烘焙天空环境', '生成反射立方体贴图与光照探针'],
  ['装配海洋交互特效', '艏波 · 尾流 · 飞沫 · 破浪白沫'],
  ['就绪', '欢迎登舰'],
];

const TIPS = [
  '提示：横摇超过约 27° 时飞行甲板边缘入水，复原力矩会骤降。',
  '提示：海啸从舰艏方向推来，保持航速才能保持舵效。',
  '提示：失去航速后，涌浪会把你推成横向 —— 那才是最危险的姿态。',
  '提示：大型海啸不一定会翻船，海况本身带有随机性。',
  '提示：拖动右侧马力拉杆可以无级调节主机功率。',
  '提示：抛锚能定住舰艏方向，但也会让你失去机动能力。',
];

export class Screens {
  constructor(h) {
    this.h = h;
    this.sel = 'carrier';
    this.mode = 'free';

    // lobby
    document.querySelectorAll('#shipCards .card').forEach((c) => {
      c.addEventListener('click', () => {
        if (c.classList.contains('locked')) return;
        document.querySelectorAll('#shipCards .card').forEach((x) => x.classList.remove('sel'));
        c.classList.add('sel');
        this.sel = c.dataset.ship;
        $('selName').textContent = c.querySelector('h3').textContent;
      });
    });
    document.querySelectorAll('#mode .card').forEach((c) => {
      c.addEventListener('click', () => {
        if (c.classList.contains('locked')) return;
        document.querySelectorAll('#mode .card').forEach((x) => x.classList.remove('sel'));
        c.classList.add('sel');
        this.mode = c.dataset.mode;
      });
    });

    $('toMode').addEventListener('click', () => this.show('mode'));
    $('backLobby').addEventListener('click', () => this.show('lobby'));
    $('startGame').addEventListener('click', () => this.h.onStart?.(this.mode));
    $('againBtn').addEventListener('click', () => this.h.onAgain?.());
    $('toLobbyBtn').addEventListener('click', () => { this.show('lobby'); this.h.onExit?.(); });
    $('btnResume').addEventListener('click', () => this.h.onResume?.());
    $('btnBackLobby').addEventListener('click', () => { this.show('lobby'); this.h.onExit?.(); });
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
    this.enableEnter(true);
  }
}

export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
export { TIPS };
