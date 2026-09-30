/**
 * main.js — wiring, main loop and screen flow.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { WaveField, makeWaveUniforms, applyWaveUniforms } from './waves.js';
import { Ocean } from './ocean.js';
import { SkySystem } from './sky.js';
import { createCarrier, SHIP } from './ship.js';
import { ShipPhysics } from './physics.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Screens } from './ui.js';
import { TsunamiManager, TSUNAMI_TIERS } from './tsunami.js';
import { DamageModel } from './damage.js';
import { HullFoam, WakeRibbon, Particles, SprayEmitter, Rain, PropWash } from './fx.js';
import { CockpitOverlay } from './cockpit.js';
import { Audio } from './audio.js';

/* ------------------------------------------------------------------ *
 * quality presets
 * ------------------------------------------------------------------ */
const QUALITY = {
  low:    { oceanSeg: 224, grade: 5.0, pixelRatio: 1.0, bloom: false, shadow: 0,    particles: 1200, shipDetail: 'low' },
  medium: { oceanSeg: 320, grade: 5.2, pixelRatio: 1.25, bloom: true, shadow: 1024, particles: 2200, shipDetail: 'high' },
  high:   { oceanSeg: 384, grade: 5.2, pixelRatio: 1.6, bloom: true, shadow: 2048, particles: 3200, shipDetail: 'high' },
  ultra:  { oceanSeg: 512, grade: 5.4, pixelRatio: 2.0, bloom: true, shadow: 4096, particles: 4200, shipDetail: 'high' },
};

function detectQuality() {
  const mem = navigator.deviceMemory || 8;
  const cores = navigator.hardwareConcurrency || 8;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile) return 'medium';
  if (cores >= 10 && mem >= 8) return 'ultra';
  if (cores >= 6) return 'high';
  return 'medium';
}

/* Runtime quality governor. The preset picks a starting point; the hardware
 * reality is measured, not assumed. While the frame time stays above ~26 ms
 * (below ~38 fps) the *render* load steps down one notch at a time —
 * resolution, then shadows, then bloom, then ocean tessellation. The
 * simulation is never touched, and quality only steps down, so it cannot
 * oscillate. Each step reports itself in the log so a drop is never a
 * mystery to the player. */
const DOWNGRADES = [
  (g) => g.applyPixelRatio(1.5),
  (g) => g.applyShadow(2048),
  (g) => g.applyPixelRatio(1.25),
  (g) => g.applyShadow(1024),
  (g) => g.applyBloom(false),
  (g) => g.applyPixelRatio(1.0),
  (g) => g.applyShadow(0),
  (g) => g.applyOceanSeg(384),
  (g) => g.applyOceanSeg(320),
  (g) => g.applyOceanSeg(224),
];

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */
class Game {
  constructor() {
    this.quality = detectQuality();
    this.q = QUALITY[this.quality];
    this.time = 0;
    this.clock = new THREE.Clock();
    this.acc = 0;
    this.running = false;
    this.paused = false;
    this.showHelp = false;
    this.mode = 'free';
    this.lostAt = null;
    this.resultShown = false;
    this.alertFired = false;
    // quality-governor state (frame-time EMA + ladder cursor)
    this._emaFrame = 0.016;
    this._govT = 0;
    this._govIdx = 0;
    this._govDone = false;
  }

  /* ---------------- boot ---------------- */
  async boot() {
    this.screens = new Screens({
      onStart: (mode) => this.startGame(mode),
      onAgain: () => this.startGame(this.mode),
      onExit: () => this.exitToLobby(),
      onResume: () => { this.paused = false; },
    });

    this.buildRenderer();

    const steps = [
      () => this.buildScene(),
      () => this.buildWaves(),
      () => this.buildShip(),
      () => this.buildPhysics(),
      () => this.buildEnv(),
      () => this.buildFX(),
      () => this.buildPost(),
    ];
    await this.screens.runLoading(steps);

    // Pre-compile every material up front. three.js compiles a shader the
    // first time its material is actually drawn; if that happens while you are
    // switching cameras the frame stalls and can flash. Doing it here, once,
    // while the loading screen is still up, removes that entirely.
    //
    // The button listener is bound BEFORE the compile: compile() is
    // synchronous and can block for seconds on a slow GPU, and a click that
    // lands during it would otherwise be dropped — the bar reads 100%, the
    // button is lit, and pressing it does nothing. Bound first, the click
    // simply queues and fires the moment the main thread frees.
    this.screens.setProgress(100, '编译着色器 · 稍候');
    document.getElementById('enterBtn').addEventListener('click', () => {
      this.audio.init();
      this.audio.resume();
      this.screens.show('lobby');
    });
    try { this.renderer.compile(this.scene, this.camera); } catch (e) { /* non-fatal */ }

    // Shader-variant warm-up. The first tsunami summon compiled ~3 new
    // programs SYNCHRONOUSLY — a several-hundred-ms main-thread stall on
    // real GPUs, which the compositor presents as a full-screen black
    // flash. Render one frame each of the tsunami / elevation-wall / full
    // storm states back here behind the loading screen, then restore calm,
    // so no state a wave can put the scene in ever compiles mid-game.
    try {
      this.field.spawnTsunami({ x: 0, z: 0, dirX: 1, dirZ: 0, height: 12,
        distance: 4000, crests: 2, speed: 40 });
      this.skySys.setStorm(1);
      // rain too: it is INVISIBLE in calm weather, and compile() skips
      // invisible objects — its material otherwise compiles the moment a
      // storm first switches it on
      this.rain.mesh.visible = true;
      this.rain.mat.opacity = 0.4;
      this.ocean.update(0, this.phys.position, this.field);
      this.renderer.render(this.scene, this.camera);
      this.field.tsuElevation = true;              // the mega-wall variant
      this.ocean.update(0, this.phys.position, this.field);
      this.renderer.render(this.scene, this.camera);
      this.field.tsunami.length = 0;
      this.field.tsuActive = false;
      this.field.tsuElevation = false;
      this.rain.mesh.visible = false;
      this.rain.mat.opacity = 0;
      this.skySys.setStorm(0);
    } catch (e) { /* non-fatal */ }

    this.loop();
  }

  buildRenderer() {
    const canvasHost = document.getElementById('app');
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.quality !== 'low',
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.q.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = this.q.shadow > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvasHost.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      48, window.innerWidth / window.innerHeight, 0.9, 42000);

    window.addEventListener('resize', () => this.onResize());
  }

  buildScene() {
    this.skySys = new SkySystem(this.renderer, this.scene, this.q.shadow);
    this.rig = new CameraRig(this.camera);
  }

  buildWaves() {
    this.waveUniforms = makeWaveUniforms(THREE);
    this.field = new WaveField();
    // An everyday sea with real swell (Hs ≈ 2.6 m): the ocean must never be
    // a flat lake — she should be working, spray coming over the bow at
    // speed, before any tsunami is fired.
    this.field.buildSea(2.6, 1, 0, 0.45, 62);
    this.ocean = new Ocean({
      waveUniforms: this.waveUniforms,
      extent: 12000, seg: this.q.oceanSeg, grade: this.q.grade,
      quality: this.quality,
    });
    this.scene.add(this.ocean.mesh);
  }

  buildShip() {
    this.shipMesh = createCarrier({ quality: this.q.shipDetail });
    this.scene.add(this.shipMesh);
    this.shipSpin = this.shipMesh.userData.spin;
    this.shipFlag = this.shipMesh.userData.flagAnimate;
  }

  buildPhysics() {
    this.phys = new ShipPhysics(this.shipMesh.userData.patches, {});
    this.phys.reset(0, 0, 0);
    this.shipMesh.position.copy(this.phys.position);
    this.shipMesh.quaternion.copy(this.phys.quaternion);
  }

  buildEnv() {
    this.skySys.followTarget(new THREE.Vector3());
    this.ocean.setEnvMap(this.skySys.envMap);
    const sunCol = new THREE.Color(1.0, 0.96, 0.88);
    this.ocean.setSun(this.skySys.sunDir, sunCol);
    this.ocean.setFog(this.skySys.scene.fog.color, this.skySys.fogDensity);
  }

  buildFX() {
    this.particles = new Particles(this.q.particles);
    this.spray = new SprayEmitter(this.particles);
    this.hullFoam = new HullFoam(this.waveUniforms);
    this.wake = new WakeRibbon(this.waveUniforms, { tex: this.ocean.foamTex });
    this.propWash = new PropWash(this.waveUniforms, { tex: this.ocean.foamTex });
    this.scene.add(this.hullFoam.mesh, this.wake.mesh, this.propWash.mesh,
      this.particles.points);
    this.particles.setPixelRatio(this.renderer.getPixelRatio());

    this.tsunami = new TsunamiManager(this.field);
    this.damage = new DamageModel();
    this.audio = new Audio();

    // storm / weather
    this.storm = 0;
    this.rain = new Rain(this.quality === 'low' ? 1200 : 2600);
    this.scene.add(this.rain.mesh);
    this.cockpit = new CockpitOverlay();

    this.hud = new Hud({
      // the telegraph lever writes straight into the shared input state
      onThrottle: (v) => { this.input.setThrottle(v); },
      onCamera: (m) => this.setCamera(m),
      onTsunami: (tier) => this.fireTsunami(tier),
    });
  }

  buildPost() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.q.bloom) {
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.26, 0.55, 0.90);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());

    this.input = new Input(this.renderer.domElement, {
      onOrbit: (dx, dy) => {
        if (this.rig.mode === 'orbit') this.rig.orbitBy(dx * 0.005, dy * 0.005);
        if (this.rig.mode === 'walk') this.rig.walkLook(dx * 0.0032, dy * 0.0032);
      },
      onToggleRun: () => {
        this.rig.walkRun = !this.rig.walkRun;
        this.hud.pushLog(this.rig.walkRun ? '甲板行走 · 奔跑' : '甲板行走 · 慢行', this.time);
      },
      onZoom: (d) => { if (this.rig.mode === 'orbit') this.rig.zoomBy(d); },
      onThrottle: (v) => { this.hud.setThrottle(v); },
      onAnchor: () => this.toggleAnchor(),
      onTsunami: (t) => this.fireTsunami(t),
      onCamera: () => this.cycleCamera(),
      onReset: () => this.resetScenario(),
      onHelp: () => { this.showHelp = !this.showHelp; },
      onPause: () => { if (this.running) this.paused = !this.paused; },
      onMute: () => { this.audio.toggleMute(); },
    });
  }

  /* ---------------- flow ---------------- */
  startGame(mode) {
    this.mode = mode;
    this.screens.hideAll();
    this.hud.show(true);
    this.resetScenario();
    this.running = true;
    this.paused = false;
    this.resultShown = false;
    this.lostAt = null;
    this.audio.init();
    this.audio.resume();
    this.hud.pushLog('启航 · 普通模式 · 自由航行', 0);
    this.hud.pushLog('海啸将从舰艏方向推来', 0);
  }

  exitToLobby() {
    this.running = false;
    this.hud.show(false);
  }

  resetScenario() {
    this.phys.reset(0, 0, 0);
    this.phys.throttle = 0;
    this.phys.rudder = 0;
    this.phys.anchorDown = false;
    this.phys.anchorChain = 0;
    this.damage.reset();
    this.tsunami.state = 'idle';
    this.tsunami.followups = 0;
    this.tsunami.peakRoll = 0;
    this.tsunami.peakPitch = 0;
    this.field.tsunami.length = 0;
    this.field.tsuActive = false;
    this.field.time = 0;
    this.wake.reset();
    this.time = 0;
    this.alertFired = false;
    this.hud.setThrottle(0);
    this.input.setThrottle(0);
    this.hud.logs.length = 0;
    this.rig.radius = 620;
    this.rig.theta = -0.6;
    this.rig.phi = 1.12;
    // The rig has been sitting at the world origin (inside the hull) since
    // boot — while the lobby covered the screen that was invisible. Without
    // this snap the first seconds of play lerp the lens out THROUGH the hull,
    // whose unlit DoubleSide interior flashes black across the view.
    this.rig._snap = true;
    this.storm = 0;
    this.skySys?.setStorm(0);
    this.cockpit?.show(false);
  }

  fireTsunami(tierId) {
    if (!this.running) return;
    // Free mode: fire as often as you like. A new event REPLACES the wave
    // train that is still running — the field is reset by spawnTsunami, so
    // there is no state to clean up here.
    const tier = TSUNAMI_TIERS[tierId];
    if (!tier) return;
    this.tsunami.trigger(tierId, {
      position: this.phys.position,
      heading: this.phys.heading,
    }, this.time);
    this.hud.pushLog(`探测到${tier.label} · 浪高 ${this.tsunami.height.toFixed(1)} m`, this.time);
    this.audio.alarm(tierId === 'large' || tierId === 'ultra' ? 2 : 1);
    this.alertFired = true;
  }

  toggleAnchor() {
    if (!this.running) return;
    const p = this.phys;
    p.anchorDown = !p.anchorDown;
    if (p.anchorDown) {
      const bow = new THREE.Vector3(SHIP.length / 2 - 4, 0, 0)
        .applyQuaternion(p.quaternion).add(p.position);
      p.anchorPos.set(bow.x, 0, bow.z);
      p.anchorTarget = 480;
      this.hud.pushLog('抛锚 · 放出锚链 480 m', this.time);
    } else {
      p.anchorTarget = 0;
      this.hud.pushLog('起锚', this.time);
    }
  }

  setCamera(mode) {
    this.rig.setMode(mode);
    this.hud.setCamera(mode);
  }

  cycleCamera() {
    const modes = ['orbit', 'chase', 'bridge', 'deck', 'cinema', 'walk'];
    const i = modes.indexOf(this.rig.mode);
    this.setCamera(modes[(i + 1) % modes.length]);
  }

  /* ---------------- loop ---------------- */
  loop() {
    requestAnimationFrame(() => this.loop());
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05);
    this.govern(raw, dt);
    if (!this.running) { this.render(); return; }

    if (!this.paused && !this.showHelp) {
      this.step(dt);
    } else {
      // still render, just frozen
      this.hud.update(dt, this.hudState());
    }
    this.render();
  }

  /** Step the render quality down when the measured frame time says the
   *  hardware cannot deliver the preset. See DOWNGRADES. */
  govern(raw, dt) {
    this._emaFrame += (raw - this._emaFrame) * 0.04;
    if (!this.running || this._govDone) return;
    this._govT += dt;
    if (this._govT < 2 || this._emaFrame < 0.026) return;
    this._govT = 0;
    while (this._govIdx < DOWNGRADES.length) {
      if (DOWNGRADES[this._govIdx++](this)) {
        this.hud.pushLog(`性能保护 · 已自动调整画质 (${this._govIdx}/${DOWNGRADES.length})`, this.time);
        return;
      }
    }
    this._govDone = true;      // ladder exhausted; stop checking
  }

  applyPixelRatio(r) {
    if (r >= this.renderer.getPixelRatio()) return false;
    this.renderer.setPixelRatio(r);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
    this.bloom?.setSize(window.innerWidth, window.innerHeight);
    this.particles.setPixelRatio(r);
    return true;
  }

  applyShadow(size) {
    const light = this.skySys.sunLight;
    if (!light.castShadow || size >= light.shadow.mapSize.x) return false;
    if (size === 0) { light.castShadow = false; return true; }
    light.shadow.mapSize.set(size, size);
    if (light.shadow.map) { light.shadow.map.dispose(); light.shadow.map = null; }
    return true;
  }

  applyBloom(on) {
    if (!this.bloom || this.bloom.enabled === on) return false;
    this.bloom.enabled = on;
    return true;
  }

  applyOceanSeg(seg) {
    if (seg >= this.ocean.seg) return false;
    this.ocean.rebuild(seg);
    return true;
  }

  step(dt) {
    this.time += dt;
    this.field.update(dt);

    // ---- physics at a fixed 120 Hz -------------------------------
    this.acc += dt;
    const h = 1 / 120;
    let sub = 0;
    // single source of truth for the engine order is the Input state, which
    // both the keyboard and the draggable telegraph write into
    this.phys.throttle = this.input.throttle;
    while (this.acc >= h && sub < 6) {
      this.phys.rudder = this.input.rudder;
      this.phys.step(h, this.field);
      this.acc -= h;
      sub++;
    }
    // After a stall (shader compile, GC, tab switch) the backlog would make
    // every following frame run the full 6 substeps, stretching the stall
    // into a spiral. Debt older than 100 ms is simply dropped — the sea does
    // not care about 100 ms of missed buoyancy.
    if (this.acc > 0.1) this.acc = 0;

    this.shipMesh.position.copy(this.phys.position);
    this.shipMesh.quaternion.copy(this.phys.quaternion);
    if (this.shipSpin) this.shipSpin.rotation.y += dt * 0.6;
    this.shipFlag?.(this.time);

    // ---- tsunami + damage ----------------------------------------
    // bow punch first: how deep the forefoot is buried in the face of the
    // wave in front of it (deck-at-waterline = 1). Drives the wall of white
    // water off the stem, the sheet flow across the deck, the droplets that
    // hit the bridge glass and the shudder through the hull — the whole
    // "crashing through a wave" experience.
    if (!this._bowLocal) {
      this._bowLocal = new THREE.Vector3(150, 20, 0);
      this._bowWorld = new THREE.Vector3();
    }
    this._bowWorld.copy(this._bowLocal)
      .applyQuaternion(this.phys.quaternion).add(this.phys.position);
    const bowPunch = THREE.MathUtils.clamp(
      (this.field.heightAt(this._bowWorld.x, this._bowWorld.z) - this._bowWorld.y) / 3, 0, 1);

    const before = this.tsunami.state;
    this.tsunami.update(dt, this.time, this.phys, this.phys);
    if (before !== this.tsunami.state) {
      if (this.tsunami.state === 'active') this.hud.pushLog('海啸抵达舰体', this.time);
      if (this.tsunami.state === 'clearing') {
        this.hud.pushLog(
          `海啸通过 · 最大横摇 ${(this.tsunami.peakRoll * 57.2958).toFixed(1)}° / 最大纵摇 ${(this.tsunami.peakPitch * 57.2958).toFixed(1)}°`,
          this.time);
      }
    }

    this.damage.update(dt, this.phys, this.field, this.particles, this.time);
    // the ultra event: while the 30 m wave group is passing her, flooding
    // advances no matter what (see DamageModel.update). Latched — the escort
    // large waves replace the tier but must not lift the sentence.
    if (this.tsunami.tier?.id === 'ultra' && this.tsunami.active) {
      this.damage.ultraEvent = true;
    }
    this.damage.emitGreenWater(dt, this.phys, this.field, this.particles, this.time,
      Math.max(this.phys.slam, bowPunch * 0.8));
    for (const e of this.damage.events) {
      if (!e._logged) { e._logged = true; this.hud.pushLog(e.msg, e.t); }
    }
    if (this.phys.slam > 0.35 && this.time - (this._lastSlamSound || 0) > 0.5) {
      this._lastSlamSound = this.time;
      this.audio.hit(Math.min(1, this.phys.slam));
      this.rig.addShake(this.phys.slam * 0.5);
    }

    // ---- weather --------------------------------------------------
    // A squall builds and passes like weather does, over tens of seconds:
    // a first darkening while the wave is still inbound, full storm as it
    // arrives, then a slow clear. The sea itself swells with it — the
    // ambient wave field grows up to ~1.7× (field.agitation), while the
    // tsunami packet itself is untouched, so the mean sea level holds and
    // the event reads as one train pushing through a rising sea.
    const stormTarget = this.damage.state === 'sinking' || this.damage.state === 'lost'
      ? 1
      : this.tsunami.state === 'active' ? 1
        : this.tsunami.state === 'inbound' ? 0.45 : 0;
    this.storm += (stormTarget - this.storm) * (1 - Math.exp(-dt * 0.13));
    this.field.agitation += (1 + this.storm * 0.7 - this.field.agitation)
      * (1 - Math.exp(-dt * 0.13));
    this.skySys.setStorm(this.storm);
    this.ocean.setFog(this.skySys.scene.fog.color, this.skySys.fogDensity);
    this.rain.update(dt, this.camera.position, this.storm);
    // the cockpit glass only exists in the first-person bridge view
    this.cockpit.show(this.rig.mode === 'bridge');
    // glass wetness = storm rain PLUS spray thrown against the windows as
    // she punches through wave faces — even on an otherwise calm day you
    // see the bow wave hit the glass
    this.cockpit.update(dt, Math.min(1, this.storm + bowPunch * 0.85), this.time);

    // ---- fx -------------------------------------------------------
    const speed = this.phys.velocity.length();
    // how rough it is right now: 0 in a calm sea, up to 1 during a tsunami.
    // Drives spray volume and the size of the plumes off the bow.
    const seaState = this.field.tsuActive
      ? THREE.MathUtils.clamp(this.field.tsuHeight / 10, 0.35, 1) : 0;

    this.hullFoam.update(this.time, this.field, this.shipMesh, speed, this.phys.slam);
    this.wake.update(this.time, dt, this.field, this.shipMesh, speed);
    this.propWash.update(this.time, dt, this.field, this.shipMesh, this.phys.throttle);
    this.spray.update(dt, this.shipMesh, speed, this.phys.slam, this.field,
      seaState, this.phys.velocity.y, bowPunch);
    this.particles.update(dt, 0.6);

    // punching into a wave face: shudder + thud, once per plunge
    if (bowPunch > 0.45 && this.time - (this._lastPunch || 0) > 0.9) {
      this._lastPunch = this.time;
      this.audio.hit(Math.min(1, 0.3 + bowPunch * 0.6));
      this.rig.addShake(0.25 + bowPunch * 0.4);
    }

    // ---- camera / hud ---------------------------------------------
    // walk rig: first-person on the deck; keys steer the WALKER, not the ship
    const walking = this.rig.mode === 'walk';
    this.input.walkMode = walking;
    if (walking) this.rig.walkStep(dt, this.input.keys, this.shipMesh, this.field);
    this.rig.update(dt, this.shipMesh, this.field, this.tsunami.dir, speed);
    this.input.update(dt);
    this.audio.update(dt, {
      speed, throttle: this.phys.throttle,
      seaState: this.field.tsuActive ? this.field.tsuHeight : 1.2,
    });
    this.hud.update(dt, this.hudState());

    // ---- underwater safety net --------------------------------------
    // Every rig clamps itself above the surface, but between frames (heavy
    // pitch, a crest arriving mid-frame) a lens can still dip in. If it
    // does, the screen must read as green water — never black.
    {
      const cam = this.camera.position;
      const depth = this.field.heightAt(cam.x, cam.z) - cam.y;
      const el = this._uwEl || (this._uwEl = document.getElementById('underwater'));
      const want = THREE.MathUtils.clamp(depth / 1.5, 0, 1) * 0.9;
      if (Math.abs((this._uwOn || 0) - want) > 0.02) {
        this._uwOn = want;
        el.style.opacity = want.toFixed(2);
      }
    }

    // ---- sky follows the ship -------------------------------------
    this.skySys.followTarget(this.phys.position);

    // ---- end condition --------------------------------------------
    if (this.damage.state === 'lost' && this.lostAt === null) {
      this.lostAt = this.time;
      this.hud.pushLog('舰体沉没 · 记录已生成', this.time);
      this.audio.hit(1.0);
    }
    if (this.lostAt !== null && !this.resultShown && this.time - this.lostAt > 7) {
      this.resultShown = true;
      this.showResult();
    }
  }

  hudState() {
    return {
      ship: this.phys, waveField: this.field, tsunami: this.tsunami,
      damage: this.damage, time: this.time,
      showHelp: this.showHelp, paused: this.paused,
    };
  }

  showResult() {
    const t = this.tsunami;
    const capsized = this.damage.flood > 0.5 || this.phys.capsized;
    this.screens.showResult({
      title: capsized ? '舰 体 倾 覆' : '舰 体 沉 没',
      sub: capsized
        ? '横摇超过复原力矩极限，飞行甲板边缘入水，舰体丧失稳性。'
        : '大量进水导致储备浮力耗尽，舰体缓慢下沉。',
      roll: t.peakRoll * 57.2958,
      pitch: t.peakPitch * 57.2958,
      wave: t.height || 0,
      time: this.lostAt ?? this.time,
    });
    this.hud.show(false);
  }

  render() {
    this.ocean.setCamDist(this.camera.position.distanceTo(this.phys.position));
    // grid follows the SHIP so the finest cells always sit at the waterline
    this.ocean.update(this.time, this.phys.position, this.field);
    this.composer ? this.composer.render() : this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w, h);
  }

  /**
   * Fast-forward the simulation by `seconds` at a fixed 60 Hz.
   * Used by the offline capture tooling: software-rendered browsers run far
   * below real time, so the tsunami encounter would otherwise take minutes of
   * wall clock to reach.
   */
  advance(seconds, stepHz = 60) {
    const h = 1 / stepHz;
    const n = Math.max(1, Math.round(seconds * stepHz));
    for (let i = 0; i < n; i++) this.step(h);
    return this.time;
  }
}

const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  const el = document.getElementById('barMsg');
  if (el) el.textContent = `启动失败: ${e.message}`;
});
window.__game = game;
