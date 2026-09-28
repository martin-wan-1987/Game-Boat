import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--headless=new','--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const p = await b.newPage();
await p.setViewport({width:1200,height:800});
await p.goto('http://127.0.0.1:8765/index.html',{waitUntil:'load'});
const s=(ms)=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<40;i++){const v=await p.$eval('#barPct',e=>e.textContent).catch(()=>'0%'); if(v==='100%')break; await s(500);}
await s(2500);

const info = await p.evaluate(()=>{
  const g = window.__game;
  let deck=null;
  g.shipMesh.traverse(o=>{ if(o.isMesh && o.geometry.type==='ShapeGeometry' && o.material.map) deck=o; });
  const img = deck.material.map.image;
  const ctx = img.getContext('2d');
  // sample a known white runway centreline pixel: LAND runs -162,-25 -> 62,-1
  // u = (x+168.5)/337 * 4096 ; v_canvas = (1 - (z+44)/84) * 1024
  const sample = (x,z)=>{ const u=Math.round((x+168.5)/337*4096); const vc=Math.round((1-(z+44)/84)*1024);
    const d=ctx.getImageData(Math.min(4095,Math.max(0,u)), Math.min(1023,Math.max(0,vc)),1,1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; };
  return {
    canvas: img.width+'x'+img.height,
    onCentreline: sample(0,-13.5),
    offCentreline: sample(0,-30),
    elev1: sample(5,25),
    uv: (()=>{const u=deck.geometry.attributes.uv; let a=[9,-9,9,-9]; for(let i=0;i<u.count;i++){a[0]=Math.min(a[0],u.getX(i));a[1]=Math.max(a[1],u.getX(i));a[2]=Math.min(a[2],u.getY(i));a[3]=Math.max(a[3],u.getY(i));} return a.map(v=>+v.toFixed(3));})(),
    matMapUuid: deck.material.map.uuid.slice(0,6),
    matColor: '#'+deck.material.color.getHexString(),
    matMapOn: !!deck.material.map,
    deckY: deck.geometry.boundingBox ? null : (()=>{deck.geometry.computeBoundingBox(); const bb=deck.geometry.boundingBox; return [bb.min.y,bb.max.y];})(),
    texAniso: deck.material.map.anisotropy,
    maxAniso: g.renderer.capabilities.getMaxAnisotropy(),
  };
});
console.log(JSON.stringify(info,null,1));

// now force the deck material to unlit and shoot straight down
await p.evaluate(()=>{
  const g=window.__game;
  let deck=null; g.shipMesh.traverse(o=>{ if(o.isMesh && o.geometry.type==='ShapeGeometry' && o.material.map) deck=o; });
  const THREE = deck.material.constructor;
  deck.material = new (Object.getPrototypeOf(deck.material).constructor)({map: deck.material.map});
  deck.material.needsUpdate = true;
  // top-down close view
  g.setCamera('orbit'); g.rig.radius=260; g.rig.phi=0.30; g.rig.theta=1.2;
  document.getElementById('hud').style.opacity='0';
});
await s(3000);
await p.screenshot({path:'/tmp/gb-shots/deck-unlit.png'});
await b.close();
