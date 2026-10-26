import {Batch, Config, Count, ID, Post, Store} from './types';
import {Dwell, findTarget, isDisplayed} from './visibility';
interface Instance {anchor: HTMLElement; postID: string; dwell: Dwell; target: HTMLElement | null}
const emptyConfig: Config={enabled:false,dwell_ms:1000,retention_days:30,channel_ids:[]};
export class Runtime {
 config=emptyConfig;
 counts=new Map<string,Count>();
 private instances=new Set<Instance>();
 private listeners=new Set<() => void>();
 private done=new Set<string>();
 private pending=new Set<string>();
 private inFlight=new Set<string>();
 private suppressed=new Set<string>();
 private controllers=new Set<AbortController>();
 private timer: number;
 private polling=false;
 private recording=false;
 private nextRecordAttempt=0;
 private stopped=false;
 private userID='';
 private nextPoll=0;
 private nextConfig=0;
 private unsubscribe: () => void;
 private generation=0;
 constructor(public store: Store) {
  this.userID=this.currentUser();
  this.unsubscribe=store.subscribe(this.onStore);
  document.addEventListener('visibilitychange',this.onVisibility);
  window.addEventListener('blur',this.onBlur);
  window.addEventListener('focus',this.onVisibility);
  document.addEventListener('scroll',this.onVisibility,true);
  window.addEventListener('resize',this.onVisibility);
  this.timer=window.setInterval(this.tick,100);
  this.tick();
 }
 currentUser=() => this.store.getState().entities.users.currentUserId;
 post=(id: string) => this.store.getState().entities.posts.posts[id];
 subscribe=(fn: () => void) => {this.listeners.add(fn);return () => {this.listeners.delete(fn);};};
 private emit=() => {for (const fn of this.listeners) {fn();}};
 private onStore=() => {
  const user=this.currentUser();
  if (user!==this.userID) {
   this.generation++;for (const c of this.controllers) {c.abort();}
   this.userID=user;this.counts.clear();this.done.clear();this.pending.clear();this.inFlight.clear();this.suppressed.clear();this.config=emptyConfig;
   this.nextConfig=0;this.nextPoll=0;this.nextRecordAttempt=0;
   for (const item of this.instances) {item.dwell.reset();}
  }
  this.emit();
 };
 async request<T>(path: string, body?: unknown): Promise<T> {
  if (this.stopped) {throw new Error('stopped');}
  const controller=new AbortController();this.controllers.add(controller);
  const timeout=window.setTimeout(()=>controller.abort(),10000);
  try {
   const siteURL=this.store.getState().entities.general?.config?.SiteURL;
   const subpath=siteURL ? new URL(siteURL,window.location.origin).pathname.replace(/\/+$/, '') : '';
   const csrf=document.cookie.split(';').map(value=>value.trim()).find(value=>value.startsWith('MMCSRF='))?.slice('MMCSRF='.length);
   const res=await fetch(`${subpath}/plugins/${ID}/api/v1/${path}`,{
    method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
    headers:{'Content-Type':'application/json','X-Requested-With':'ViewportReadReceipts',...(body!==undefined && csrf?{'X-CSRF-Token':csrf}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
   });
   if (!res.ok) {throw new Error(`HTTP ${res.status}`);}
   return await res.json() as T;
  } finally {window.clearTimeout(timeout);this.controllers.delete(controller);}
 }
 attach(anchor: HTMLElement, postID: string) {
  const instance={anchor,postID,dwell:new Dwell(),target:null};
  this.instances.add(instance);this.nextPoll=0;
  return ()=> {this.instances.delete(instance);};
 }
 eligible(post: Post | undefined): post is Post {
  return Boolean(this.config.enabled && post && !post.delete_at && !post.type &&
   Date.now()-post.create_at<this.config.retention_days*86400000 &&
   (this.config.channel_ids.length===0 || this.config.channel_ids.includes(post.channel_id)));
 }
 private onBlur=()=> {for (const instance of this.instances) {instance.dwell.reset();}};
 private onVisibility=()=> {this.check();};
 private tick=()=> {
  if (this.stopped) {return;}
  const now=performance.now();
  if (now>=this.nextConfig && this.userID) {this.nextConfig=now+30000;void this.refreshConfig();}
  this.check();
  if (this.config.enabled && document.visibilityState==='visible' && document.hasFocus()) {
   if (this.pending.size>0) {void this.flush();}
   if (now>=this.nextPoll) {this.nextPoll=now+5000;void this.poll();}
  }
 };
 private async refreshConfig() {
  const generation=this.generation;
  try {
   const config=await this.request<Config>('config');
   if (generation!==this.generation || this.stopped) {return;}
   if (config.dwell_ms!==this.config.dwell_ms || config.enabled!==this.config.enabled || config.channel_ids.join()!==this.config.channel_ids.join()) {this.onBlur();}
   if (config.retention_days!==this.config.retention_days || config.channel_ids.join()!==this.config.channel_ids.join()) {this.suppressed.clear();this.done.clear();this.pending.clear();}
   this.config=config;
   if (!config.enabled) {this.counts.clear();this.pending.clear();}
   this.emit();
  } catch {
   if (generation!==this.generation || this.stopped) {return;}
   this.config=emptyConfig;this.onBlur();this.emit();this.nextConfig=performance.now()+5000;
  }
 }
 private check() {
  if (this.stopped) {return;}
  const now=performance.now();
  for (const item of this.instances) {
   const post=this.post(item.postID);
   if (!this.eligible(post) || post.user_id===this.userID || this.done.has(item.postID) || this.inFlight.has(item.postID) || this.suppressed.has(item.postID)) {item.dwell.reset();continue;}
   const target=findTarget(item.anchor);
   if (target!==item.target) {item.dwell.reset();item.target=target;}
   if (item.dwell.update(Boolean(target && isDisplayed(target)),now,this.config.dwell_ms)) {this.pending.add(item.postID);}
  }
 }
 private accept(result: Batch) {
  for (const [id,count] of Object.entries(result.posts)) {this.counts.set(id,count);}
  for (const [id,status] of Object.entries(result.rejected)) {
   if (status===403 || status===404) {this.suppressed.add(id);this.counts.delete(id);}
  }
  this.emit();
 }
 private async flush() {
  if (this.recording || performance.now()<this.nextRecordAttempt) {return;}
  this.recording=true;
  const generation=this.generation;
  const ids=[...this.pending].slice(0,50);
  for (const id of ids) {this.pending.delete(id);this.inFlight.add(id);}
  try {
   const result=await this.request<Batch>('seen',{post_ids:ids});
   if (generation!==this.generation || this.stopped) {return;}
   for (const id of Object.keys(result.posts)) {this.done.add(id);}
   if (Object.values(result.rejected).some(status=>status>=500)) {this.nextRecordAttempt=performance.now()+5000;}
   this.accept(result);
  } catch {
   if (generation===this.generation && !this.stopped) {
    this.nextRecordAttempt=performance.now()+5000;
    // Retry only after a fresh continuous display; do not carry a stale pending receipt.
    for (const item of this.instances) {if (ids.includes(item.postID)) {item.dwell.reset();}}
   }
  } finally {for (const id of ids) {this.inFlight.delete(id);}this.recording=false;}
 }
 private async poll() {
  if (this.polling) {return;}
  this.polling=true;
  const generation=this.generation;
  try {
   const ids=[...new Set([...this.instances].filter(item=>this.eligible(this.post(item.postID)) &&
    !this.suppressed.has(item.postID) && (item.anchor.closest('.post__body')?.getBoundingClientRect().bottom ?? 0)>0 && (item.anchor.closest('.post__body')?.getBoundingClientRect().top ?? Infinity)<window.innerHeight).map(item=>item.postID))];
   for (let start=0;start<ids.length;start+=50) {
    const result=await this.request<Batch>('counts',{post_ids:ids.slice(start,start+50)});
    if (generation!==this.generation || this.stopped) {return;}
    this.accept(result);
   }
  } catch { /* Keep last successful count; a failed lookup never fabricates zero. */ }
  finally {this.polling=false;}
 }
 stop() {
  this.stopped=true;this.generation++;window.clearInterval(this.timer);this.unsubscribe();
  document.removeEventListener('visibilitychange',this.onVisibility);
  document.removeEventListener('scroll',this.onVisibility,true);
  window.removeEventListener('blur',this.onBlur);window.removeEventListener('focus',this.onVisibility);window.removeEventListener('resize',this.onVisibility);
  for (const c of this.controllers) {c.abort();}
  this.instances.clear();this.listeners.clear();this.counts.clear();this.pending.clear();this.done.clear();
 }
}
