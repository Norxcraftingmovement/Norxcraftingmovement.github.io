import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setupV1,origin} from './helpers/orders-env.mjs';
import {getProductContent,saveProductContent} from '../src/product-content.mjs';
import {productPublicationState,reviewProduct,publishProduct,publishedProduct} from '../src/product-publication.mjs';
import {productSource} from '../src/generated/product-publication-assets.mjs';
import {productPublicationAssetModule} from '../scripts/product-publication-source.mjs';
import {imageReferenced} from '../src/product-images.mjs';
import admin from '../src/orders-admin-worker.mjs';
import pub from '../src/orders-public-worker.mjs';
const now=Date.parse('2026-11-28T03:00:00Z');
async function setup(){const x=await setupV1();x.env.WEBSITE_MANAGEMENT_ENABLED='1';return x;}
async function save(env,id,heading){const s=await getProductContent(env,id);return saveProductContent(env,'owner',id,{expectedRevision:s.revision,content:{...structuredClone(s.content),heading}});}
async function review(env,id,targetId=''){const s=await productPublicationState(env,id);return reviewProduct(env,'owner',id,{expectedRevision:s.revision,expectedPublishedId:s.published?.id||'',targetId},now);}
const publish=(env,id,p)=>publishProduct(env,'owner',id,{proof:p.proof},now);
test('each product publishes independently; immutable snapshots and rollback preserve draft, commerce and theme',async()=>{
 const {env,sqlite}=await setup(),before=sqlite.prepare('SELECT * FROM products').all();
 await save(env,1,'FIRST');assert.equal(await publishedProduct(env,'drop03'),null);let p=await review(env,1);assert.match(p.html,/FIRST/);assert.doesNotMatch(p.html,/<script/);await publish(env,1,p);
 await save(env,1,'SECOND');assert.equal((await publishedProduct(env,'drop03')).snapshot.content.heading,'FIRST');await publish(env,1,await review(env,1));
 const baseline=(await productPublicationState(env,1)).history.find(s=>s.action==='baseline');await publish(env,1,await review(env,1,baseline.id));assert.notEqual((await publishedProduct(env,'drop03')).snapshot.content.heading,'SECOND');assert.equal((await getProductContent(env,1)).content.heading,'SECOND');
 await save(env,2,'PAPER');await publish(env,2,await review(env,2));assert.equal((await publishedProduct(env,'drop02')).snapshot.content.themeId,'woven-stride-v1');assert.equal((await productPublicationState(env,1)).history.length,4);assert.deepEqual(sqlite.prepare('SELECT * FROM products').all(),before);
});
test('proof is one-time, actor/product/head/revision/catalog/expiry bound; cross-product rollback rejects',async()=>{
 const {env,sqlite}=await setup();await save(env,1,'FIRST');await save(env,2,'OTHER');let p=await review(env,1);
 await assert.rejects(publish(env,2,p),/พรีวิว/);await assert.rejects(publishProduct(env,'other',1,{proof:p.proof},now),/พรีวิว/);await assert.rejects(publishProduct(env,'owner',1,{proof:p.proof},now+600000),/พรีวิว/);
 sqlite.exec('UPDATE product_variants SET price_baht=500 WHERE product_id=1');await assert.rejects(publish(env,1,p),/เปลี่ยน/);p=await review(env,1);await save(env,1,'CHANGED');await assert.rejects(publish(env,1,p),/เปลี่ยน/);
 p=await review(env,1);await publish(env,1,p);await assert.rejects(publish(env,1,p),/พรีวิว/);const snapshot=(await productPublicationState(env,1)).history[0];await assert.rejects(review(env,2,snapshot.id),/ฉบับเดิม/);
});
test('draft/archived and disabled or production environments cannot publish; archived head is not served',async()=>{
 const {env,sqlite}=await setup();await save(env,1,'A');env.WEBSITE_MANAGEMENT_ENABLED='0';await assert.rejects(review(env,1),/เผยแพร่/);env.WEBSITE_MANAGEMENT_ENABLED='1';env.ENVIRONMENT='production';await assert.rejects(review(env,1),/เผยแพร่/);env.ENVIRONMENT='staging';
 await publish(env,1,await review(env,1));sqlite.exec("UPDATE products SET status='archived' WHERE id=1");assert.equal(await publishedProduct(env,'drop03'),null);await assert.rejects(review(env,1),/เผยแพร่/);
 sqlite.exec("UPDATE products SET status='draft' WHERE id=1");await assert.rejects(review(env,1),/เผยแพร่/);
});
test('transaction CAS blocks price/archive races and rolls head/history/proof back on storage failure',async()=>{
 const {env,sqlite}=await setup();await save(env,1,'A');let p=await review(env,1),batch=env.ORDERS_DB.batch;
 env.ORDERS_DB.batch=async statements=>{sqlite.exec('UPDATE product_variants SET price_baht=501 WHERE product_id=1');return batch(statements);};await assert.rejects(publish(env,1,p),/เปลี่ยน/);assert.equal((await productPublicationState(env,1)).history.length,0);
 env.ORDERS_DB.batch=batch;p=await review(env,1);env.ORDERS_DB.batch=async statements=>{sqlite.exec("UPDATE products SET status='archived' WHERE id=1");return batch(statements);};await assert.rejects(publish(env,1,p),/เปลี่ยน/);env.ORDERS_DB.batch=batch;sqlite.exec("UPDATE products SET status='active' WHERE id=1");p=await review(env,1);
 sqlite.exec("CREATE TRIGGER broken_snapshot BEFORE INSERT ON settings WHEN NEW.key LIKE 'product-snapshot:%' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");await assert.rejects(publish(env,1,p),/synthetic failure/);assert.equal((await productPublicationState(env,1)).history.length,0);sqlite.exec('DROP TRIGGER broken_snapshot');await publish(env,1,p);
});
test('concurrent confirmations cannot overwrite a changed head',async()=>{
 const {env}=await setup();await save(env,1,'A');const a=await review(env,1),b=await review(env,1);const results=await Promise.allSettled([publish(env,1,a),publish(env,1,b)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await productPublicationState(env,1)).history.length,2);
});
test('public product uses shared content/theme and existing commerce runtime; unpublished drafts never leak',async()=>{
 const {env,ctx}=await setup();await save(env,1,'VISIBLE');await publish(env,1,await review(env,1));await save(env,1,'PRIVATE DRAFT');
 const response=await pub.fetch(new Request(origin+'/api/site/products/drop03'),env,ctx),html=await response.text();assert.equal(response.status,200);assert.match(html,/VISIBLE/);assert.doesNotMatch(html,/PRIVATE DRAFT|api\/admin|NORX Preview|draft-storefront/);assert.match(html,/id="products"/);assert.match(html,/product-runtime-drop03.js/);assert.match(html,/shop.js/);assert.match(response.headers.get('Content-Security-Policy'),/script-src 'self'/);assert.match(response.headers.get('X-Robots-Tag'),/noindex/);
 const runtime=await pub.fetch(new Request(origin+'/api/site/assets/product-runtime-drop03.js'),env,ctx);assert.match(await runtime.text(),/"product":"drop03"/);assert.equal((await pub.fetch(new Request(origin+'/api/site/products/drop02'),env,ctx)).status,404);
});
test('publication routes enforce owner, origin and staging gates',async()=>{
 const {env,ctx}=await setup();await save(env,1,'A');const path=origin+'/api/admin/products/1/content/review',s=await productPublicationState(env,1),body=JSON.stringify({expectedRevision:s.revision,expectedPublishedId:''}),headers={'Content-Type':'application/json',Origin:origin};
 assert.equal((await admin.fetch(new Request(path,{method:'POST',headers,body}),env,{})).status,403);assert.equal((await admin.fetch(new Request(path,{method:'POST',headers:{...headers,Origin:'https://evil.test'},body}),env,ctx)).status,403);
 const r=await admin.fetch(new Request(path,{method:'POST',headers,body}),env,ctx);assert.equal(r.status,200);assert.ok((await r.json()).proof);
 assert.equal((await pub.fetch(new Request(origin+'/api/site/products/drop03'),env,{})).status,403);env.ENVIRONMENT='production';assert.notEqual((await pub.fetch(new Request(origin+'/api/site/products/drop03'),env,ctx)).status,200);
});
test('only current published images are public; historical references remain private and retained for rollback',async()=>{
 const {env,ctx,sqlite}=await setup(),file=crypto.randomUUID()+'.png',src='/api/admin/product-images/'+file,key='products/'+file;env.PRODUCT_MEDIA={get:async k=>k===key?{body:new Uint8Array([1,2,3])}:null};await save(env,1,'A');const s=await getProductContent(env,1);await saveProductContent(env,'owner',1,{expectedRevision:s.revision,content:{...s.content,hero:{src,alt:'new',caption:''}}},[src]);
 const request=()=>pub.fetch(new Request(origin+'/api/site/media/'+file),env,ctx);assert.equal((await request()).status,404);await publish(env,1,await review(env,1));assert.equal((await request()).status,200);
 const baseline=(await productPublicationState(env,1)).history.find(s=>s.action==='baseline');await publish(env,1,await review(env,1,baseline.id));assert.equal((await request()).status,404);sqlite.prepare('DELETE FROM settings WHERE key=?').run('product-content:1');assert.equal(await imageReferenced(env,key),true);
});
test('renderer changes invalidate tickets and incompatible snapshots; generated public source excludes admin assets',async()=>{
 const {env}=await setup();await save(env,1,'A');const p=await review(env,1),theme=productSource.themes['home-terrain-v1'],original=theme.version;theme.version='changed';try{await assert.rejects(publish(env,1,p),/เปลี่ยน/);}finally{theme.version=original;}await publish(env,1,await review(env,1));theme.version='changed';try{await assert.rejects(publishedProduct(env,'drop03'),/Unsupported/);}finally{theme.version=original;}
 const artifact=readFileSync(new URL('../src/generated/product-publication-assets.mjs',import.meta.url),'utf8');assert.equal(artifact,productPublicationAssetModule());assert.doesNotMatch(artifact,/product-content-app|base64|\/api\/admin/);
});
