/**
 * sky.js — physically based sky, sun, atmosphere, fog and environment map.
 * The same sky is baked into a cube map that the ocean shader uses for
 * reflections and that PBR materials use for image based lighting.
 */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export class SkySystem {
  constructor(renderer, scene, shadowSize = 2048) {
    this.renderer = renderer;
    this.scene = scene;

    // --- atmosphere -------------------------------------------------
    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6.5;
    u.rayleigh.value = 2.2;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.82;

    this.sunElevation = 26;
    this.sunAzimuth = 118;
    scene.add(this.sky);

    // --- sun --------------------------------------------------------
    this.sunDir = new THREE.Vector3();
    // Strong, low-ish sun + little fill light = high contrast, long shadows.
    // This is what makes the ship read as a solid object instead of a flat
    // grey cut-out; the previous soft setup washed the horizon to white.
    this.sunLight = new THREE.DirectionalLight(0xfff2dd, 2.9);
    this.sunLight.castShadow = true;
    const s = this.sunLight.shadow;
    // wired to the quality preset (the QUALITY.shadow tiers were previously
    // never applied — the map was hard-coded at 2048 on every tier)
    s.mapSize.set(shadowSize, shadowSize);
    s.camera.near = 1;
    s.camera.far = 1600;
    const d = 420;
    s.camera.left = -d; s.camera.right = d;
    s.camera.top = d;   s.camera.bottom = -d;
    s.bias = -0.0006;
    s.normalBias = 0.9;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    // ambient / bounce light from sky + sea. The GROUND colour is the sea
    // itself here — tinting it sea-green is what puts the characteristic
    // water bounce on the hull's underside and gallery structure, instead of
    // a generic dark void fill. Kept low: the Preetham sky outputs radiance
    // well above 1.0, so a "normal looking" fill washes materials out.
    this.hemi = new THREE.HemisphereLight(0xbfd8f0, 0x1d4a52, 0.32);
    scene.add(this.hemi);

    // --- fog --------------------------------------------------------
    // dense enough that the 12 km ocean edge is fully hidden at the horizon
    scene.fog = new THREE.FogExp2(0x9fb3c4, 0.000145);
    this.fogDensity = 0.000145;

    // --- environment map -------------------------------------------
    this.cubeRT = new THREE.WebGLCubeRenderTarget(256, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this.cubeCam = new THREE.CubeCamera(1, 500000, this.cubeRT);
    scene.add(this.cubeCam);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    this.setSun(this.sunElevation, this.sunAzimuth);
  }

  setSun(elevationDeg, azimuthDeg) {
    this.sunElevation = elevationDeg;
    this.sunAzimuth = azimuthDeg;
    const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
    const theta = THREE.MathUtils.degToRad(azimuthDeg);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.sunLight.position.copy(this.sunDir).multiplyScalar(900);
    this.sunLight.target.position.set(0, 0, 0);
    this.rebuildEnv();
  }

  /** Keep the shadow frustum centred on the player. */
  followTarget(pos) {
    this.sunLight.position.copy(this.sunDir).multiplyScalar(900).add(pos);
    this.sunLight.target.position.copy(pos);
    this.sunLight.target.updateMatrixWorld();
    this.cubeCam.position.copy(pos);
  }

  /** Bake the sky into a cube map (reflections) + PMREM (IBL). */
  rebuildEnv() {
    const s = this.scene;
    const prevEnv = s.environment;
    const prevFog = s.fog;
    const prevBg = s.background;

    // only the sky dome is visible while baking
    this.sky.visible = true;
    s.fog = null;
    s.background = null;
    this.cubeCam.update(this.renderer, s);

    if (this._pmremRT) this._pmremRT.dispose();
    this._pmremRT = this.pmrem.fromCubemap(this.cubeRT.texture);
    s.environment = this._pmremRT.texture;
    s.environmentIntensity = 0.42;

    s.fog = prevFog;
    s.background = prevBg;
    if (prevEnv && prevEnv !== this._pmremRT.texture) { /* keep old alive */ }

    this.envMap = this.cubeRT.texture;
    this.updateFogFromSky();
  }

  /** Sample the baked sky near the horizon so fog colour matches the haze. */
  updateFogFromSky() {
    // horizon-ish direction, away from the sun
    const dir = new THREE.Vector3(-this.sunDir.x, 0.02, -this.sunDir.z).normalize();
    const col = this.sampleCube(dir);
    const horizon = new THREE.Color().copy(col);
    // average with a slightly brighter sky for a soft haze
    horizon.lerp(new THREE.Color(0.78, 0.84, 0.90), 0.45);
    this.scene.fog.color.copy(horizon);
    this.fogColor = horizon.clone();
  }

  sampleCube(dir) {
    // cheap: read the cube texture through a 1x1 render? Instead approximate
    // analytically from the Preetham parameters we set.
    const e = Math.max(0, this.sunElevation) / 90;
    const sunUp = Math.max(0, this.sunDir.y);
    const base = new THREE.Color(0.62, 0.72, 0.84);
    const warm = new THREE.Color(0.95, 0.80, 0.62);
    const c = base.clone().lerp(warm, Math.pow(1 - e, 2.2) * 0.7);
    // look toward the sun a bit brighter
    const toward = Math.max(0, dir.x * this.sunDir.x + dir.z * this.sunDir.z);
    c.lerp(new THREE.Color(1.0, 0.92, 0.78), toward * 0.18 * (1 - sunUp * 0.4));
    return c;
  }

  /**
   * Storm state, 0 (calm) .. 1 (full squall). Called every frame from the main
   * loop, so it is cheap by design: it only nudges uniform/intensity values.
   *
   * A squall is DARKNESS and RAIN, not fog: the sun collapses, the sky
   * greys over and the palette goes cold slate — but the horizon stays
   * visible (fog rises only ~40%, not the old ×8.6 that read as pea soup
   * the instant a tsunami was fired).
   */
  setStorm(t) {
    const k = THREE.MathUtils.clamp(t, 0, 1);
    this._storm = k;
    this.sunLight.intensity = 2.9 - k * 2.2;      // 2.9 -> 0.7
    this.hemi.intensity = 0.32 + k * 0.12;        // storm overcast lifts ambient
    // heavy, dark overcast
    this.sky.material.uniforms.turbidity.value = 6.5 + k * 9.5;
    this.sky.material.uniforms.rayleigh.value = 2.2 + k * 0.5;
    this.sky.material.uniforms.mieCoefficient.value = 0.005 + k * 0.020;
    this.sky.material.uniforms.mieDirectionalG.value = 0.82 + k * 0.10;

    const dens = 0.000145 + k * 0.00006;          // barely hazier, no fog wall
    this.scene.fog.density = dens;
    this.fogDensity = dens;
    if (this.fogColor) {
      const storm = new THREE.Color(0.34, 0.39, 0.46);
      this.scene.fog.color.copy(this.fogColor).lerp(storm, k);
    }
    if (this.scene.environmentIntensity !== undefined) {
      this.scene.environmentIntensity = 0.42 - k * 0.26;
    }
  }

  dispose() {
    this.pmrem.dispose();
    this.cubeRT.dispose();
    this._pmremRT?.dispose();
  }
}
