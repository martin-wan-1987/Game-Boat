import assert from 'node:assert/strict';
import { WaveField } from '../src/waves.js';

let seed=65;
Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const report=[];
for(const heading of [0,.73,2.8])for(const height of [2.6,6.6,13]){
  const field=new WaveField();
  field.spawnTsunami({x:137,z:-82,dirX:Math.cos(heading),dirZ:Math.sin(heading),height,period:12,distance:850,crests:7});
  let velocityError=0,normalError=0;
  for(const time of [0,17,43])for(let i=0;i<=180;i++){
    field.time=time;
    const s=(-.65+4*i/180)*field.tsuWidth;
    const x=field.tsuOriginX+(s-field.tsuSpeed*time)*field.tsuDirX;
    const z=field.tsuOriginZ+(s-field.tsuSpeed*time)*field.tsuDirZ+37;
    const sample=field.sampleBase(x,z,{}),e=.0001;
    const derivative=(axis)=>{
      field.time=time+(axis==='t'?e:0);
      const hi=field.sampleBase(x+(axis==='x'?e:0),z+(axis==='z'?e:0),{});
      field.time=time-(axis==='t'?e:0);
      const lo=field.sampleBase(x-(axis==='x'?e:0),z-(axis==='z'?e:0),{});
      field.time=time;
      return ['x','y','z'].map(k=>(hi[k]-lo[k])/(2*e));
    };
    const velocity=derivative('t'),normal=cross(derivative('z'),derivative('x'));
    const length=Math.hypot(...normal);
    velocityError=Math.max(velocityError,...['vx','vy','vz'].map((k,j)=>Math.abs(sample[k]-velocity[j])));
    normalError=Math.max(normalError,...['nx','ny','nz'].map((k,j)=>Math.abs(sample[k]-normal[j]/length)));
  }
  assert.ok(velocityError<1e-6,`velocity derivative: ${velocityError}`);
  assert.ok(normalError<1e-6,`normal derivative: ${normalError}`);
  report.push({heading,height,velocityError,normalError});
}
console.log(JSON.stringify(report,null,2));
