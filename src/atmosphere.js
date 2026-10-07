import * as THREE from 'three';
import {Pass,FullScreenQuad} from 'three/addons/postprocessing/Pass.js';
import {searchlightGLSL} from './searchlights.js';

/** A single cloud transmission field for visible clouds and air scattering. */
export const CLOUD={altitude:1100,scale:.0013,coverage:.62,opticalDepth:4.6,wind:[.0036,.0012]};
export function cloudGLSL(){return /* glsl */`
uniform float uAirTime,uCloudCover,uNight;
float cloudHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float cloudNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(cloudHash(i),cloudHash(i+vec2(1,0)),f.x),mix(cloudHash(i+vec2(0,1)),cloudHash(i+vec2(1,1)),f.x),f.y);}
float cloudField(vec2 p){
  p=p*${CLOUD.scale.toFixed(8)}+vec2(${CLOUD.wind.map(x=>x.toFixed(6)).join(',')})*uAirTime;
  float f=0.0,a=.57;
  for(int i=0;i<4;i++){f+=a*cloudNoise(p);p=mat2(1.65,-1.20,1.20,1.65)*p+vec2(2.1,1.7);a*=.48;}
  return smoothstep(uCloudCover-.16,uCloudCover+.18,f);
}
float cloudTransmission(vec3 p,vec3 sun){
  vec2 source=p.xz+sun.xz*max(0.0,${CLOUD.altitude.toFixed(1)}-p.y)/sun.y;
  return exp(-${CLOUD.opticalDepth.toFixed(3)}*cloudField(source));
}`;}

export class CloudLayer {
  constructor(sun,nightUniform){
    this.uniforms={uAirTime:{value:0},uCloudCover:{value:CLOUD.coverage},uCloudSun:{value:sun},uNight:nightUniform};
    this.mesh=new THREE.Mesh(new THREE.SphereGeometry(24000,32,16),new THREE.ShaderMaterial({
      name:'Maritime cloud layer',uniforms:this.uniforms,side:THREE.BackSide,transparent:true,depthWrite:false,
      vertexShader:'varying vec3 vCloudWorld;void main(){vCloudWorld=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vCloudWorld,1.0);}',
      fragmentShader:`${cloudGLSL()}
        uniform vec3 uCloudSun;varying vec3 vCloudWorld;
        void main(){
          vec3 ray=normalize(vCloudWorld-cameraPosition);
          float fade=smoothstep(.015,.11,ray.y);
          vec2 p=cameraPosition.xz+ray.xz*max(0.0,${CLOUD.altitude.toFixed(1)}-cameraPosition.y)/max(.015,ray.y);
          float density=cloudField(p),forward=pow(max(dot(ray,uCloudSun),0.0),12.0);
          float alpha=(1.0-exp(-density*4.0/max(.3,ray.y)))*fade;
          vec3 colour=mix(vec3(.12,.16,.21),vec3(.48,.55,.62),exp(-density*2.2));
          colour+=vec3(.63,.55,.40)*forward*pow(1.0-density,2.0)*.9;
          colour=mix(colour,vec3(.022,.034,.058)+colour*.08,uNight);
          gl_FragColor=vec4(colour,alpha);
        }`,
    }));
    this.mesh.renderOrder=-1;this.mesh.frustumCulled=false;
  }
  update(time,storm){this.uniforms.uAirTime.value=time;this.uniforms.uCloudCover.value=CLOUD.coverage-storm*.12;}
}

/** Single scattering integrated against the current scene depth. Beer–Lambert
 * attenuation and the same cloud shadow create localized sun shafts. */
export class AtmospherePass extends Pass {
  constructor(camera,cloud,sunLight,searchlightUniforms){
    super();this.camera=camera;this.cloud=cloud;this.sunLight=sunLight;
    this.lightTarget=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false});
    this.uniforms={...cloud.uniforms,...searchlightUniforms,tDepth:{value:null},uInvProjection:{value:camera.projectionMatrixInverse},
      uCameraMatrix:{value:camera.matrixWorld},uCameraPosition:{value:camera.position},uSunDir:{value:cloud.uniforms.uCloudSun.value},
      uSunColour:{value:new THREE.Color(1,.89,.72)},uSunIntensity:{value:4.3}};
    this.volumeMaterial=new THREE.ShaderMaterial({name:'Cloud-shadowed air scattering',uniforms:this.uniforms,depthTest:false,depthWrite:false,
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:`${cloudGLSL()}\n${searchlightGLSL()}
        varying vec2 vUv;uniform sampler2D tDepth;
        uniform mat4 uInvProjection,uCameraMatrix;uniform vec3 uCameraPosition,uSunDir,uSunColour;uniform float uSunIntensity;
        void main(){
          float depth=texture2D(tDepth,vUv).x;
          vec4 p=uInvProjection*vec4(vUv*2.0-1.0,depth*2.0-1.0,1.0);p/=p.w;
          vec3 world=(uCameraMatrix*p).xyz;
          vec3 view=world-uCameraPosition;float lengthRay=min(length(view),8500.0);vec3 ray=normalize(view);
          float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
          const int STEPS=24;float stepLength=lengthRay/float(STEPS),transmission=1.0;vec3 light=vec3(0.0);
          float cosine=dot(ray,uSunDir),g=.64;
          float phase=(1.0-g*g)/pow(1.0+g*g-2.0*g*cosine,1.5);
          for(int i=0;i<STEPS;i++){
            vec3 samplePoint=uCameraPosition+ray*(float(i)+jitter)*stepLength;
            float maritime=exp(-max(0.0,samplePoint.y)/560.0)*.000038;
            float opacity=1.0-exp(-maritime*stepLength);
            float sun=cloudTransmission(samplePoint,uSunDir);
            vec3 radiance=uSunColour*uSunIntensity*phase*.48*sun+vec3(.21,.28,.34)*.42*(1.0-uNight*.8);
            radiance+=searchRadiance(samplePoint)*.08;
            light+=transmission*opacity*radiance;transmission*=1.0-opacity;
          }
          gl_FragColor=vec4(light,transmission);
        }`,
    });
    this.combineMaterial=new THREE.ShaderMaterial({name:'Air scattering composite',uniforms:{tDiffuse:{value:null},tAir:{value:this.lightTarget.texture}},depthTest:false,depthWrite:false,
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}',
      fragmentShader:'varying vec2 vUv;uniform sampler2D tDiffuse,tAir;void main(){vec4 air=texture2D(tAir,vUv);gl_FragColor=vec4(texture2D(tDiffuse,vUv).rgb*air.a+air.rgb,1.0);}',
    });
    this.quad=new FullScreenQuad(this.volumeMaterial);
  }
  setSize(w,h){const scale=Math.min(.5,900/w);this.lightTarget.setSize(Math.ceil(w*scale),Math.ceil(h*scale));}
  render(renderer,writeBuffer,readBuffer){
    this.camera.updateMatrixWorld();this.uniforms.tDepth.value=readBuffer.depthTexture;this.uniforms.uSunIntensity.value=this.sunLight.intensity;
    this.quad.material=this.volumeMaterial;renderer.setRenderTarget(this.lightTarget);this.quad.render(renderer);
    this.combineMaterial.uniforms.tDiffuse.value=readBuffer.texture;this.quad.material=this.combineMaterial;
    renderer.setRenderTarget(this.renderToScreen?null:writeBuffer);this.quad.render(renderer);
  }
  dispose(){this.lightTarget.dispose();this.volumeMaterial.dispose();this.combineMaterial.dispose();this.quad.dispose();}
}
