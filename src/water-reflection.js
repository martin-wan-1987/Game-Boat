import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

/** Planar mean-water reflection. Wave normals distort this image in Ocean;
 * the physical height field stays unchanged. Render only ship and sky, never
 * the water or its effects, to avoid a render-target feedback loop.
 */
export class WaterReflection {
  constructor(width, height) {
    this.reflector = new Reflector(new THREE.PlaneGeometry(1, 1), {
      textureWidth: width, textureHeight: height, clipBias: 0.002, multisample: 0,
    });
    this.reflector.rotation.x = -Math.PI / 2;
    this.reflector.updateMatrixWorld(true);
    this.worldToUV = new THREE.Matrix4();
    this.worldToLocal = this.reflector.matrixWorld.clone().invert();
    this.texture = this.reflector.getRenderTarget().texture;
  }
  resize(width, height) { this.reflector.getRenderTarget().setSize(width, height); }
  update(renderer, scene, camera, excluded) {
    const visibility = excluded.map(object => object.visible);
    excluded.forEach(object => { object.visible = false; });
    camera.updateMatrixWorld();
    try {
      this.reflector.onBeforeRender(renderer, scene, camera);
      this.worldToUV.copy(this.reflector.material.uniforms.textureMatrix.value).multiply(this.worldToLocal);
    } finally {
      excluded.forEach((object, i) => { object.visible = visibility[i]; });
    }
  }
}
