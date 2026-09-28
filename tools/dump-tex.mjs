import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const b = await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:'new',args:['--headless=new','--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const p = await b.newPage();
await p.goto('http://127.0.0.1:8765/index.html',{waitUntil:'load'});
const s=(ms)=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<40;i++){const v=await p.$eval('#barPct',e=>e.textContent).catch(()=>'0%'); if(v==='100%')break; await s(500);}
await s(3000);
const data = await p.evaluate(()=>{
  const out = {};
  const seen = new Set();
  window.__game.shipMesh.traverse(o=>{
    if(!o.isMesh) return;
    const m=o.material;
    if(!m.map || !m.map.image || seen.has(m.map.uuid)) return;
    seen.add(m.map.uuid);
    const img = m.map.image;
    if (img.tagName === 'CANVAS') out[img.width+'x'+img.height+'_'+m.map.uuid.slice(0,4)] = img.toDataURL('image/png');
  });
  return out;
});
for (const [k,v] of Object.entries(data)) {
  const buf = Buffer.from(v.split(',')[1], 'base64');
  const f = `/tmp/gb-shots/tex-${k}.png`;
  fs.writeFileSync(f, buf);
  console.log('wrote', f, buf.length, 'bytes');
}
await b.close();
