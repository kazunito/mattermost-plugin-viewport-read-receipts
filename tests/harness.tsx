import React from 'react';
import * as ReactDOM from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {Post,State} from '../webapp/src/types';
import {Dwell,isDisplayed,findTarget} from '../webapp/src/visibility';
const IDs={author:'a'.repeat(26),viewer:'b'.repeat(26),channel:'c'.repeat(26),p1:'d'.repeat(26),p2:'e'.repeat(26),reply:'f'.repeat(26),own:'g'.repeat(26)};
let state: State={entities:{users:{currentUserId:IDs.viewer},posts:{posts:{}}}};
const make=(id: string,user=IDs.author,message='明日の作業は午前9時から開始します。'): Post=>({id,user_id:user,channel_id:IDs.channel,create_at:Date.now(),message});
state.entities.posts.posts={
 [IDs.p1]:make(IDs.p1),[IDs.p2]:make(IDs.p2),[IDs.reply]:make(IDs.reply,IDs.author,'確認しました。手順書を準備します。'),[IDs.own]:make(IDs.own,IDs.viewer,'作業手順書を更新しました。ご確認ください。'),
};
const listeners=new Set<()=>void>();
const store={getState:()=>state,subscribe:(fn:()=>void)=>{listeners.add(fn);return ()=>listeners.delete(fn);}};
let Receipt: React.ComponentType<{postId: string}>;
let plugin: {initialize: (registry: unknown,store: unknown)=>void; uninitialize:()=>void};
const registry={registerPostMessageAttachmentComponent:(component: typeof Receipt)=>{Receipt=component;return 'component';},unregisterComponent:()=>{root.unmount();}};
Object.assign(window,{React,ReactDOM});
window.registerPlugin=(_id,instance)=>{plugin=instance as typeof plugin;plugin.initialize(registry,store);};
const root=createRoot(document.getElementById('app')!);
function PostView({id,rhs=false,search=false}: {id: string;rhs?:boolean;search?:boolean}) {
 const p=state.entities.posts.posts[id];
 return <article className="post" data-testid={search?'searchResult':rhs?'rhsPostView':'postView'} data-post={id}>
  <div className="header"><span className="avatar">{p.user_id===IDs.viewer?'自':'田'}</span><strong>{p.user_id===IDs.viewer?'自分':'田中 太郎'}</strong><small>10:00</small></div>
  <div className="post__body"><div className="post-message__text">{p.message}</div><Receipt postId={id}/><div className="post__body-reactions-acks"/></div>
 </article>;
}
let mode='normal';
function App(){
 return <><header><strong>開発用プレビュー</strong><span>架空データ · 実サーバー未接続</span></header><div className="layout"><aside>業務チーム<br/><br/>▾ チャネル<br/><div className="active">＃ 作業連絡</div><br/>▾ ダイレクトメッセージ</aside><main className="pane" id="main-pane"><h1>＃ 作業連絡</h1><div className="scroll" id="main-scroll"><PostView id={IDs.own}/><PostView id={IDs.p1}/>{mode==='offscreen' && <div style={{height:1200}}/>}<PostView id={IDs.p2} search={mode==='search'}/>{mode==='duplicate' && <PostView id={IDs.reply}/>}</div></main><section className="pane thread"><h1>スレッド</h1><div className="scroll" id="thread-scroll"><PostView id={IDs.p1} rhs/><PostView id={IDs.reply} rhs/></div></section></div></>;
}
const script=document.createElement('script');script.src='/plugin.js';script.onload=()=>{root.render(<App/>);Object.assign(window,{test:{IDs,store,Dwell,isDisplayed,findTarget,siteURL:(url:string)=>{state.entities.general={config:{SiteURL:url}};},request:(path:string,body:unknown)=>(plugin as any).runtime.request(path,body),mode:(value:string)=>{mode=value;root.render(<App/>);},user:(id:string)=>{state={entities:{...state.entities,users:{currentUserId:id}}};for(const fn of listeners){fn();}},message:(id:string,text:string)=>{state.entities.posts.posts[id].message=text;root.render(<App/>);},stop:()=>plugin.uninitialize()}});};document.head.append(script);
