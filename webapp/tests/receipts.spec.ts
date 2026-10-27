import {test,expect,Page} from '@playwright/test';
const id=(c:string)=>c.repeat(26);
const p1=id('d'),p2=id('e'),reply=id('f'),own=id('g');
interface Mock {seen: string[][];requests: string[];records:Set<string>; readersRequests:number; urls:string[]; csrf:string[]}
async function setup(page:Page,options: {enabled?:boolean;mode?:string;delay?:number;failReaders?:boolean;failSeen?:boolean}={}): Promise<Mock>{
 const mock:Mock={seen:[],requests:[],records:new Set(),readersRequests:0,urls:[],csrf:[]};
 await page.context().addCookies([{name:'MMCSRF',value:'fixture-csrf',domain:'127.0.0.1',path:'/'}]);
 await page.route('**/plugins/com.nito.viewport-read-receipts/api/v1/**',async route=>{
  const req=route.request(),path=req.url().split('/api/v1/')[1];mock.requests.push(path);mock.urls.push(req.url());
  if(req.method()==='POST'){mock.csrf.push(req.headers()['x-csrf-token']??'');if(req.headers()['x-csrf-token']!=='fixture-csrf'){await route.fulfill({status:401,json:{error:'csrf'}});return;}}
  if(path==='config'){await route.fulfill({json:{enabled:options.enabled??true,dwell_ms:options.delay??1000,retention_days:30,channel_ids:[]}});return;}
  if(path.startsWith('readers/')){mock.readersRequests++;await route.fulfill(options.failReaders?{status:500,json:{error:'failure'}}:{json:{readers:[{user_id:id('h'),username:'sato',display_name:'佐藤 花子'},{user_id:id('i'),username:'suzuki',display_name:'鈴木 一郎'},{user_id:id('j'),username:'yamada',display_name:'山田 次郎'}]}});return;}
  const ids=req.postDataJSON().post_ids as string[];
  if(path==='seen'){mock.seen.push(ids);if(options.failSeen){await route.fulfill({status:500,json:{error:'failure'}});return;}ids.forEach(v=>mock.records.add(v));}
  const posts=Object.fromEntries(ids.map(v=>[v,{count:v===own?3:mock.records.has(v)?1:0,can_list:v===own}]));
  await route.fulfill({json:{posts,rejected:{}}});
 });
 await page.goto('/');await page.waitForFunction(()=>Boolean((window as any).test));
 if(options.mode){await page.evaluate(m=>(window as any).test.mode(m),options.mode);}
 await expect(page.locator('.vrr-badge').first()).toBeVisible({timeout:5000}).catch(e=>{if(options.enabled!==false){throw e;}});
 return mock;
}
const seen=(mock:Mock,postID:string)=>mock.seen.flat().includes(postID);
test('前面で連続1秒表示された投稿・スレッド返信だけを記録し本人投稿は除外',async({page})=>{
 const mock=await setup(page);
 await expect.poll(()=>seen(mock,p1)).toBe(true);
 await expect.poll(()=>seen(mock,reply)).toBe(true);
 expect(seen(mock,own)).toBe(false);
 await page.waitForTimeout(1200);
 expect(mock.seen.flat().filter(v=>v===p1)).toHaveLength(1);
});
test('画面外の投稿はチャネルを開いても記録しない。スクロール後に記録',async({page})=>{
 const mock=await setup(page,{mode:'offscreen'});
 await page.waitForTimeout(1400);expect(seen(mock,p2)).toBe(false);
 await page.locator('#main-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 await expect.poll(()=>seen(mock,p2)).toBe(true);
});
test('1秒未満の通過は記録せず、画面外から戻ると計測をやり直す',async({page})=>{
 const mock=await setup(page,{mode:'offscreen'});
 await page.locator('#main-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 await page.waitForTimeout(350);
 await page.locator('#main-scroll').evaluate(el=>el.scrollTop=0);
 await page.waitForTimeout(1100);expect(seen(mock,p2)).toBe(false);
 await page.locator('#main-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 await page.waitForTimeout(400);expect(seen(mock,p2)).toBe(false);
 await expect.poll(()=>seen(mock,p2)).toBe(true);
});
test('バックグラウンドのタブでは記録せず復帰後に連続表示を必要とする',async({page,context})=>{
 const mock=await setup(page,{delay:2000});
 // Playwright normally forces every page to report focused. Disable that override.
 const original=await context.newCDPSession(page);await original.send('Emulation.setFocusEmulationEnabled',{enabled:false});
 const other=await context.newPage();await other.goto('about:blank');
 const background=await context.newCDPSession(other);await background.send('Emulation.setFocusEmulationEnabled',{enabled:false});
 await other.bringToFront();await expect.poll(()=>page.evaluate(()=>document.hasFocus())).toBe(false);
 await page.waitForTimeout(2300);expect(mock.seen).toHaveLength(0);
 await page.bringToFront();await page.waitForTimeout(600);expect(mock.seen).toHaveLength(0);
 await expect.poll(()=>seen(mock,p1)).toBe(true);await other.close();
});
test('ダイアログに隠れた投稿は記録しない',async({page})=>{
 const mock=await setup(page,{delay:2000});
 await page.getByRole('button',{name:'既読 3人。表示済みの人を確認'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.waitForTimeout(2300);
 // The main post is covered by the centered dialog; the right-hand thread is separate.
 expect(await page.locator(`[data-post="${p1}"]`).first().locator('.post-message__text').evaluate(el=>(window as any).test.isDisplayed(el))).toBe(false);
 await page.getByRole('button',{name:'閉じる',exact:true}).click();
});
test('検索結果の表示は対象外',async({page})=>{
 const mock=await setup(page,{mode:'search'});await page.waitForTimeout(1400);
 expect(seen(mock,p2)).toBe(false);
});
test('同じ返信をチャネルとスレッドで同時表示しても一度だけ送信',async({page})=>{
 const mock=await setup(page,{mode:'duplicate'});
 await expect.poll(()=>seen(mock,reply)).toBe(true);await page.waitForTimeout(1200);
 expect(mock.seen.flat().filter(v=>v===reply)).toHaveLength(1);
});
test('既読人数と投稿者限定の一覧。時刻と未読者の表示なし',async({page})=>{
 const mock=await setup(page);
 await page.getByRole('button',{name:'既読 3人。表示済みの人を確認'}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('佐藤 花子');await expect(dialog).toContainText('@sato');
 await expect(dialog).toContainText('閲覧時刻は保存・表示しません');
 expect(mock.readersRequests).toBe(1);await expect(dialog.locator('time')).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await expect(page.getByRole('button',{name:'既読 3人。表示済みの人を確認'})).toBeFocused();
 await expect(page.locator(`[data-post="${p1}"]`).first().locator('button.vrr-badge')).toHaveCount(0);
});
test('一覧の取得エラーを未読0人として表示しない',async({page})=>{
 await setup(page,{failReaders:true});await page.getByRole('button',{name:'既読 3人。表示済みの人を確認'}).click();
 await expect(page.getByRole('alert')).toContainText('一覧を取得できませんでした');await expect(page.getByRole('button',{name:'再試行'})).toBeVisible();
});
test('無効設定では記録と人数取得を行わない',async({page})=>{
 const mock=await setup(page,{enabled:false});await page.waitForTimeout(1400);
 expect(mock.seen).toHaveLength(0);expect(mock.requests.every(path=>path==='config')).toBe(true);await expect(page.locator('.vrr-badge')).toHaveCount(0);
});
test('長文は表示領域に対する50%を判定し、全文表示を要求しない',async({page})=>{
 const mock=await setup(page,{mode:'offscreen'});
 await page.evaluate(id=>(window as any).test.message(id,'長文の表示テストです。\n'.repeat(100)),p2);
 await page.locator('#main-scroll').evaluate(el=>{const post=el.querySelector('[data-post="'+ 'e'.repeat(26)+'"]') as HTMLElement;el.scrollTop=post.offsetTop-140;});
 await expect.poll(()=>seen(mock,p2)).toBe(true);
});
test('プラグイン停止後に追加送信しない',async({page})=>{
 const mock=await setup(page,{delay:2000});await page.evaluate(()=>(window as any).test.stop());
 const before=mock.requests.length;await page.waitForTimeout(2300);expect(mock.requests).toHaveLength(before);
});
test('計測中のタイマー停止を連続表示に加算しない',async({page})=>{
 await setup(page);
 const result=await page.evaluate(()=>{const d=new (window as any).test.Dwell();return [d.update(true,0,1000),d.update(true,100,1000),d.update(true,5000,1000),d.update(true,5100,1000)];});
 expect(result).toEqual([false,false,false,false]);
});
test('実装した表示画面のプレビューを保存',async({page})=>{
 await setup(page);await page.screenshot({path:'../work/preview-channel.png',fullPage:true});
 await page.getByRole('button',{name:'既読 3人。表示済みの人を確認'}).click();await expect(page.getByRole('dialog')).toContainText('佐藤 花子');
 await page.screenshot({path:'../work/preview-readers.png',fullPage:true});
});
test('添付ファイルだけの投稿も、添付領域が表示された場合に記録',async({page})=>{
 const mock=await setup(page,{mode:'offscreen'});
 await page.locator(`[data-post="${p2}"] .post-message__text`).evaluate(el=>{
  el.textContent='';const file=document.createElement('div');file.dataset.testid='fileAttachmentList';file.style.cssText='height:90px;background:#eee';file.textContent='作業手順書.pdf';el.parentElement!.append(file);
 });
 await page.locator('#main-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 await expect.poll(()=>seen(mock,p2)).toBe(true);
});
test('折り畳み長文の外側のフッターに既読人数を表示',async({page})=>{
 await setup(page);
 await page.locator(`[data-post="${own}"] .post__body`).evaluate(body=>{
  const text=body.querySelector('.post-message__text')!;
  const anchor=body.querySelector('.vrr-anchor')!;
  const wrapper=document.createElement('div');wrapper.style.cssText='height:60px;overflow:hidden';body.prepend(wrapper);wrapper.append(text,anchor);(text as HTMLElement).style.height='400px';
 });
 await expect(page.getByRole('button',{name:'既読 3人。表示済みの人を確認'})).toBeVisible();
 expect(await page.getByRole('button',{name:'既読 3人。表示済みの人を確認'}).evaluate(el=>Boolean(el.closest('.post__body-reactions-acks')))).toBe(true);
});
test('visibilityStateがhiddenになったら連続表示をリセット',async({page})=>{
 const mock=await setup(page,{delay:2000});
 await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(2300);expect(mock.seen).toHaveLength(0);
 await page.evaluate(()=>{delete (document as any).visibilityState;document.dispatchEvent(new Event('visibilitychange'));});
 await page.waitForTimeout(600);expect(mock.seen).toHaveLength(0);
 await expect.poll(()=>seen(mock,p1)).toBe(true);
});
test('計測中に画面の50%未満まで隠れた投稿を記録しない',async({page})=>{
 const mock=await setup(page,{mode:'offscreen'});
 await page.locator(`[data-post="${p2}"] .post-message__text`).evaluate(el=>{
  const wrapper=document.createElement('div');wrapper.style.cssText='height:5px;overflow:hidden';el.before(wrapper);wrapper.append(el);
 });
 await page.locator('#main-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 await page.waitForTimeout(1400);expect(seen(mock,p2)).toBe(false);
});

test('本体のCookie認証に必要なCSRFヘッダーをPOSTに付与',async({page})=>{
 const mock=await setup(page);await expect.poll(()=>seen(mock,p1)).toBe(true);
 expect(mock.csrf.length).toBeGreaterThan(0);expect(mock.csrf.every(value=>value==='fixture-csrf')).toBe(true);
});
test('SiteURLのサブパス配下にプラグインAPIを要求',async({page})=>{
 const mock=await setup(page);
 await page.evaluate(async()=>{const t=(window as any).test;t.siteURL(window.location.origin+'/mattermost');await t.request('counts',{post_ids:[t.IDs.own]});});
 expect(mock.urls.some(url=>url.includes('/mattermost/plugins/com.nito.viewport-read-receipts/api/v1/counts'))).toBe(true);
});

test('保存先エラー時に100msごとの連続再送をしない',async({page})=>{
 const mock=await setup(page,{failSeen:true});await expect.poll(()=>mock.seen.length).toBeGreaterThan(0);
 const before=mock.seen.length;await page.waitForTimeout(2300);expect(mock.seen.length).toBe(before);
});
