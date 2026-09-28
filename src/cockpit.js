/**
 * cockpit.js — the first-person "looking out of the bridge" glass.
 *
 * A 2D canvas overlay that sits between the WebGL canvas and the HUD. It draws
 * three things:
 *   • rain droplets that accumulate on the glass, grow, and slide down;
 *   • two wipers that sweep across the panes and clear the droplets they touch;
 *   • (the frame, mullion and glare are plain CSS in index.html)
 *
 * The whole point is that a first-person view in a storm should feel like you
 * are standing behind wet glass, not floating in front of a monitor.
 */

export class CockpitOverlay {
  constructor() {
    this.el = document.getElementById('cockpit');
    this.canvas = document.getElementById('glassC');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

    this.drops = [];
    this.rain = 0;
    this.phase = 0;          // wiper sweep phase
    this.on = false;
    this.acc = 0;
    this.dpr = 1;
    this.w = 1; this.h = 1;

    // two wipers, one per outer pane (the mullion splits top/bottom)
    this.wipers = [];
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    if (!this.canvas) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const R = Math.min(this.w * 0.17, this.h * 0.34);
    this.wipers = [
      { px: this.w * 0.19, py: this.h * 0.45, r: R, base: -Math.PI / 2, sign: 1 },
      { px: this.w * 0.81, py: this.h * 0.45, r: R, base: -Math.PI / 2, sign: -1 },
    ];

    // One droplet sprite, drawn once per resize. Building a radial gradient
    // per drop per frame (up to 340 of them) is what made the bridge view
    // stutter in a storm — a drawImage is ~100x cheaper.
    const S = 64;
    this.sprite = document.createElement('canvas');
    this.sprite.width = this.sprite.height = S;
    const sg = this.sprite.getContext('2d');
    const grd = sg.createRadialGradient(S * 0.37, S * 0.33, S * 0.08, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(232,244,255,1.0)');
    grd.addColorStop(0.55, 'rgba(176,206,230,0.62)');
    grd.addColorStop(1, 'rgba(120,160,190,0)');
    sg.fillStyle = grd;
    sg.fillRect(0, 0, S, S);
  }

  show(on) {
    if (on === this.on) return;
    this.on = on;
    this.el?.classList.toggle('on', on);
    if (!on) {
      this.drops.length = 0;
      if (this.ctx) this.ctx.clearRect(0, 0, this.w, this.h);
    }
  }

  /**
   * @param {number} dt
   * @param {number} rain   0..1 storm intensity
   * @param {number} time
   */
  update(dt, rain, time) {
    this.rain = rain;
    if (!this.on || !this.ctx) return;
    const ctx = this.ctx;

    // wipers sweep continuously whenever there is any weather at all
    this.phase += dt * (0.9 + rain * 0.7);
    // ease-in-out sweep so the blades pause at the ends like real ones
    const s = Math.sin(this.phase);
    const eased = Math.sign(s) * Math.pow(Math.abs(s), 0.72);
    const swing = 1.05;                     // radians each side of vertical

    ctx.clearRect(0, 0, this.w, this.h);
    if (rain < 0.01) { this.drops.length = 0; return; }

    // ---- spawn droplets ------------------------------------------------
    this.acc += rain * 210 * dt;
    let n = Math.min(16, Math.floor(this.acc));
    this.acc -= n;
    for (let i = 0; i < n; i++) {
      if (this.drops.length > 340) break;
      // droplets favour the upper half (that is where they land) and the
      // middle band of the screen (the panes), not the extreme edges
      const x = this.w * (0.10 + Math.random() * 0.80);
      const y = this.h * (0.02 + Math.random() * 0.62);
      this.drops.push({
        x, y,
        r: 1.1 + Math.random() * 3.6,
        vy: 6 + Math.random() * 30,
        vx: (Math.random() - 0.5) * 8,
        a: 0.26 + Math.random() * 0.5,
        streak: Math.random() < 0.18,
      });
    }

    // ---- wiper blades + clearing --------------------------------------
    const blades = this.wipers.map((w) => ({
      ...w, ang: w.base + w.sign * eased * swing,
    }));

    const alive = [];
    for (const d of this.drops) {
      // slide down the glass, accelerating a touch
      d.vy += 26 * dt;
      d.y += d.vy * dt;
      d.x += d.vx * dt;
      d.r += dt * 0.35;

      // wiped away?
      let wiped = false;
      for (const b of blades) {
        const dx = d.x - b.px, dy = d.y - b.py;
        const dist = Math.hypot(dx, dy);
        if (dist > b.r) continue;
        const ang = Math.atan2(dy, dx);
        let da = ang - b.ang;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) < 0.16) { wiped = true; break; }
      }
      if (wiped) continue;
      if (d.y > this.h + 12 || d.x < -12 || d.x > this.w + 12) continue;
      alive.push(d);
    }
    this.drops = alive;

    // ---- draw droplets --------------------------------------------------
    for (const d of this.drops) {
      const rr = d.r * 2.4;
      ctx.globalAlpha = Math.min(1, d.a * 1.25);
      ctx.drawImage(this.sprite, d.x - rr / 2, d.y - rr / 2, rr, rr);

      if (d.streak) {
        // a thin trail behind the fast ones
        ctx.strokeStyle = `rgba(196,220,240,${d.a * 0.5})`;
        ctx.lineWidth = Math.max(0.8, d.r * 0.5);
        ctx.beginPath();
        ctx.moveTo(d.x, d.y - d.r);
        ctx.lineTo(d.x - d.vx * 0.02, d.y - d.r - 6 - d.vy * 0.12);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // ---- draw wiper blades ----------------------------------------------
    for (const b of blades) {
      const ex = b.px + Math.cos(b.ang) * b.r;
      const ey = b.py + Math.sin(b.ang) * b.r;
      // a soft swept-clean arc ahead of the blade
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 16;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.restore();

      // the blade itself
      ctx.strokeStyle = 'rgba(18,24,30,0.92)';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      // pivot boss
      ctx.fillStyle = 'rgba(24,32,40,0.95)';
      ctx.beginPath();
      ctx.arc(b.px, b.py, 6, 0, Math.PI * 2);
      ctx.fill();
      // highlight along the blade
      ctx.strokeStyle = 'rgba(150,180,205,0.30)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
  }
}
