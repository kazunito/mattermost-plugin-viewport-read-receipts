import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Runtime} from './runtime';
import {Reader} from './types';
export function Eye() {
 return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>;
}
export function ReadersDialog({runtime,postID,close}: {runtime: Runtime; postID: string; close: () => void}) {
 const [readers,setReaders]=useState<Reader[] | null>(null);
 const [error,setError]=useState(false);
 const [loading,setLoading]=useState(false);
 const dialog=useRef<HTMLDivElement>(null);
 const closeButton=useRef<HTMLButtonElement>(null);
 useEffect(()=> {
  let alive=true;
  const load=async()=> {
   setLoading(true);setError(false);
   try {const result=await runtime.request<{readers:Reader[]}>(`readers/${postID}`);if (alive) {setReaders(result.readers);}}
   catch {if (alive) {setReaders(null);setError(true);}}
   finally {if (alive) {setLoading(false);}}
  };
  void load();
  const listener=()=> {void load();};
  dialog.current?.addEventListener('vrr-retry',listener);
  const element=dialog.current;
  return ()=>{alive=false;element?.removeEventListener('vrr-retry',listener);};
 },[runtime,postID]);
 useEffect(()=> {
  const previous=document.activeElement as HTMLElement | null;
  closeButton.current?.focus();
  const key=(event: KeyboardEvent)=> {
   if (event.key==='Escape') {event.preventDefault();event.stopPropagation();close();}
   if (event.key==='Tab') {
    const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]');
    if (!items?.length) {return;}
    const first=items[0],last=items[items.length-1];
    if (event.shiftKey && (document.activeElement===first || !dialog.current?.contains(document.activeElement))) {event.preventDefault();last.focus();}
    else if (!event.shiftKey && (document.activeElement===last || !dialog.current?.contains(document.activeElement))) {event.preventDefault();first.focus();}
   }
  };
  document.addEventListener('keydown',key,true);
  return ()=>{document.removeEventListener('keydown',key,true);if (previous?.isConnected) {previous.focus();}};
 },[close]);
 return createPortal(<div className="vrr-backdrop" onClick={(e)=>{e.stopPropagation();if (e.target===e.currentTarget) {close();}}}>
  <div ref={dialog} className="vrr-dialog" role="dialog" aria-modal="true" aria-labelledby={`vrr-title-${postID}`}>
   <div className="vrr-dialog-header"><h2 id={`vrr-title-${postID}`}><Eye/> 表示済みの人 {readers===null?'':`${readers.length}人`}</h2><button ref={closeButton} type="button" onClick={close} aria-label="閉じる">×</button></div>
   <p className="vrr-description">Web・デスクトップで表示条件を満たした人です。読了や理解を示すものではありません。スマートフォンアプリでの閲覧は含みません。</p>
   <div className="vrr-readers" tabIndex={0} aria-label="表示済みの人の一覧" aria-busy={loading}>
    {loading && <p role="status">読み込み中…</p>}
    {error && <div role="alert"><p>一覧を取得できませんでした。</p><button type="button" onClick={()=>dialog.current?.dispatchEvent(new Event('vrr-retry'))}>再試行</button></div>}
    {!loading && !error && readers?.length===0 && <p>表示確認の記録はまだありません。</p>}
    {!loading && !error && readers && <ul>{readers.map(reader=><li key={reader.user_id}><span className="vrr-avatar" aria-hidden="true">{reader.display_name.slice(0,1)}</span><span><strong>{reader.display_name}</strong><small>@{reader.username}</small></span></li>)}</ul>}
   </div>
   <p className="vrr-footnote">投稿者本人は人数に含みません。閲覧時刻は保存・表示しません。</p>
  </div>
 </div>,document.body);
}
export function createReceiptComponent(runtime: Runtime) {
 return function Receipt({postId,onHeightChange}: {postId: string; onHeightChange?: (height: number) => void}) {
  const anchor=useRef<HTMLSpanElement>(null);
  const [footer,setFooter]=useState<HTMLElement | null>(null);
  const [,update]=useState(0);
  const [open,setOpen]=useState(false);
  const close=React.useCallback(()=>setOpen(false),[]);
  useEffect(()=>runtime.subscribe(()=>update(n=>n+1)),[]);
  useEffect(()=>anchor.current ? runtime.attach(anchor.current,postId) : undefined,[postId]);
  React.useLayoutEffect(()=> {
   const body=anchor.current?.closest('.post__body');
   const target=body?.querySelector('.post__body-reactions-acks');
   if (!target) {return;}
   const host=document.createElement('span');host.className='vrr-footer';target.append(host);setFooter(host);
   onHeightChange?.(host.getBoundingClientRect().height);
   return ()=>{host.remove();};
  },[postId]);
  const post=runtime.post(postId);
  const eligible=runtime.eligible(post);
  const count=runtime.counts.get(postId);
  const own=post?.user_id===runtime.currentUser();
  useEffect(()=> {onHeightChange?.((footer ?? anchor.current)?.getBoundingClientRect().height ?? 0);},[eligible,Boolean(count),footer]);
  const content=<>
   {eligible && count && (own && count.can_list ?
    <button type="button" className="vrr-badge" aria-label={`既読 ${count.count}人。表示済みの人を確認`} aria-haspopup="dialog" onClick={(e)=>{e.stopPropagation();setOpen(true);}} title="表示済みの人を確認（投稿者のみ）"><Eye/><span>既読 {count.count}</span></button>:
    <span className="vrr-badge vrr-badge-static" title="Web・デスクトップで表示確認済みの人数。読了を示すものではありません。"><Eye/><span>既読 {count.count}</span></span>)}
   {eligible && own && count?.can_list && open && <ReadersDialog runtime={runtime} postID={postId} close={close}/>}
  </>;
  return <span ref={anchor} className="vrr-anchor" data-vrr-post={postId}>{footer ? createPortal(content,footer) : content}</span>;
 };
}
