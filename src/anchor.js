import * as THREE from 'three';

export const ANCHOR = Object.freeze({ dropSeconds: 3, chainLength: 480 });

// Elapsed lowering time is the sole state; phase and chain payout are derived.
export class Anchor {
  constructor() { this.position = new THREE.Vector3(); this.reset(); }
  reset() { this.elapsed = null; }
  drop(position) { this.position.copy(position); this.elapsed = 0; }
  step(dt) {
    if (this.elapsed !== null) this.elapsed = Math.min(ANCHOR.dropSeconds, this.elapsed + dt);
  }
  get phase() { return this.elapsed === null ? 'stowed' : this.remaining > 0 ? 'lowering' : 'set'; }
  get remaining() { return this.elapsed === null ? 0 : Math.max(0, ANCHOR.dropSeconds - this.elapsed); }
  get chainLength() { return this.elapsed === null ? 0 : ANCHOR.chainLength * this.elapsed / ANCHOR.dropSeconds; }
}
