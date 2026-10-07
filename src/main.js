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
import { SHIP } from './carrier-layout.js';
import { FLEET, FLEET_BY_ID } from './fleet.js';
import { AtmospherePass } from './atmosphere.js';
import { ShipPhysics } from './physics.js';
import { CameraRig, HOME_ORBIT } from './camera.js';
import {cameraModes} from './vessel-capabilities.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Screens } from './ui.js';
import { TsunamiManager, TSUNAMI_TIERS, SEA_STATE } from './tsunami.js';
import { DamageModel } from './damage.js';
import { Particles, Rain } from './fx.js';
import { VesselWaterFX } from './vessel-water.js';
import { WaterReflection } from './water-reflection.js';
import { CockpitOverlay } from './cockpit.js';
import { Audio } from './audio.js';
import {Searchlights,makeSearchlightUniforms} from './searchlights.js';
import {Meteors,meteorWave} from './meteors.js';
import {RandomSea} from './random-sea.js';
import {SolidWater} from './solid-water.js';
import {Islands} from './islands.js';
import {CarrierAircraft} from './aircraft.js';

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
    this.manualNight=new URLSearchParams(location.search).get('night')==='1';
    this.vesselId=FLEET_BY_ID[new URLSearchParams(location.search).get('ship')]?.spec.id??SHIP.id;
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
      onVessel: (id) => this.selectVessel(id),
      onAgain: () => this.startGame(this.mode),
      onExit: () => this.exitToLobby(),
      onResume: () => { this.paused = false; },
      onNight:()=>this.toggleNight(),
      getNight:()=>this.manualNight,
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

    // Keep the loading screen up until material programs and the real
    // postprocessing path are ready; progress alone is not a readiness signal.
    this.screens.setProgress(100, '编译着色器 · 稍候');
    this.screens.enableEnter(false);
    document.getElementById('enterBtn').addEventListener('click', () => {
      this.audio.init();
      this.audio.resume();
      this.screens.show('lobby');
    });
    this.rig._snap = true;
    this.rig.update(0, this.shipMesh, this.field, this.tsunami.dir);
    // Compile all scene materials (including ones outside the boot camera's
    // frustum) against the same target RenderPass uses, rather than the screen.
    // Both vessels and all weather/wave materials warm on the real linear
    // composer path before entry. Selection cannot compile a new variant.
    const selected=this.vesselId,target=this.renderer.getRenderTarget(),shadow=this.skySys.sunLight.castShadow;
    try {
      for(const id of Object.keys(this.vessels)) {
        this.selectVessel(id);
        this.rig.update(0,this.shipMesh,this.field,this.tsunami.dir);
        this.meteors.warmup(true);this.skySys.setStorm(1,1);this.updateSearchlights();
        this.field.replacePackets([{x:4000,z:0,dirX:1,dirZ:0,height:30,thickness:210,lateralWidth:2200,speed:18}]);
        this.shipMesh.userData.weapons.warmup(true);
        this.skySys.setStorm(1);this.rain.mesh.visible=true;this.rain.mat.opacity=.4;
        for(const castShadow of [shadow,false]){
          this.skySys.sunLight.castShadow=castShadow;
          this.renderer.setRenderTarget(this.composer.readBuffer);
          await this.renderer.compileAsync(this.scene,this.camera);
          this.renderer.setRenderTarget(target);this.render();
        }
        this.shipMesh.userData.weapons.warmup(false);
      }
    } finally {
      this.renderer.setRenderTarget(target);this.skySys.sunLight.castShadow=shadow;this.selectVessel(selected);
      this.field.clearPackets();this.rain.mesh.visible=false;this.rain.mat.opacity=0;
      this.meteors.warmup(false);
      this.skySys.time=this.time;this.skySys.setStorm(this.storm);
    }

    this.render();
    this.screens.setProgress(100, '就绪');
    this.screens.enableEnter(true);
    if (new URLSearchParams(location.search).get('play') === '1') this.startGame(new URLSearchParams(location.search).get('mode')==='random'?'random':'free');

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
    this.renderer.toneMappingExposure = 0.72;
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
    this.searchlightUniforms=makeSearchlightUniforms();
    this.skySys = new SkySystem(this.renderer, this.scene, this.q.shadow);
    this.rig = new CameraRig(this.camera);
  }

  buildWaves() {
    this.solidWater=new SolidWater(Math.max(...FLEET.map(({spec})=>spec.deckOutline.length)));
    this.waveUniforms = makeWaveUniforms(THREE);
    this.field = new WaveField();
    // Shared 5.6 m significant wave height and four-direction spectrum.
    this.field.buildSea(SEA_STATE.hs, 1, 0, SEA_STATE.spread, SEA_STATE.peakLength, SEA_STATE.directions);
    this.ocean = new Ocean({
      waveUniforms: this.waveUniforms,
      searchlightUniforms:this.searchlightUniforms,
      solidWater:this.solidWater,
      extent: 12000, seg: this.q.oceanSeg, grade: this.q.grade,
      quality: this.quality,
    });
    this.scene.add(this.ocean.mesh);
    this.islands=new Islands(this.waveUniforms,this.ocean.foamTex);this.scene.add(this.islands.group);
    Object.assign(this.ocean.uniforms,this.islands.uniforms);
  }

  get activeVessel(){return this.vessels[this.vesselId];}
  get shipMesh(){return this.activeVessel.mesh;}
  get phys(){return this.activeVessel.physics;}
  get waterFX(){return this.activeVessel.waterFX;}
  get damage(){return this.activeVessel.damage;}
  get vessel(){return this.shipMesh.userData.vessel;}

  buildShip() {
    this.vessels=Object.fromEntries(FLEET.map(({build})=>{
      const mesh=build({quality:this.q.shipDetail});
      mesh.userData.searchlights=new Searchlights(mesh.userData.vessel);mesh.add(mesh.userData.searchlights.group);
      mesh.visible=mesh.userData.vessel.id===this.vesselId;this.scene.add(mesh);
      return [mesh.userData.vessel.id,{mesh,aircraft:new CarrierAircraft(mesh.userData.vessel)}];
    }));
  }
  buildPhysics() {
    for(const entry of Object.values(this.vessels)){
      entry.physics=new ShipPhysics(entry.mesh.userData.patches,{vessel:entry.mesh.userData.vessel});
      entry.physics.reset(0,0,0);entry.physics.localToWorld(new THREE.Vector3(),entry.mesh.position);
    }
  }
  selectVessel(id) {
    this.vesselId=id;
    for(const [key,entry] of Object.entries(this.vessels)){
      const visible=key===id;entry.mesh.visible=visible;entry.waterFX.foam.visible=visible;entry.waterFX.drops.visible=visible;
      entry.aircraft.group.visible=visible;
      entry.mesh.userData.weapons.tracers.mesh.visible=visible;
    }
    this.rig.setVessel(this.vessel);this.screens.setVessel(this.vessel);this.resetScenario();
    this.camera.near=Math.min(.9,this.vessel.length*.00263);this.camera.updateProjectionMatrix();
    this.skySys.sunLight.shadow.normalBias=Math.min(1.4,this.vessel.length*.00409);
  }

  buildEnv() {
    this.skySys.followTarget(new THREE.Vector3());
    this.ocean.setEnvMap(this.skySys.envMap);
    this.ocean.setClouds(this.skySys.clouds);
    const sunCol = new THREE.Color(1.0, 0.91, 0.78);
    this.ocean.setSun(this.skySys.sunDir, sunCol);
    this.ocean.setFog(this.skySys.scene.fog.color, this.skySys.fogDensity);
    this.waterReflection = new WaterReflection(Math.ceil(innerWidth * 0.5), Math.ceil(innerHeight * 0.5));
    this.ocean.setReflection(this.waterReflection.texture, this.waterReflection.worldToUV);
  }

  buildFX() {
    this.particles = new Particles(this.q.particles);
    for(const [id,entry] of Object.entries(this.vessels)) {
      const {vessel,loft}=entry.mesh.userData;
      entry.waterFX=new VesselWaterFX(this.waveUniforms,{vessel,loft,tex:this.ocean.foamTex,
        solidWater:this.solidWater,islands:this.islands,
        particles:this.q.particles*2,pixelRatio:this.renderer.getPixelRatio()});
      entry.waterFX.foam.visible=entry.waterFX.drops.visible=id===this.vesselId;
      this.scene.add(entry.waterFX.foam,entry.waterFX.drops);entry.damage=new DamageModel(vessel);
      this.scene.add(entry.aircraft.group);entry.aircraft.group.visible=id===this.vesselId;
    }
    this.scene.add(this.particles.points);this.particles.setPixelRatio(this.renderer.getPixelRatio());
    this.tsunami=new TsunamiManager(this.field);
    this.meteors=new Meteors();this.scene.add(this.meteors.group);this.randomSea=new RandomSea();
    for(const entry of Object.values(this.vessels))this.scene.add(entry.mesh.userData.weapons.tracers.mesh);
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
      onAnchor: () => this.toggleAnchor(),
      onNight:()=>this.toggleNight(),
    });
  }

  buildPost() {
    const target=new THREE.WebGLRenderTarget(innerWidth,innerHeight,{type:THREE.HalfFloatType,depthBuffer:true,
      depthTexture:new THREE.DepthTexture(innerWidth,innerHeight)});
    this.composer = new EffectComposer(this.renderer,target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.atmosphere=new AtmospherePass(this.camera,this.skySys.clouds,this.skySys.sunLight,this.searchlightUniforms);this.composer.addPass(this.atmosphere);
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
      onMainFire: () => this.fireMainGun(),
      onSalvo:()=>this.requestSalvo(),onGunSide:side=>this.setGunSide(side),
      onPeriscope:()=>this.togglePeriscope(),
    });
  }

  /* ---------------- flow ---------------- */
  startGame(mode) {
    this.mode = mode;
    this.screens.setMode(mode);
    this.screens.hideAll();
    this.hud.show(true);
    this.resetScenario();
    this.running = true;
    this.paused = false;
    this.resultShown = false;
    this.lostAt = null;
    this.audio.init();
    this.audio.resume();
    this.screens.setNight(this.manualNight,mode);
    this.hud.pushLog(mode==='random'?'启航 · 随机海况 · 昼夜自动交替':'启航 · 普通模式 · 自由航行', 0);
    this.hud.pushLog('恶劣海况 · 四面交叉涌浪约 5–6 米', 0);
  }

  exitToLobby() {
    this.running = false;
    this.hud.show(false);
  }

  resetScenario() {
    this.phys.reset(0, 0, 0);
    this.phys.throttle = 0;
    this.phys.rudder = 0;
    this.phys.anchor.reset();
    this.damage.reset();
    this.tsunami.reset();
    this.meteors?.reset();this.randomSea?.reset();
    this.field.time = 0;
    this.waterFX.reset();
    this.shipMesh.userData.weapons.reset();this.input.release();
    this.shipMesh.userData.periscope?.reset();this.particles.reset();this.islands.sprayDebt=0;
    this.time = 0;
    this.alertFired = false;
    this.hud.setThrottle(0);
    this.input.setThrottle(0);
    this.hud.logs.length = 0;
    Object.assign(this.rig, this.rig.home);
    this.acc=0;this.field.agitation=1;this.phys.localToWorld(new THREE.Vector3(),this.shipMesh.position);
    this.shipMesh.quaternion.copy(this.phys.quaternion);
    this.activeVessel.aircraft.reset(this.shipMesh,this.phys);
    document.getElementById('periscopeView').hidden=true;
    // The rig has been sitting at the world origin (inside the hull) since
    // boot — while the lobby covered the screen that was invisible. Without
    // this snap the first seconds of play lerp the lens out THROUGH the hull,
    // whose unlit DoubleSide interior flashes black across the view.
    this.rig._snap = true;
    this.storm = .42;
    this.skySys?.setStorm(this.storm,this.mode==='random'?this.randomSea.nightTarget:Number(this.manualNight));
    this.cockpit?.show(false);
  }

  fireTsunami(tierId) {
    if (!this.running||this.mode!=='free') return;
    // Free mode: fire as often as you like. A new event REPLACES the wave
    // train that is still running — the manager replaces its packet set, so
    // there is no state to clean up here.
    const tier = TSUNAMI_TIERS[tierId];
    if (!tier) return;
    this.tsunami.trigger(tierId, this.phys, this.time);
    this.hud.pushLog(`探测到${tier.label} · 浪高 ${this.tsunami.height.toFixed(1)} m`, this.time);
    this.audio.alarm(tier.danger >= 0.7 ? 2 : 1);
    this.alertFired = true;
  }

  toggleAnchor() {
    if (!this.running || this.paused || this.showHelp) return;
    const p = this.phys;
    if (p.anchor.phase === 'lowering') return;
    if (p.anchor.phase === 'stowed') {
      const bow = p.localToWorld(new THREE.Vector3(this.vessel.length / 2 - 4, 0, 0),new THREE.Vector3());
      bow.y = 0;
      p.anchor.drop(bow);
      this.hud.pushLog('正在抛锚 · 3 秒后到底', this.time);
    } else {
      p.anchor.reset();
      this.hud.pushLog('起锚', this.time);
    }
  }

  toggleNight(){
    this.manualNight=!this.manualNight;
    this.screens.setNight(this.manualNight,this.screens.mode);
    if(!this.running)this.skySys.setStorm(this.storm,Number(this.manualNight));
  }
  updateSearchlights(){this.shipMesh.userData.searchlights.update(this.skySys.night,this.searchlightUniforms);}

  fireMainGun(){
    if(!this.running||this.paused||this.showHelp)return;
    const weapons=this.shipMesh.userData.weapons;
    weapons.requestMain();
    weapons.update(0,{main:true,onShot:shot=>this.gunShot(shot)});
  }
  requestSalvo(){
    if(!this.running||this.paused||this.showHelp)return;
    this.shipMesh.userData.weapons.requestSalvo();
  }
  setGunSide(side){
    if(!this.running||this.paused||this.showHelp)return;
    this.shipMesh.userData.weapons.setSide(side);
  }
  gunShot({spec,origin,direction,recoilScale}){
    const calibre=spec.radius*2,projectileMass=7800*Math.PI*(calibre/2)**2*calibre*5;
    this.phys.applyImpulseAtPoint(direction.clone().multiplyScalar(-projectileMass*780*recoilScale),origin);
    const count=Math.ceil(12+calibre*80),spread=calibre*7;
    for(let i=0;i<count;i++){
      const velocity=direction.clone().multiplyScalar(6+Math.random()*15);
      velocity.x+=(Math.random()-.5)*spread;velocity.y+=(Math.random()-.5)*spread;velocity.z+=(Math.random()-.5)*spread;
      this.particles.spawn(origin.x,origin.y,origin.z,velocity.x,velocity.y,velocity.z,1.3+Math.random()*1.8,.8+calibre*6,3);
    }
    this.rig.addShake(Math.min(.42,calibre*recoilScale*.18));this.audio.hit(Math.min(.6,calibre*1.1));
  }
  togglePeriscope(){
    const optic=this.shipMesh.userData.periscope;
    if(!optic||!this.running||this.paused||this.showHelp)return;
    optic.toggle();this.input.release();this.rig._snap=true;
    this.hud.pushLog(optic.raised?'潜望镜升起中 · 舰岛视角可观察':'潜望镜收起中',this.time);
  }
  cameraView(){
    const optic=this.shipMesh.userData.periscope,bridgeOptic=optic?.mirrorView(this.rig.mode)??false;
    return {bridgeOptic,bridgeEye:bridgeOptic?optic.localEye(this.shipMesh,new THREE.Vector3()).toArray():null};
  }

  setCamera(mode) {
    if(!this.rig.setMode(mode))return;
    this.input.walkMode = mode === 'walk';
    this.hud.setCamera(mode);
  }

  cycleCamera() {
    const modes = cameraModes(this.vessel);
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

    if (!this.paused && !this.showHelp && dt>0) {
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
    for(const v of Object.values(this.vessels))v.waterFX.resize(innerHeight,r);
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
    const anchorBefore = this.phys.anchor.phase;
    while (this.acc >= h && sub < 6) {
      this.phys.rudder = this.input.rudder;
      this.phys.step(h, this.field);
      this.islands.collide(this.phys,h);
      this.acc -= h;
      sub++;
    }
    if (anchorBefore === 'lowering' && this.phys.anchor.phase === 'set') {
      this.hud.pushLog('锚链已经到底', this.time);
    }
    // After a stall (shader compile, GC, tab switch) the backlog would make
    // every following frame run the full 6 substeps, stretching the stall
    // into a spiral. Debt older than 100 ms is simply dropped — the sea does
    // not care about 100 ms of missed buoyancy.
    if (this.acc > 0.1) this.acc = 0;

    this.phys.localToWorld(new THREE.Vector3(),this.shipMesh.position);
    this.shipMesh.quaternion.copy(this.phys.quaternion);
    const parts=this.shipMesh.userData;
    if(parts.spin)parts.spin.rotation.y+=dt*.6;
    if(parts.searchRadar)parts.searchRadar.rotation.y+=dt*.9;
    parts.flagAnimate?.(this.time);
    parts.propulsion.update(dt,this.phys.throttle,this.phys.speedKnots,this.phys.rudderAngle);
    if(this.mode==='random'){
      const scheduled=this.randomSea.update(this.time,this.phys,this.tsunami,this.meteors);
      if(scheduled.phaseChanged)this.hud.pushLog(this.randomSea.nightTarget?'夜幕降临 · 留意陨石':'天亮 · 留意随机海啸',this.time);
      if(scheduled.event){
        this.hud.pushLog(scheduled.event.kind==='meteor'?`陨石来袭 · ${scheduled.event.count} 块碎石；军舰长按近防炮拦截`:`随机海啸 · 浪高 ${scheduled.event.height.toFixed(1)} m`,this.time);
        this.audio.alarm(2);
      }
    }
    this.meteors.prepare(dt,this.field,this.shipMesh);
    parts.weapons.update(dt,{main:this.input.keys.has('f'),ciws:this.input.keys.has('v'),rotate:Number(this.input.keys.has('l'))-Number(this.input.keys.has('j')),night:this.skySys.night,
      onShot:shot=>this.gunShot(shot),
      targets:this.meteors.fragments,onIntercept:(rock,point)=>this.meteors.intercept(rock,this.particles,point),field:this.field});
    this.meteors.resolve({time:this.time,particles:this.particles,
      onSea:(rock,point)=>{
        this.tsunami.triggerSpec(meteorWave(rock.waveHeight),this.phys,this.time,{height:rock.waveHeight,epicentre:point});
        this.hud.pushLog(`陨石入海 · ${rock.waveHeight.toFixed(1)} m 环形海啸`,this.time);this.rig.addShake(.75);this.audio.hit(1);
      },
      onHull:(rock,point)=>{
        const mass=2800*4*Math.PI*rock.radius**3/3,relative=rock.velocity.clone().sub(this.phys.velocity);
        this.damage.impact(.5*mass*relative.lengthSq(),this.shipMesh.worldToLocal(point.clone()),this.time,this.phys.mass);
        this.rig.addShake(.25);this.audio.hit(.5);
      }});

    // ---- tsunami + damage ----------------------------------------
    // bow punch first: how deep the forefoot is buried in the face of the
    // wave in front of it (deck-at-waterline = 1). Drives the wall of white
    // water off the stem, the sheet flow across the deck, the droplets that
    // hit the bridge glass and the shudder through the hull — the whole
    // "crashing through a wave" experience.
    if (!this._bowLocal) {
      this._bowLocal = new THREE.Vector3();
      this._bowWorld = new THREE.Vector3();
    }
    this._bowLocal.set(this.vessel.length*.44,this.vessel.deckY,0);
    this.phys.localToWorld(this._bowLocal,this._bowWorld);
    const bowPunch = THREE.MathUtils.clamp(
      (this.field.heightAt(this._bowWorld.x, this._bowWorld.z) - this._bowWorld.y) / 3, 0, 1);

    const before = this.tsunami.state;
    this.tsunami.update(dt, this.time, this.phys, this.phys);
    if (before !== this.tsunami.state) {
      if (this.tsunami.state === 'active') this.hud.pushLog(`${this.tsunami.tier.label}抵达舰体`, this.time);
      if (this.tsunami.state === 'clearing') {
        this.hud.pushLog(
          `${this.tsunami.tier.label}通过 · 最大横摇 ${(this.tsunami.peakRoll * 57.2958).toFixed(1)}° / 最大纵摇 ${(this.tsunami.peakPitch * 57.2958).toFixed(1)}°`,
          this.time);
      }
    }

    this.damage.update(dt, this.phys, this.field, this.particles, this.time);
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
    const waveStorm = this.tsunami.tier?.storm ?? 1;
    const stormTarget = this.damage.state === 'sinking' || this.damage.state === 'lost'
      ? 1
      : this.tsunami.state === 'active' ? waveStorm
        : this.tsunami.state === 'inbound' ? Math.max(.42, .65 * waveStorm) : .42;
    this.storm += (stormTarget - this.storm) * (1 - Math.exp(-dt * 0.13));
    this.field.agitation += (1 - this.field.agitation)
      * (1 - Math.exp(-dt * 0.13));
    const nightTarget=this.mode==='random'?this.randomSea.nightTarget:Number(this.manualNight);
    const night=this.skySys.night+(nightTarget-this.skySys.night)*(1-Math.exp(-dt*.55));
    this.skySys.time=this.time;this.skySys.setStorm(this.storm,night);
    this.ocean.setFog(this.skySys.scene.fog.color, this.skySys.fogDensity);
    this.rain.update(dt, this.camera.position, this.storm);
    // the cockpit glass only exists in the first-person bridge view
    this.shipMesh.userData.periscope?.update(dt);
    const cameraView=this.cameraView();
    this.cockpit.show(this.rig.mode === 'bridge'&&!cameraView.bridgeOptic);
    // glass wetness = storm rain PLUS spray thrown against the windows as
    // she punches through wave faces — even on an otherwise calm day you
    // see the bow wave hit the glass
    this.cockpit.update(dt, Math.min(1, this.storm + bowPunch * 0.85), this.time);

    // ---- fx -------------------------------------------------------
    const speed = Math.hypot(this.phys.velocity.x, this.phys.velocity.z);
    this.waterFX.update(this.time, dt, this.field, this.shipMesh, this.phys);
    this.activeVessel.aircraft.update(dt,this.shipMesh,this.phys,this.field,this.particles);
    this.islands.update(dt,this.field,this.shipMesh,this.particles,this.skySys.night);
    this.particles.update(dt, 0.6,this.field);

    // punching into a wave face: shudder + thud, once per plunge
    if (bowPunch > 0.45 && this.time - (this._lastPunch || 0) > 0.9) {
      this._lastPunch = this.time;
      this.audio.hit(Math.min(1, 0.3 + bowPunch * 0.6));
      this.rig.addShake(0.25 + bowPunch * 0.4);
    }

    // ---- camera / hud ---------------------------------------------
    // walk rig: first-person on the deck; keys steer the WALKER, not the ship
    const walking = this.rig.mode === 'walk';
    if (walking) this.rig.walkStep(dt, this.input.keys, this.shipMesh, this.field);
    this.rig.update(dt, this.shipMesh, this.field, this.tsunami.dir, speed,cameraView);
    this.input.update(dt);
    this.audio.update(dt, {
      speed, throttle: this.phys.throttle,
      seaState: this.tsunami.active ? this.tsunami.height : this.field.significantSeaHeight,
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
      mode:this.mode,night:this.manualNight,meteors:this.meteors,weapons:this.shipMesh.userData.weapons,
      periscope:this.shipMesh.userData.periscope,aircraft:this.activeVessel.aircraft,
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
    this.solidWater.update(this.shipMesh);
    document.getElementById('periscopeView').hidden=!this.shipMesh.userData.periscope?.mirrorView(this.rig.mode)||this.paused||this.showHelp||!this.hud.el.hud.classList.contains('on');
    this.updateSearchlights();this.ocean.setSun(this.skySys.sunDir,this.skySys.sunLight.color);
    this.ocean.setCamDist(this.camera.position.distanceTo(this.phys.position));
    // grid follows the SHIP so the finest cells always sit at the waterline
    this.ocean.update(this.time, this.phys.position, this.field);
    this.ocean.uniforms.uSunStrength.value = this.skySys.sunLight.intensity;
    this.waterReflection.update(this.renderer, this.scene, this.camera,
      [this.ocean.mesh,...Object.values(this.vessels).flatMap(v=>[v.waterFX.foam,v.waterFX.drops]),this.particles.points,this.rain.mesh]);
    this.composer ? this.composer.render() : this.renderer.render(this.scene, this.camera);
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.bloom?.setSize(w, h);
    this.waterReflection.resize(Math.ceil(w * 0.5), Math.ceil(h * 0.5));
    for(const v of Object.values(this.vessels))v.waterFX.resize(h,this.renderer.getPixelRatio());
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
