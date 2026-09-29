/**
 * input.js — keyboard, mouse and the draggable engine-order telegraph.
 *
 * Keys
 *   W / S        ahead / astern (nudges the engine order)
 *   A / D        rudder port / starboard
 *   Shift / Ctrl full ahead / full astern detent
 *   Space        drop / weigh anchor
 *   X            stop engines
 *   1 2 3        small / medium / large tsunami
 *   C            cycle camera
 *   1..5 also work as camera when the tsunami panel is closed
 *   R            reset the scenario
 *   H            help overlay
 *   P / Esc      pause
 */

export class Input {
  constructor(domElement, hooks = {}) {
    this.dom = domElement;
    this.hooks = hooks;
    this.keys = new Set();
    this.throttle = 0;          // -0.35 .. 1
    this.rudder = 0;            // -1 .. 1
    this.rudderTarget = 0;
    this.mouse = { x: 0, y: 0, down: false, button: 0 };
    this.enabled = true;
    this._bind();
  }

  _bind() {
    const dom = this.dom;

    this._kd = (e) => {
      if (!this.enabled) return;
      if (e.repeat) { e.preventDefault(); return; }
      const k = e.key.toLowerCase();
      this.keys.add(k);

      if (k === 'w') this.nudgeThrottle(0.05);
      if (k === 's') this.nudgeThrottle(-0.05);
      if (k === 'x') { this.throttle = 0; this.hooks.onThrottle?.(this.throttle); }
      if (e.shiftKey && k === 'shift') { this.throttle = 1; this.hooks.onThrottle?.(this.throttle); }
      if (e.ctrlKey && k === 'control') { this.throttle = -0.35; this.hooks.onThrottle?.(this.throttle); }

      if (k === ' ') {
        e.preventDefault();
        this.hooks.onAnchor?.();
      }
      if (k === '1') this.hooks.onTsunami?.('small');
      if (k === '2') this.hooks.onTsunami?.('medium');
      if (k === '3') this.hooks.onTsunami?.('large');
      if (k === '4') this.hooks.onTsunami?.('ultra');
      if (k === 'c') this.hooks.onCamera?.();
      if (k === 'r') this.hooks.onReset?.();
      if (k === 'h') this.hooks.onHelp?.();
      if (k === 'p' || k === 'escape') this.hooks.onPause?.();
      if (k === 'm') this.hooks.onMute?.();
      if (['w', 'a', 's', 'd', ' '].includes(k)) e.preventDefault();
    };
    this._ku = (e) => this.keys.delete(e.key.toLowerCase());

    this._md = (e) => {
      if (e.target.closest?.('.ui-block')) return;
      this.mouse.down = true;
      this.mouse.button = e.button;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.moved = false;
    };
    this._mm = (e) => {
      if (!this.mouse.down) return;
      const dx = e.clientX - this.mouse.x;
      const dy = e.clientY - this.mouse.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.mouse.moved = true;
      this.hooks.onOrbit?.(dx, dy);
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    };
    this._mu = () => { this.mouse.down = false; };
    this._wheel = (e) => {
      if (e.target.closest?.('.ui-block')) return;
      this.hooks.onZoom?.(e.deltaY);
    };
    this._ctx = (e) => e.preventDefault();

    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    dom.addEventListener('mousedown', this._md);
    window.addEventListener('mousemove', this._mm);
    window.addEventListener('mouseup', this._mu);
    dom.addEventListener('wheel', this._wheel, { passive: true });
    dom.addEventListener('contextmenu', this._ctx);
  }

  nudgeThrottle(d) {
    this.setThrottle(this.throttle + d);
  }

  setThrottle(v) {
    this.throttle = Math.max(-0.35, Math.min(1, v));
    this.hooks.onThrottle?.(this.throttle);
  }

  /** Called every frame: rudder springs back to centre like a real helm. */
  update(dt) {
    if (!this.enabled) { this.rudder = 0; return; }
    let want = 0;
    if (this.keys.has('a')) want -= 1;
    if (this.keys.has('d')) want += 1;
    this.rudderTarget = want;
    const rate = want === 0 ? 2.6 : 3.4;
    this.rudder += (want - this.rudder) * Math.min(1, dt * rate);
  }

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    this.dom.removeEventListener('mousedown', this._md);
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('mouseup', this._mu);
    this.dom.removeEventListener('wheel', this._wheel);
    this.dom.removeEventListener('contextmenu', this._ctx);
  }
}
