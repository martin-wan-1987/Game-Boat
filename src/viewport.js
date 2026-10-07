/** Browser boundary: one unobscured CSS-pixel rectangle for layout and input. */
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.append(probe);
function browserSurface() {
  const visual = window.visualViewport;
  const style = getComputedStyle(probe);
  return {
    left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0,
    width: visual?.width ?? innerWidth, height: visual?.height ?? innerHeight,
    insets: { top: parseFloat(style.paddingTop), right: parseFloat(style.paddingRight),
      bottom: parseFloat(style.paddingBottom), left: parseFloat(style.paddingLeft) },
    occlusions: [], source: 'visualViewport + CSS env(safe-area-inset-*)',
  };
}
/** Largest remaining axis-aligned rectangle. Device-specific geometry stays here. */
export function safeRectangle(surface) {
  const {left, top, width, height, insets, occlusions} = surface;
  const outer = {left:left+insets.left, top:top+insets.top,
    right:left+width-insets.right, bottom:top+height-insets.bottom};
  const xs = [...new Set([outer.left, outer.right, ...occlusions.flatMap(h => [h.left,h.right])])].filter(x=>x>=outer.left&&x<=outer.right).sort((a,b)=>a-b);
  const ys = [...new Set([outer.top, outer.bottom, ...occlusions.flatMap(h => [h.top,h.bottom])])].filter(y=>y>=outer.top&&y<=outer.bottom).sort((a,b)=>a-b);
  let best = {left:outer.left,right:outer.left,top:outer.top,bottom:outer.top}, area = 0;
  for(let l=0;l<xs.length-1;l++)for(let r=l+1;r<xs.length;r++)for(let t=0;t<ys.length-1;t++)for(let b=t+1;b<ys.length;b++) {
    const candidate={left:xs[l],right:xs[r],top:ys[t],bottom:ys[b]};
    if(occlusions.some(h=>candidate.left<h.right&&candidate.right>h.left&&candidate.top<h.bottom&&candidate.bottom>h.top))continue;
    const a=(candidate.right-candidate.left)*(candidate.bottom-candidate.top);
    if(a>area){best=candidate;area=a;}
  }
  return {...best,width:best.right-best.left,height:best.bottom-best.top};
}
class ViewportBoundary {
  constructor(){
    this.source=browserSurface;
    this.measure=this.measure.bind(this);
    window.addEventListener('resize',this.measure);
    window.addEventListener('orientationchange',this.measure);
    window.visualViewport?.addEventListener('resize',this.measure);
    window.visualViewport?.addEventListener('scroll',this.measure);
    document.addEventListener('fullscreenchange',this.measure);
    document.addEventListener('visibilitychange',this.measure);
    this.measure();
  }
  setSource(source){this.source=source;this.measure();}
  resetSource(){this.setSource(browserSurface);}
  measure(){
    this.surface=this.source();this.rect=safeRectangle(this.surface);
    for(const key of ['left','top','width','height'])document.documentElement.style.setProperty(`--safe-${key}`,`${this.rect[key]}px`);
    document.documentElement.classList.toggle('compact-ui',this.rect.width<1100||this.rect.height<760);
    document.documentElement.classList.toggle('wide-ui',this.rect.width>this.rect.height);
    window.dispatchEvent(new Event('safeareachange'));
  }
  contains(x,y){const r=this.rect;return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}
}
export const viewport = new ViewportBoundary();
window.__viewport=viewport;
