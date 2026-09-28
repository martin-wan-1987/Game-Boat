/**
 * audio.js — fully procedural sound (no audio assets).
 * Ocean roar, hull rumble, engine order, tsunami alarm, and a big slam.
 */
export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.master = null;
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    // ---- ocean: filtered brown noise ----
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.2;
    }
    this.noiseBuf = buf;

    const sea = ctx.createBufferSource();
    sea.buffer = buf; sea.loop = true;
    this.seaFilter = ctx.createBiquadFilter();
    this.seaFilter.type = 'lowpass';
    this.seaFilter.frequency.value = 420;
    this.seaGain = ctx.createGain();
    this.seaGain.gain.value = 0.30;
    sea.connect(this.seaFilter).connect(this.seaGain).connect(this.master);
    sea.start();

    // ---- hull rumble: low saw + noise ----
    const rum = ctx.createBufferSource();
    rum.buffer = buf; rum.loop = true;
    this.rumFilter = ctx.createBiquadFilter();
    this.rumFilter.type = 'bandpass';
    this.rumFilter.frequency.value = 42;
    this.rumFilter.Q.value = 1.6;
    this.rumGain = ctx.createGain();
    this.rumGain.gain.value = 0.0;
    rum.connect(this.rumFilter).connect(this.rumGain).connect(this.master);
    rum.start();

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 33;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 180;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.0;
    osc.connect(this.engFilter).connect(this.engGain).connect(this.master);
    osc.start();
    this.engOsc = osc;

    this.ready = true;
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  /** @param {number} dt @param {object} s  {speed, throttle, seaState, danger} */
  update(dt, s) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const r = 0.25;
    this.seaGain.gain.setTargetAtTime(
      0.16 + Math.min(0.5, s.seaState * 0.10), t, r);
    this.seaFilter.frequency.setTargetAtTime(
      320 + Math.min(900, s.seaState * 120), t, r);
    const load = Math.abs(s.throttle) * (0.5 + Math.min(1, s.speed / 14) * 0.5);
    this.rumGain.gain.setTargetAtTime(load * 0.30, t, 0.35);
    this.engGain.gain.setTargetAtTime(load * 0.16, t, 0.35);
    this.engOsc.frequency.setTargetAtTime(28 + load * 22, t, 0.4);
  }

  /** Short noise burst — slams, spray, impacts. */
  hit(strength = 0.5) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 200 + strength * 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.6, strength * 0.5), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5 + strength * 0.6);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 1.4);
  }

  /** Two-tone alarm for tsunami warning. */
  alarm(level = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const beeps = level >= 2 ? 3 : 2;
    for (let i = 0; i < beeps; i++) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = i % 2 === 0 ? 720 : 540;
      const g = ctx.createGain();
      const t0 = t + i * 0.30;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.10, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
      o.connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.28);
    }
  }
}
