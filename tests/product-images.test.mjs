import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupV1, origin } from "./helpers/orders-env.mjs";
import worker from "../src/orders-admin-worker.mjs";
import { productTemplate } from "../admin-ui/product-template.mjs";
import { assets } from "../src/generated/orders-admin-assets.mjs";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9kAAAAASUVORK5CYII=", "base64");
const draft = extra => ({slug:"cover-test",name:"COVER TEST",shortName:"TEST",fit:"boxy",fitName:"Boxy",prices:{short:490},sizes:["M"],description:"",...extra});
async function setup() {
  const x = await setupV1(), objects = new Map();
  x.env.PRODUCT_MEDIA = {put:async(k,b,o)=>objects.set(k,{body:b,...o}),get:async k=>objects.get(k),delete:async k=>objects.delete(k)};
  const call = (path,method="GET",body,ctx=x.ctx,headers={})=>worker.fetch(new Request(origin+path,{method,body,headers:{Origin:origin,...headers}}),x.env,ctx);
  const save = (data, id, bytes=png, type="image/png") => { const form=new FormData();form.set("data",JSON.stringify(data));form.set("cover",new File([bytes],"untrusted-name.png",{type}));return call("/api/admin/products"+(id?"/"+id:""),id?"PUT":"POST",form); };
  return {...x,objects,call,save};
}
test("cover persists privately with draft; JSON edit retains it, removal revokes URL",async()=>{
  const {save,call,objects}=await setup(); const r=await save(draft());assert.equal(r.status,200);const p=(await r.json()).product;
  assert.match(p.coverUrl,/^\/api\/admin\/product-images\/[0-9a-f-]+\.png$/);assert.equal(objects.size,1);
  const image=await call(p.coverUrl);assert.equal(image.headers.get("content-type"),"image/png");assert.match(image.headers.get("cache-control"),/no-store/);assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
  const json=async body=>{const r=await call("/api/admin/products/"+p.id,"PUT",JSON.stringify(body),undefined,{"Content-Type":"application/json"});assert.equal(r.status,200);return (await r.json()).product;};
  const kept=await json(draft({expectedRevision:p.revision,name:"Renamed"}));assert.equal(kept.coverUrl,p.coverUrl);
  const removed=await json(draft({expectedRevision:kept.revision,coverRemove:true}));assert.equal(removed.coverUrl,"");assert.equal((await call(p.coverUrl)).status,404);
});
test("replaced cover is immutable; old URL revoked and stale edit cleans only unreferenced upload",async()=>{
  const {save,call,objects}=await setup();const p=(await (await save(draft())).json()).product;
  const next=(await (await save(draft({expectedRevision:p.revision}),p.id)).json()).product;assert.notEqual(next.coverUrl,p.coverUrl);
  assert.equal((await call(p.coverUrl)).status,404);assert.equal(objects.size,2);
  assert.equal((await save(draft({expectedRevision:p.revision}),p.id)).status,400);assert.equal(objects.size,2);assert.equal((await call(next.coverUrl)).status,200);
});
test("wrong type/signature, oversized stream and absent binding fail without database changes",async()=>{
  const {save,call,objects,env,sqlite}=await setup();
  for(const [bytes,type] of [[png,"image/svg+xml"],[Buffer.from('<script>bad</script>'),"image/png"],[Buffer.alloc(4194305),"image/png"]])assert.equal((await save(draft(),null,bytes,type)).status,400);
  assert.equal(objects.size,0);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM products").get().n,2);
  delete env.PRODUCT_MEDIA;assert.equal((await save(draft())).status,400);assert.equal((await (await call("/api/admin/products")).json()).mediaReady,false);
});
test("owner/origin/environment gates apply to uploads and draft image reads",async()=>{
  const {save,call,env}=await setup();const p=(await (await save(draft())).json()).product;
  assert.equal((await call(p.coverUrl,"GET",undefined,{})).status,403);
  assert.equal((await call("/api/admin/products","POST",new FormData(),undefined,{Origin:"https://evil.test"})).status,403);
  env.ORDERS_DB_LABEL="production";assert.equal((await call(p.coverUrl)).status,503);
});
test("failed draft transaction cleans uploaded bytes and leaves existing data intact",async()=>{
  const {save,hooks,objects,sqlite}=await setup();hooks.onStatement=sql=>{if(sql.startsWith("INSERT INTO product_sizes"))throw Error("test");};
  assert.equal((await save(draft())).status,500);assert.equal(objects.size,0);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM products").get().n,2);
});
test("post-commit read failure must not delete an accepted image",async()=>{
  const {save,env,objects,call}=await setup(), db=env.ORDERS_DB;let committed=false;
  env.ORDERS_DB={...db,batch:async list=>{const r=await db.batch(list);committed=true;return r;},prepare:sql=>{if(committed&&sql.startsWith("SELECT p.*"))throw Error("post commit");return db.prepare(sql);}};
  assert.equal((await save(draft())).status,500);assert.equal(objects.size,1);env.ORDERS_DB=db;
  const p=(await (await call("/api/admin/products")).json()).products.find(p=>p.slug==="cover-test");assert.equal((await call(p.coverUrl)).status,200);
});
test("preview escapes all product text, denies arbitrary cover URLs and contains no checkout runtime",()=>{
  const html=productTemplate(draft({name:'<script>alert(1)</script>',description:'<img src=x onerror=alert(1)>',sizes:['<svg/onload=alert(1)>']}),'https://evil.test/track.png');
  assert.ok(!html.includes('<script>'));assert.equal((html.match(/<img /g)||[]).length,1);assert.ok(!html.includes('https://evil.test'));assert.ok(!html.includes('<img src=x')); assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes("script-src 'none'"));assert.ok(!html.includes('shop.js'));assert.ok(!html.includes('script.google'));
});
test("preview CSS shares current storefront stylesheet and only Products may frame previews",async()=>{
  const source=readFileSync(new URL('../home-terrain/index.html',import.meta.url),'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];assert.ok(assets['product-template.css'].text.startsWith(source));
  const {call}=await setup();assert.match((await call('/admin/products/')).headers.get('content-security-policy'),/frame-src 'self'/);assert.ok(!(await call('/admin/orders/')).headers.get('content-security-policy').includes('frame-src'));
});
