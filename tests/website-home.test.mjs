import test from 'node:test';
import assert from 'node:assert/strict';
import { setupV1,origin } from './helpers/orders-env.mjs';
import { getHome,saveHome,reviewHome,publishHome,publishedHome } from '../src/website-home.mjs';
import worker from '../src/orders-admin-worker.mjs';
import pub from '../src/orders-public-worker.mjs';
import { readFileSync } from 'node:fs';
import { websiteHomeSource, websiteHomeAssetModule } from '../scripts/website-home-source.mjs';
import { assets } from '../src/generated/orders-admin-assets.mjs';
const copy=structuredClone,now=Date.parse('2026-11-28T03:00:00Z');
async function setup(){const x=await setupV1(),objects=new Map();x.env.WEBSITE_MANAGEMENT_ENABLED='1';x.env.PRODUCT_MEDIA={put:async(k,b,o)=>objects.set(k,{body:b,...o}),get:async k=>objects.get(k),delete:async k=>objects.delete(k)};const call=(path,method='GET',body,ctx=x.ctx,headers={})=>worker.fetch(new Request(origin+path,{method,body,headers:{Origin:origin,...headers}}),x.env,ctx);return {...x,objects,call};}
const save=async(env,heading)=>{const state=await getHome(env);return saveHome(env,'test',{expectedRevision:state.revision,content:{...copy(state.content),heading}});};
const review=async(env,targetId='')=>{const state=await getHome(env);return reviewHome(env,'test',{expectedRevision:state.revision,expectedPublishedId:state.published?.id||'',targetId},now);};
test('draft is separate; review/publish freezes content; rollback preserves current draft and commerce',async()=>{
 const {env,sqlite}=await setup(),before=sqlite.prepare('SELECT * FROM products').all(),initial=await getHome(env);assert.equal(initial.history.length,0);await save(env,'FIRST');assert.equal(await publishedHome(env),null);
 let proof=await review(env);assert.ok(proof.html.includes('FIRST'));assert.ok(!proof.html.includes('<script'));await publishHome(env,'test',{proof:proof.proof},now);assert.equal((await getHome(env)).history.length,2);
 await save(env,'SECOND');assert.equal((await publishedHome(env)).content.heading,'FIRST');proof=await review(env);await publishHome(env,'test',{proof:proof.proof},now+1);
 const baseline=(await getHome(env)).history.find(s=>s.action==='baseline');proof=await review(env,baseline.id);await publishHome(env,'test',{proof:proof.proof},now+2);
 assert.equal((await publishedHome(env)).content.heading,initial.content.heading);assert.equal((await getHome(env)).content.heading,'SECOND');assert.deepEqual(sqlite.prepare('SELECT * FROM products').all(),before);
});
test('stale draft, head, expired/used proof, wrong actor and changed pricing cannot publish unseen content',async()=>{
 const {env,sqlite}=await setup();await save(env,'FIRST');let proof=await review(env);await assert.rejects(publishHome(env,'other',{proof:proof.proof},now),/พรีวิว/);await assert.rejects(publishHome(env,'test',{proof:proof.proof},now+600001),/พรีวิว/);
 await save(env,'SECOND');await assert.rejects(publishHome(env,'test',{proof:proof.proof},now),/พรีวิว/);proof=await review(env);sqlite.prepare("UPDATE product_variants SET price_baht=price_baht+1 WHERE product_id=1").run();await assert.rejects(publishHome(env,'test',{proof:proof.proof},now),/เนื้อหาเปลี่ยน/);
 proof=await review(env);await publishHome(env,'test',{proof:proof.proof},now);await assert.rejects(publishHome(env,'test',{proof:proof.proof},now),/พรีวิว/);
});
test('atomic publication rejects concurrent confirmations and rolls back all history/head writes on failure',async()=>{
 const {env,hooks,sqlite}=await setup();await save(env,'FIRST');const p=await review(env);hooks.onStatement=sql=>{if(sql.startsWith('INSERT INTO settings'))throw Error('test rollback');};await assert.rejects(publishHome(env,'test',{proof:p.proof},now),/test rollback/);assert.equal(await publishedHome(env),null);assert.equal((await getHome(env)).history.length,0);hooks.onStatement=null;
 const results=await Promise.allSettled([publishHome(env,'test',{proof:p.proof},now),publishHome(env,'test',{proof:p.proof},now)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity='website-publication'").get().n,1);
});
test('homepage validation rejects arbitrary links/images, commerce fields and duplicate/missing card registry',async()=>{
 const {env}=await setup(),state=await getHome(env);for(const mutate of [c=>c.prices={},c=>c.hero.src='https://external.test/track.jpg',c=>c.hero.position='css',c=>c.cards[0].href='https://external.test',c=>c.cards.pop(),c=>c.cards[1].slug=c.cards[0].slug,c=>c.pageTitle='']){const content=copy(state.content);mutate(content);await assert.rejects(saveHome(env,'test',{expectedRevision:0,content}));}assert.equal((await getHome(env)).hasDraft,false);
});
test('HTTP gates stay owner/origin/environment protected; publication is staging-only and disabled by default',async()=>{
 const {env,ctx,call}=await setup();assert.equal((await call('/admin/website/','GET',undefined,{})).status,403);assert.equal((await call('/api/admin/website/home','GET',undefined,{})).status,403);assert.equal((await call('/api/admin/website/home','PUT','{}',undefined,{Origin:'https://external.test','Content-Type':'application/json'})).status,403);
 await save(env,'FIRST');const p=await review(env);delete env.WEBSITE_MANAGEMENT_ENABLED;await assert.rejects(publishHome(env,'test',{proof:p.proof},now),/ยังไม่เปิด/);env.WEBSITE_MANAGEMENT_ENABLED='1';env.ENVIRONMENT='production';await assert.rejects(publishHome(env,'test',{proof:p.proof},now),/ยังไม่เปิด/);env.ENVIRONMENT='staging';env.ORDERS_DB_LABEL='production';assert.equal((await call('/api/admin/website/home')).status,503);
 env.ORDERS_DB_LABEL='staging';env.STAGING_REQUIRE_ACCESS='0';assert.equal((await pub.fetch(new Request(origin+'/api/site/home'),env,{})).status,403);
});
test('published HTML is SSR with managed metadata/cards and safe same-origin runtime; drafts never leak',async()=>{
 const {env,ctx}=await setup();const state=await getHome(env),content=copy(state.content);content.heading='<img src=x onerror=alert(1)> TEST';content.cards.reverse();content.cards[1].visible=false;content.pageTitle='PUBLISHED TITLE';await saveHome(env,'test',{expectedRevision:0,content});const p=await review(env);await publishHome(env,'test',{proof:p.proof},now);await save(env,'UNPUBLISHED SECRET TEXT');
 const response=await pub.fetch(new Request(origin+'/api/site/home'),env,ctx),html=await response.text();assert.equal(response.status,200);assert.ok(html.includes('<title>PUBLISHED TITLE</title>'));assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(!html.includes('UNPUBLISHED SECRET TEXT'));assert.ok(!html.includes('script.google'));assert.ok(!html.includes(' style='));assert.ok(html.includes('/shop.js?v=5'));assert.ok(html.includes('id="community"'));assert.ok(html.includes('id="roots"'));assert.ok(html.includes('data-price="drop02">แขนสั้น 490 บาท'));
 const runtime=await(await pub.fetch(new Request(origin+'/api/site/assets/home-runtime.js'),env,ctx)).text();assert.ok(runtime.includes('"/api/orders"'));assert.ok(!runtime.includes('script.google'));assert.equal((await pub.fetch(new Request(origin+'/api/site/home',{method:'POST'}),env,ctx)).status,405);
});
test('private hero uploads publish only by current snapshot reference; old public URLs revoke after rollback',async()=>{
 const {env,ctx,call}=await setup(),state=await getHome(env),content=copy(state.content);content.hero.src='upload:hero';const form=new FormData();form.set('data',JSON.stringify({expectedRevision:0,content}));form.set('cover',new File([Buffer.from([255,216,255,0,255,217])],'test.jpg',{type:'image/jpeg'}));const result=await call('/api/admin/website/home','PUT',form);assert.equal(result.status,200);const saved=await result.json(),publicUrl=saved.content.hero.src.replace('/api/admin/product-images/','/api/site/media/');
 assert.equal((await pub.fetch(new Request(origin+publicUrl),env,ctx)).status,404);let p=await review(env);await publishHome(env,'test',{proof:p.proof},now);assert.equal((await pub.fetch(new Request(origin+publicUrl),env,ctx)).status,200);
 const baseline=(await getHome(env)).history.find(s=>s.action==='baseline');p=await review(env,baseline.id);await publishHome(env,'test',{proof:p.proof},now+1);assert.equal((await pub.fetch(new Request(origin+publicUrl),env,ctx)).status,404);assert.equal((await call(saved.content.hero.src)).status,200);
});
test('renderer changes invalidate review/rollback and an incompatible published renderer fails closed',async()=>{
 const {env,sqlite,ctx}=await setup();await save(env,'FIRST');let p=await review(env);const key='website-review:'+p.proof,ticket=JSON.parse(sqlite.prepare('SELECT value FROM settings WHERE key=?').get(key).value);ticket.renderer='changed';sqlite.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(ticket),key);await assert.rejects(publishHome(env,'test',{proof:p.proof},now),/พรีวิว/);
 p=await review(env);await publishHome(env,'test',{proof:p.proof},now);const baseline=(await getHome(env)).history.find(s=>s.action==='baseline'),old=JSON.parse(sqlite.prepare('SELECT value FROM settings WHERE key=?').get('website-snapshot:'+baseline.id).value);old.rendererVersion='changed';sqlite.prepare('UPDATE settings SET value=? WHERE key=?').run(JSON.stringify(old),'website-snapshot:'+baseline.id);await assert.rejects(review(env,baseline.id),/แม่แบบคนละรุ่น/);
 const head=await publishedHome(env);head.rendererVersion='changed';sqlite.prepare("UPDATE settings SET value=? WHERE key='website-published:home'").run(JSON.stringify(head));assert.equal((await pub.fetch(new Request(origin+'/api/site/home'),env,ctx)).status,503);
});
test('homepage upload response failure preserves an accepted image; missing storage and oversized metadata fail safely',async()=>{
 const {env,call,objects}=await setup(),state=await getHome(env),content=copy(state.content);content.hero.src='upload:hero';const form=new FormData();form.set('data',JSON.stringify({expectedRevision:0,content}));form.set('cover',new File([Buffer.from([255,216,255,0,255,217])],'test.jpg',{type:'image/jpeg'}));const db=env.ORDERS_DB;let committed=false;env.ORDERS_DB={...db,batch:async list=>{const r=await db.batch(list);committed=true;return r;},prepare:sql=>{if(committed&&sql==='SELECT value FROM settings WHERE key=?')throw Error('after commit');return db.prepare(sql);}};
 assert.equal((await call('/api/admin/website/home','PUT',form)).status,500);env.ORDERS_DB=db;assert.equal(objects.size,1);const saved=await getHome(env);assert.equal((await call(saved.content.hero.src)).status,200);
 assert.equal((await call('/api/admin/website/home','PUT',new Uint8Array(32769),undefined,{'Content-Type':'application/json'})).status,400);assert.equal((await getHome(env)).revision,saved.revision);
 delete env.PRODUCT_MEDIA;const noStorage=new FormData();noStorage.set('data',JSON.stringify({expectedRevision:saved.revision,content}));noStorage.set('cover',new File(['bad'],'test.png',{type:'image/png'}));assert.equal((await call('/api/admin/website/home','PUT',noStorage)).status,400);
});
test('compiled homepage preserves source content and strips legacy configuration/inline behaviors for safe shared rendering',()=>{
 const source=websiteHomeSource();assert.equal(readFileSync(new URL("../src/generated/website-home-assets.mjs",import.meta.url),"utf8"),websiteHomeAssetModule());assert.deepEqual(JSON.parse(assets['website-home-source.json'].text),source);assert.match(source.version,/^[0-9a-f]{64}$/);assert.equal(source.defaults.heading,'NORX');assert.equal(source.defaults.brandLine,'CRAFTING MOVEMENT');assert.deepEqual(source.cards.map(c=>c.slug),['drop03','drop02']);assert.ok(source.body.includes('id="community"'));assert.ok(source.body.includes('id="roots"'));assert.ok(!/script\.google|<script| style=/.test(source.body+source.css+source.scripts));assert.ok(source.scripts.includes('lightbox'));assert.ok(!source.scripts.includes('NORX_API'));
});
