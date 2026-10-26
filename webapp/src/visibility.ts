// This adapter is pinned to the verified Mattermost 12.0.1 DOM, not LastViewedAt.
// If the expected post containers disappear, tracking fails closed.
export function findTarget(anchor: HTMLElement): HTMLElement | null {
 const post = anchor.closest<HTMLElement>('[data-testid="postView"], [data-testid="rhsPostView"]');
 const body = anchor.closest<HTMLElement>('.post__body');
 if (!post || !body || !post.contains(body)) { return null; }
 const text = body.querySelector<HTMLElement>('.post-message__text');
 if (text && text.textContent?.trim()) { return text; }
 // File-only posts: observe the attachment area, never our own badge.
 return body.querySelector<HTMLElement>('[data-testid="fileAttachmentList"], .MediaGallery');
}
interface Box {left: number; top: number; right: number; bottom: number}
function intersect(a: Box, b: Box): Box {
 return {left: Math.max(a.left,b.left),top:Math.max(a.top,b.top),right:Math.min(a.right,b.right),bottom:Math.min(a.bottom,b.bottom)};
}
export function isDisplayed(target: HTMLElement, doc: Document = document): boolean {
 const win=doc.defaultView;
 if (!win || doc.visibilityState!=='visible' || !doc.hasFocus() || !target.isConnected) { return false; }
 const rect=target.getBoundingClientRect();
 if (rect.width<=0 || rect.height<=0) { return false; }
 let clip: Box={left:0,top:0,right:win.innerWidth,bottom:win.innerHeight};
 let viewport: Box={...clip};
 for (let el: HTMLElement | null=target;el;el=el.parentElement) {
  const style=win.getComputedStyle(el);
  if (style.display==='none' || style.visibility!=='visible' || Number(style.opacity)===0 || el.hidden || el.getAttribute('aria-hidden')==='true') { return false; }
  if (el!==target) {
   const bounds=el.getBoundingClientRect();
   const clipsX=/(auto|scroll|hidden|clip)/.test(style.overflowX);
   const clipsY=/(auto|scroll|hidden|clip)/.test(style.overflowY);
   if (/(auto|scroll)/.test(style.overflowY)) {viewport=intersect(viewport,{left:viewport.left,right:viewport.right,top:bounds.top,bottom:bounds.bottom});}
   clip=intersect(clip,{left:clipsX?bounds.left:clip.left,right:clipsX?bounds.right:clip.right,top:clipsY?bounds.top:clip.top,bottom:clipsY?bounds.bottom:clip.bottom});
  }
 }
 const visible=intersect(rect,clip);
 const width=Math.max(0,visible.right-visible.left),height=Math.max(0,visible.bottom-visible.top);
 const availableHeight=Math.max(0,viewport.bottom-viewport.top);
 if (width<rect.width*0.5 || height<Math.min(rect.height,availableHeight)*0.5 || width<1 || height<1) {return false;}
 // Geometry alone counts posts hidden behind dialogs/sidebars. Hit-test five points.
 const points=[[0.5,0.5],[0.25,0.25],[0.75,0.25],[0.25,0.75],[0.75,0.75]];
 let exposed=0;
 for (const [x,y] of points) {
  const hit=doc.elementFromPoint(visible.left+width*x,visible.top+height*y);
  if (hit && (hit===target || target.contains(hit))) {exposed++;}
 }
 return exposed>=3;
}
export class Dwell {
 private start: number | null=null;
 private previous: number | null=null;
 update(displayed: boolean, now: number, milliseconds: number): boolean {
  if (!displayed || (this.previous!==null && now-this.previous>250)) {this.start=null;}
  this.previous=now;
  if (!displayed) {return false;}
  if (this.start===null) {this.start=now;}
  return now-this.start>=milliseconds;
 }
 reset() {this.start=null;this.previous=null;}
}
