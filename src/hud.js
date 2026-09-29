/**
 * hud.js — instrument panel, engine-order telegraph, alert banner.
 */
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor({ onThrottle, onCamera, onTsunami }) {
    this.onThrottle = onThrottle;
    this.onCamera = onCamera;
    this.onTsunami = onTsunami;

    this.el = {
      hud: $('hud'),
      speed: $('iSpeed'), hdg: $('iHdg'), roll: $('iRoll'), pitch: $('iPitch'),
      wave: $('iWave'), anchor: $('iAnchor'), rudder: $('iRudder'),
      adi: $('adiC'),
      mInt: $('mInt'), mFlood: $('mFlood'), dmgState: $('dmgState'),
      lever: $('lever'), leverFill: $('leverFill'), leverKnob: $('leverKnob'),
      thrPct: $('thrPct'), thrOrder: $('thrOrder'),
      alert: $('alert'), alertT: $('alertT'), alertS: $('alertS'),
      cams: $('cams'), log: $('log'),
      help: $('help'), pause: $('pause'),
      tsuBear: $('tsuBear'), tsuC: $('tsuC'), tsuHint: $('tsuHint'),
    };
    this.adiCtx = this.el.adi.getContext('2d');
    this.tsuCtx = this.el.tsuC.getContext('2d');
    this.logs = [];
    this.throttle = 0;
    this._alertLevel = -1;

    this._buildLeverTicks();
    this._bindLever();
    this._bindCams();
  }

  show(on = true) { this.el.hud.classList.toggle('on', on); }

  /* ---------------- engine order telegraph ---------------- */
  _buildLeverTicks() {
    const track = this.el.lever;
    for (const v of [-0.35, 0, 0.25, 0.5, 0.75, 1]) {
      const f = (v + 0.35) / 1.35;
      const t = document.createElement('div');
      t.className = 'tick';
      t.style.bottom = `${f * 100}%`;
      track.appendChild(t);
      const l = document.createElement('div');
      l.className = 'tickl';
      l.style.bottom = `${f * 100}%`;
      l.textContent = v === -0.35 ? '后退' : `${Math.round(v * 100)}%`;
      track.appendChild(l);
    }
  }

  _bindLever() {
    const el = this.el.lever;
    let dragging = false;
    const setFromEvent = (e) => {
      const r = el.getBoundingClientRect();
      const y = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      const f = THREE.MathUtils.clamp(1 - y / r.height, 0, 1);
      const v = -0.35 + f * 1.35;
      this.setThrottle(v);
      this.onThrottle?.(this.throttle);
    };
    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
      setFromEvent(e);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (dragging) { setFromEvent(e); e.preventDefault(); } });
    el.addEventListener('pointerup', (e) => {
      dragging = false;
      try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    el.addEventListener('pointercancel', () => { dragging = false; });
  }

  setThrottle(v) {
    this.throttle = THREE.MathUtils.clamp(v, -0.35, 1);
    const f = (this.throttle + 0.35) / 1.35;
    this.el.leverKnob.style.top = `${(1 - f) * 100}%`;
    this.el.leverFill.style.height = `${f * 100}%`;
    const pct = Math.round(this.throttle * 100);
    this.el.thrPct.innerHTML = `${pct}<small>%</small>`;
    this.el.thrPct.style.color = this.throttle < -0.01 ? 'var(--amber)' : 'var(--cyan)';
    this.el.leverFill.style.background = this.throttle < -0.01
      ? 'linear-gradient(180deg,var(--amber),rgba(255,179,71,.3))'
      : 'linear-gradient(180deg,var(--cyan),rgba(43,143,196,.35))';
    this.el.thrOrder.textContent = this.throttle <= -0.2 ? '后退一'
      : this.throttle < -0.01 ? '后退二'
        : this.throttle < 0.02 ? '停车'
          : this.throttle < 0.22 ? '微速'
            : this.throttle < 0.45 ? '半速一'
              : this.throttle < 0.72 ? '半速二'
                : this.throttle < 0.94 ? '全速一' : '全速前进';
  }

  _bindCams() {
    this.el.cams.querySelectorAll('.c').forEach((b) => {
      b.addEventListener('click', () => this.onCamera?.(b.dataset.cam));
    });
    document.querySelectorAll('#tsu .opt').forEach((b) => {
      b.addEventListener('click', () => {
        if (b.classList.contains('dis')) return;
        this.onTsunami?.(b.dataset.tier);
      });
    });
  }

  setCamera(mode) {
    this.el.cams.querySelectorAll('.c').forEach((b) => {
      b.classList.toggle('on', b.dataset.cam === mode);
    });
  }

  /* ---------------- per-frame ---------------- */
  update(dt, s) {
    const { ship, waveField, tsunami, damage, time } = s;
    const att = ship.attitude;

    // Text DOM writes trigger style/layout work in the browser; numbers read
    // no differently at 8 Hz than at 60 Hz. The ADI canvas and the alert
    // banner stay per-frame (they are the ones that actually move).
    this._uiAcc = (this._uiAcc || 0) + dt;
    const ui = this._uiAcc >= 0.12;
    if (ui) this._uiAcc = 0;

    if (ui) {
      this.el.speed.textContent = ship.speedKnots.toFixed(1);
      let hdg = att.fwd ? Math.atan2(att.fwd.z, att.fwd.x) * 57.2958 : 0;
      hdg = (hdg + 360) % 360;
      this.el.hdg.textContent = String(Math.round(hdg)).padStart(3, '0');
      this.el.roll.textContent = `${(att.roll * 57.2958).toFixed(1)}°`;
      this.el.pitch.textContent = `${(att.pitch * 57.2958).toFixed(1)}°`;
      const rollAbs = Math.abs(att.roll) * 57.2958;
      this.el.roll.className = 'v ' + (rollAbs > 27 ? 'bad' : rollAbs > 14 ? 'warn' : '');
      this.el.pitch.className = 'v ' + (Math.abs(att.pitch) * 57.2958 > 12 ? 'warn' : '');
      this.el.wave.textContent = (waveField.tsuHeight || 1.2).toFixed(1);
      this.el.anchor.textContent = ship.anchorDown ? `抛锚 ${Math.round(ship.anchorChain)}m` : '收起';
      this.el.anchor.className = 'v ' + (ship.anchorDown ? 'good' : '');
      this.el.rudder.textContent = `${Math.round(-ship.rudderAngle * 57.2958)}°`;

      // damage meters
      const int = damage.integrity;
      this.el.mInt.querySelector('i').style.right = `${100 - int}%`;
      this.el.mInt.className = 'meter ' + (int > 70 ? 'ok' : int > 35 ? 'mid' : 'low');
      this.el.mFlood.querySelector('i').style.right = `${100 - damage.flood * 100}%`;
      this.el.mFlood.className = 'meter ' + (damage.flood < 0.15 ? 'ok' : damage.flood < 0.45 ? 'mid' : 'low');
      this.el.dmgState.textContent = {
        ok: '状态正常', damaged: '轻度受损', flooding: '正在进水',
        sinking: '大量进水 · 弃船', lost: '舰体沉没',
      }[damage.state] || '状态正常';
    }

    this.drawAdi(att, ship);

    // tsunami alert
    if (tsunami.active) {
      const d = tsunami.distanceToCrest(ship.position);
      const tier = tsunami.tier;
      const bearing = tsunami.bearingFromBow(ship);
      const ab = Math.abs(bearing);
      const side = bearing < 0 ? '左' : '右';
      const where = ab < 12 ? '正前方' : ab < 35 ? `${side}前方` : ab < 70 ? `${side}舷侧` : '正横';
      const lvl = tier.id === 'ultra' ? 3
        : ab > 55 ? 3 : ab > 28 ? 2 : tier.id === 'large' ? 2
        : tier.id === 'medium' ? 1 : 0;
      this.setAlert(
        `${tier.label} · ${tsunami.height.toFixed(1)} m`,
        d > 0
          ? `来袭方位 ${where} ${ab.toFixed(0)}° ｜ 距离 ${Math.round(d)} m ｜ ${Math.max(0, d / waveField.tsuSpeed).toFixed(0)} 秒后抵达`
          : `正在通过 ｜ 最大横摇 ${(tsunami.peakRoll * 57.2958).toFixed(1)}°`,
        lvl,
      );
      this.el.tsuBear.style.display = 'block';
      this.drawBearing(bearing, lvl);
      this.el.tsuHint.textContent = ab < 15
        ? '已对准浪向 · 保持航速'
        : ab < 35 ? '建议转舵将舰艏对准来袭方向'
          : '危险！横摇风险极高，立即转向';
      this.el.tsuHint.style.color = ab < 15 ? 'var(--green)'
        : ab < 35 ? 'var(--amber)' : 'var(--red)';
    } else if (damage.state === 'sinking' || damage.state === 'lost') {
      this.setAlert('弃 船', '舰体大量进水，正在下沉', 3);
      this.el.tsuBear.style.display = 'none';
    } else {
      this.setAlert(null);
      this.el.tsuBear.style.display = 'none';
    }

    this.el.help.classList.toggle('on', !!s.showHelp);
    this.el.pause.classList.toggle('on', !!s.paused);
  }

  /** Bow-relative compass showing where the wave is coming from. */
  drawBearing(bearingDeg, level) {
    const c = this.tsuCtx;
    const W = 300, H = 132, cx = W / 2, cy = H - 14, R = 96;
    c.clearRect(0, 0, W, H);

    // arc scale
    c.strokeStyle = 'rgba(120,180,215,.35)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, R, Math.PI, Math.PI * 2); c.stroke();
    c.font = '17px monospace';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(142,163,179,.9)';
    for (const a of [-60, -30, 0, 30, 60]) {
      const rad = (-90 + a) * Math.PI / 180;
      const x1 = cx + Math.cos(rad) * (R - 8), y1 = cy + Math.sin(rad) * (R - 8);
      const x2 = cx + Math.cos(rad) * R, y2 = cy + Math.sin(rad) * R;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
      c.fillText(a === 0 ? '艏' : (a < 0 ? '←' + -a : a + '→'),
        cx + Math.cos(rad) * (R - 30), cy + Math.sin(rad) * (R - 30) + 5);
    }

    // danger wedge beyond 35 deg
    c.save();
    c.globalAlpha = 0.16;
    c.fillStyle = '#ff4d4d';
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, R, Math.PI, Math.PI * (1 - 0.61));
    c.closePath(); c.fill();
    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, R, Math.PI * (1 + 0.61), Math.PI * 2);
    c.closePath(); c.fill();
    c.restore();

    // ship silhouette
    c.strokeStyle = 'rgba(220,235,245,.55)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(cx, cy - 26); c.lineTo(cx - 8, cy - 2);
    c.lineTo(cx + 8, cy - 2); c.closePath(); c.stroke();

    // wave arrow
    const rad = (-90 + bearingDeg) * Math.PI / 180;
    const ax = cx + Math.cos(rad) * (R - 14);
    const ay = cy + Math.sin(rad) * (R - 14);
    const col = level >= 3 ? '#ff4d4d' : level >= 2 ? '#ffb347' : '#49e08b';
    c.strokeStyle = col;
    c.lineWidth = 4;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(ax, ay); c.stroke();
    c.fillStyle = col;
    c.beginPath();
    c.arc(ax, ay, 8, 0, 7);
    c.fill();
  }

  drawAdi(att, ship) {
    const c = this.adiCtx;
    const W = 368, H = 368, R = 168;
    const cx = W / 2, cy = H / 2;
    c.clearRect(0, 0, W, H);

    c.save();
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.clip();

    // sky / sea, rotated by roll and shifted by pitch
    c.save();
    c.translate(cx, cy);
    c.rotate(-att.roll);
    const pitchPx = (att.pitch * 57.2958) * 3.0;
    c.translate(0, pitchPx);

    c.fillStyle = '#1d4f74';
    c.fillRect(-R * 2, -R * 2, R * 4, R * 2);
    c.fillStyle = '#0b2b3d';
    c.fillRect(-R * 2, 0, R * 4, R * 2);

    // pitch ladder
    c.strokeStyle = 'rgba(220,240,255,.55)';
    c.fillStyle = 'rgba(220,240,255,.75)';
    c.font = '17px monospace';
    c.textAlign = 'center';
    c.lineWidth = 2;
    for (let p = -30; p <= 30; p += 10) {
      if (p === 0) continue;
      const y = -p * 3.0;
      const w = p % 20 === 0 ? 62 : 34;
      c.beginPath(); c.moveTo(-w, y); c.lineTo(w, y); c.stroke();
      if (p % 20 === 0) c.fillText(String(p), 0, y - 6);
    }
    c.strokeStyle = 'rgba(255,255,255,.95)';
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(-96, 0); c.lineTo(96, 0); c.stroke();
    c.restore();

    // roll pointer arc
    c.save();
    c.translate(cx, cy);
    c.strokeStyle = 'rgba(220,240,255,.35)';
    c.lineWidth = 2;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const rad = (a - 90) * Math.PI / 180;
      const len = a % 30 === 0 ? 18 : 10;
      c.beginPath();
      c.moveTo(Math.cos(rad) * (R - 4), Math.sin(rad) * (R - 4));
      c.lineTo(Math.cos(rad) * (R - 4 - len), Math.sin(rad) * (R - 4 - len));
      c.stroke();
    }
    c.rotate(att.roll);
    c.fillStyle = rollColour(Math.abs(att.roll) * 57.2958);
    c.beginPath();
    c.moveTo(0, -(R - 8)); c.lineTo(-11, -(R - 30)); c.lineTo(11, -(R - 30));
    c.closePath(); c.fill();
    c.restore();

    // fixed ship symbol
    c.save();
    c.translate(cx, cy);
    c.strokeStyle = '#ffcf5c';
    c.lineWidth = 5;
    c.beginPath(); c.moveTo(-62, 0); c.lineTo(-20, 0); c.stroke();
    c.beginPath(); c.moveTo(20, 0); c.lineTo(62, 0); c.stroke();
    c.beginPath(); c.arc(0, 0, 7, 0, 7); c.stroke();
    c.restore();

    c.restore();

    // bezel
    c.strokeStyle = 'rgba(120,190,225,.45)';
    c.lineWidth = 4;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
  }

  setAlert(title, sub, level = 1) {
    if (!title) {
      if (this._alertLevel !== -1) { this.el.alert.classList.remove('on'); this._alertLevel = -1; }
      return;
    }
    this.el.alertT.textContent = title;
    this.el.alertS.textContent = sub || '';
    const col = level >= 3 ? 'var(--red)' : level >= 2 ? 'var(--red)' : level >= 1 ? 'var(--amber)' : 'var(--cyan)';
    this.el.alertT.style.color = col;
    this.el.alert.style.borderColor = col;
    if (this._alertLevel !== level) { this.el.alert.classList.add('on'); this._alertLevel = level; }
  }

  pushLog(msg, time) {
    this.logs.push({ msg, time });
    if (this.logs.length > 12) this.logs.shift();
    this.el.log.innerHTML = this.logs.slice().reverse()
      .map((l) => `<div><b>[${fmtTime(l.time)}]</b> ${l.msg}</div>`).join('');
  }
}

function rollColour(deg) {
  if (deg > 27) return '#ff4d4d';
  if (deg > 14) return '#ffb347';
  return '#49e08b';
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
