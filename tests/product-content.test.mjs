import test from "node:test";
import assert from "node:assert/strict";
import { setupV1, orderInput, NOW, origin } from "./helpers/orders-env.mjs";
import { getProductContent, saveProductContent } from "../src/product-content.mjs";
import worker from "../src/orders-admin-worker.mjs";
import * as svc from "../src/orders-service.mjs";
const clone=structuredClone, png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9kAAAAASUVORK5CYII=","base64");
const body=state=>({expectedRevision:state.revision,content:clone(state.content)});
const snapshot=db=>Object.fromEntries(['products','product_variants','product_sizes','rounds','orders','order_items'].map(table=>[table,db.prepare('SELECT * FROM '+table+' ORDER BY id').all()]));
async function setup(){const x=await setupV1(),objects=new Map();x.env.PRODUCT_MEDIA={put:async(k,b,o)=>objects.set(k,{body:b,...o}),get:async k=>objects.get(k),delete:async k=>objects.delete(k)};const call=(path,method='GET',data,ctx=x.ctx,headers={})=>worker.fetch(new Request(origin+path,{method,body:data,headers:{Origin:origin,...headers}}),x.env,ctx);const json=(data,id=1)=>call('/api/admin/products/'+id+'/content','PUT',JSON.stringify(data),undefined,{'Content-Type':'application/json'});const upload=(data,files,id=1)=>{const form=new FormData();form.set('data',JSON.stringify(data));for(const [ref,bytes=png,type='image/png']of files)form.append('file:'+ref,new File([bytes],'discarded-filename.png',{type}));return call('/api/admin/products/'+id+'/content','PUT',form);};return {...x,objects,call,json,upload};}
test('existing referenced product content saves as a separate draft; commerce and order snapshots stay identical',async()=>{
  const {env,sqlite}=await setup();await svc.submitOrder(env,orderInput(),{now:NOW});const before=snapshot(sqlite),config=await svc.loadConfig(env),state=await getProductContent(env,1),data=body(state);
  assert.equal(state.content.gallery[0].images.length,5);assert.equal(state.content.lookbook.length,9);assert.equal(state.content.sizing.rows.length,6);
  data.content.heading='HOME TERRAIN — draft only';data.content.themeId='woven-stride-v1';data.content.highlights=[{title:'ข้อมูลทดสอบ',body:'ข้อความสมมติ'}];data.content.sizing.rows[0][1]='35.5';
  const saved=await saveProductContent(env,'test',1,data);assert.ok(saved.revision>0);assert.equal(saved.hasDraft,true);assert.equal(saved.content.heading,data.content.heading);assert.deepEqual(snapshot(sqlite),before);assert.deepEqual(await svc.loadConfig(env),config);
  assert.equal((await getProductContent(env,2)).content.gallery.length,3);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity='product-content'").get().n,1);
});
test('commercial fields, invalid theme/media/measurements and excessive data reject without writes',async()=>{
  const {env,sqlite}=await setup(),state=await getProductContent(env,1);
  const invalid=[b=>b.prices={short:1},b=>b.content.status='active',b=>b.content.themeId='css-injection',b=>b.content.hero.src='https://external.test/x.jpg',b=>b.content.hero.src='/assets/drop02/ANC_9514.jpg',b=>b.content.sizing.unit='unknown',b=>b.content.sizing.rows[0][1]='0',b=>b.content.sizing.rows[0][1]='<script>',b=>b.content.sizing.headers[1]='ไซส์',b=>b.content.sizing.rows.push(b.content.sizing.rows[0]),b=>b.content.highlights=[{title:'x',body:'y',html:'bad'}],b=>b.content.heading='x'.repeat(141),b=>b.content.hero.alt=''];
  for(const change of invalid){const data=body(state);change(data);await assert.rejects(saveProductContent(env,'test',1,data));}
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity='product-content'").get().n,0);assert.equal((await getProductContent(env,1)).hasDraft,false);
});
test('content revision CAS rejects stale/concurrent edits and setting failure rolls audit back',async()=>{
  const {env,hooks,sqlite}=await setup(),initial=await getProductContent(env,1);
  const results=await Promise.allSettled(['A','B'].map(heading=>saveProductContent(env,heading,1,{...body(initial),content:{...clone(initial.content),heading}})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const current=await getProductContent(env,1);hooks.onStatement=sql=>{if(sql.startsWith('INSERT INTO settings(key,value)'))throw Error('test rollback');};
  await assert.rejects(saveProductContent(env,'test',1,{...body(current),content:{...clone(current.content),heading:'Must rollback'}}),/test rollback/);assert.equal((await getProductContent(env,1)).revision,current.revision);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity='product-content'").get().n,1);
});
test('content page/API/image use owner, same-origin and environment gates; archived product is read-only',async()=>{
  const {env,call,json,sqlite}=await setup();for(const path of ['/admin/products/1/content/','/api/admin/products/1/content'])assert.equal((await call(path,'GET',undefined,{})).status,403);
  const state=await getProductContent(env,1);assert.equal((await call('/api/admin/products/1/content','PUT',JSON.stringify(body(state)),undefined,{Origin:'https://external.test','Content-Type':'application/json'})).status,403);
  env.ORDERS_DB_LABEL='production';assert.equal((await call('/api/admin/products/1/content')).status,503);env.ORDERS_DB_LABEL='staging';
  sqlite.exec("UPDATE products SET status='archived' WHERE id=1");assert.equal((await json(body(state))).status,400);assert.equal((await getProductContent(env,1)).editable,false);
});
test('multi-image save creates private references; replacement/removal revoke reads without changing products',async()=>{
  const {env,upload,call,json,objects}=await setup(),data=body(await getProductContent(env,1)),a=crypto.randomUUID(),b=crypto.randomUUID();data.content.hero={src:'upload:'+a,alt:'TEST HERO',caption:''};data.content.gallery[0].images.push({src:'upload:'+b,alt:'TEST PHOTO',caption:''});
  const response=await upload(data,[[a],[b]]);assert.equal(response.status,200);const saved=await response.json(),src=saved.content.hero.src;assert.equal(objects.size,2);assert.equal((await call(src)).status,200);assert.equal((await call(src,'GET',undefined,{})).status,403);
  const other=body(await getProductContent(env,2));other.content.hero={...saved.content.hero};assert.equal((await json(other,2)).status,400);
  const remove=body(saved);remove.content.hero={src:'',alt:'',caption:''};remove.content.gallery[0].images.pop();assert.equal((await json(remove)).status,200);assert.equal((await call(src)).status,404);assert.equal(objects.size,2);
});
test('malformed/unsupported/unreferenced files fail before uploading; no binding still allows existing-content edits',async()=>{
  const {env,upload,json,objects}=await setup(),state=await getProductContent(env,1),a=crypto.randomUUID(),b=crypto.randomUUID(),data=body(state);data.content.hero={src:'upload:'+a,alt:'TEST',caption:''};
  assert.equal((await upload(data,[[a,png,'image/svg+xml']])).status,400);assert.equal((await upload(data,[[a],[b]])).status,400);
  assert.equal((await upload({expectedRevision:0,content:null},[[a]])).status,400);assert.equal(objects.size,0);
  delete env.PRODUCT_MEDIA;assert.equal((await upload(data,[[a]])).status,400);assert.equal((await json(body(state))).status,200);
});
test('partial storage failure and database failure clean only newly uploaded unreferenced objects',async()=>{
  const {env,upload,objects,hooks}=await setup(),data=body(await getProductContent(env,1)),a=crypto.randomUUID(),b=crypto.randomUUID();data.content.hero={src:'upload:'+a,alt:'TEST',caption:''};data.content.lookbook.push({src:'upload:'+b,alt:'TEST',caption:''});let calls=0;const put=env.PRODUCT_MEDIA.put;env.PRODUCT_MEDIA.put=async(...args)=>{if(++calls===2)throw Error('storage failure');return put(...args);};
  assert.equal((await upload(data,[[a],[b]])).status,500);assert.equal(objects.size,0);env.PRODUCT_MEDIA.put=put;
  hooks.onStatement=sql=>{if(sql.startsWith('INSERT INTO settings(key,value)'))throw Error('DB failure');};assert.equal((await upload(data,[[a],[b]])).status,500);assert.equal(objects.size,0);assert.equal((await getProductContent(env,1)).hasDraft,false);
});
test('post-commit response failure retains accepted images and stale retry leaves the accepted content intact',async()=>{
  const {env,upload,objects,call}=await setup(),data=body(await getProductContent(env,1)),a=crypto.randomUUID();data.content.hero={src:'upload:'+a,alt:'TEST',caption:''};const db=env.ORDERS_DB;let committed=false;
  env.ORDERS_DB={...db,batch:async list=>{const r=await db.batch(list);committed=true;return r;},prepare:sql=>{if(committed&&sql.startsWith('SELECT p.*'))throw Error('response failure');return db.prepare(sql);}};
  assert.equal((await upload(data,[[a]])).status,500);assert.equal(objects.size,1);env.ORDERS_DB=db;const saved=await getProductContent(env,1);assert.equal((await call(saved.content.hero.src)).status,200);
  assert.equal((await upload(data,[[a]])).status,400);assert.equal(objects.size,1);assert.equal((await getProductContent(env,1)).revision,saved.revision);
});
test('request body and file-count limits reject oversized streams before any upload or draft write',async()=>{
  const {call,objects,upload,env}=await setup();
  assert.equal((await call('/api/admin/products/1/content','PUT',new Uint8Array(65537),undefined,{'Content-Type':'application/json'})).status,400);
  assert.equal((await call('/api/admin/products/1/content','PUT',new Uint8Array(12*1024*1024+65537),undefined,{'Content-Type':'multipart/form-data; boundary=test'})).status,400);
  const data=body(await getProductContent(env,1)),files=[];for(let n=0;n<9;n++){const id=crypto.randomUUID();files.push([id]);data.content.lookbook.push({src:'upload:'+id,alt:'TEST',caption:''});}
  assert.equal((await upload(data,files)).status,400);assert.equal(objects.size,0);assert.equal((await getProductContent(env,1)).hasDraft,false);
});
