import fs from 'node:fs/promises';
import path from 'node:path';

export async function reviewReferences(task, output, pageLabel = 'p2', queries = [
  'Knock Nevis shipspotting aerial port side',
  'Knock Nevis bow stern shipspotting',
  'Jahre Viking deck aerial',
  'Knock Nevis bridge forecastle deck',
  'Seawise Giant drydock propeller',
  'USS Enterprise CVN 65 stern propellers dry dock',
  'USS Enterprise CVN 65 island 2012 close up',
  'USS Enterprise CVN 65 hull rough sea',
]) {
  await fs.mkdir(output, { recursive: true });
  const page = task.page(pageLabel);
  await page.cdp('Emulation.setDeviceMetricsOverride', {width:1440,height:1220,deviceScaleFactor:1,mobile:false});
  const records = [];
  for (let i=0;i<queries.length;i++) {
    const query=queries[i];
    await page.goto(`https://www.google.com/search?udm=2&q=${encodeURIComponent(query)}`);
    await page.waitForFunction(()=>Array.from(document.images).filter(i=>i.naturalWidth>150).length>=10);
    const photos = await page.evaluate(()=>Array.from(document.images)
      .filter(i=>i.naturalWidth>150&&i.naturalHeight>100&&i.alt)
      .slice(0,32).map(img=>{
        let node=img.parentElement,links=[];
        for(let n=0;n<6&&node;n++,node=node.parentElement){
          links=Array.from(node.querySelectorAll('a[href]')).map(a=>({title:a.innerText,url:a.href}))
            .filter(a=>a.title&&a.url.startsWith('http')&&!a.url.includes('google.com'));
          if(links.length)break;
        }
        return {title:img.alt,thumbnail:img.currentSrc,source:links[0]??null,width:img.naturalWidth,height:img.naturalHeight};
      }));
    const selected=photos.slice(0,12);
    await page.evaluate(({query,selected})=>{
      document.head.innerHTML='<meta name="viewport" content="width=device-width,initial-scale=1">';
      document.body.innerHTML='';document.body.style.cssText='margin:0;background:#15212c;color:white;font:14px system-ui';
      const title=document.createElement('h2');title.textContent=query;title.style.cssText='margin:18px';document.body.append(title);
      const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px';
      for(const [index,p] of selected.entries()){
        const card=document.createElement('div');card.style.cssText='background:#223340;padding:10px';
        const img=new Image();img.src=p.thumbnail;img.style.cssText='width:100%;height:290px;object-fit:contain;background:#0e1721';
        const caption=document.createElement('div');caption.textContent=`${index+1}. ${p.title}`;caption.style.cssText='height:64px;overflow:hidden';
        card.append(img,caption);grid.append(card);
      }
      document.body.append(grid);
    },{query,selected});
    await page.waitForFunction(()=>Array.from(document.images).every(i=>i.complete));
    const screenshot=path.join(output,`reference-sheet-${i+1}.png`);
    await page.screenshot({path:screenshot});
    records.push({query,url:`https://www.google.com/search?udm=2&q=${encodeURIComponent(query)}`,indexed:photos,selected,screenshot});
    await fs.writeFile(path.join(output,'reference-index.json'),JSON.stringify(records,null,2));
    console.log(JSON.stringify({query,indexed:photos.length,selected:selected.length,screenshot}));
  }
  return records;
}
