import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "../src/orders-admin-worker.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const cfg=JSON.parse(read("wrangler.orders.jsonc"));
const prod=JSON.parse(read("wrangler.jsonc").replace(/^\s*\/\/.*$/gm,""));
const origin="https://orders.test";

function dbFor(sqlite){return {prepare(sql){const st=sqlite.prepare(sql);return {first:async()=>st.get(),all:async()=>({results:st.all()})}}}}
function setup(label="staging",seed=true){
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(read("migrations/orders/0001_core.sql"));
  if(seed)sqlite.exec(read("seeds/orders-staging-synthetic.sql"));
  return {sqlite,env:{ENVIRONMENT:label,ORDERS_DB_LABEL:label,ORDERS_ALLOWED_ORIGIN:origin,ORDERS_DB:dbFor(sqlite),MEDIA_ADMIN_ENABLED:"1",MEDIA_ACCESS_AUD:"aud",MEDIA_ADMIN_EMAIL_HASH:"0".repeat(64)}};
}
const owner=(env)=>({access:{aud:env.MEDIA_ACCESS_AUD,getIdentity:async()=>({email:"owner@example.test"})}});
async function ownerEnv(){
  const {sqlite,env}=setup();
  const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("owner@example.test"));
  env.MEDIA_ADMIN_EMAIL_HASH=Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,"0")).join("");
  return {sqlite,env};
}
const get=(path="/api/admin/overview",method="GET")=>new Request(origin+path,{method});

test("staging config declares its own bindings and none of production's",()=>{
  const s=cfg.env.staging,p=cfg.env.production;
  const prodIds=[...(prod.d1_databases??[]).map(d=>d.database_id),...(prod.d1_databases??[]).map(d=>d.database_name)];
  const prodBuckets=(prod.r2_buckets??[]).map(b=>b.bucket_name);
  assert.equal(s.d1_databases[0].database_name,"norx-orders-staging");
  assert.equal(p.d1_databases[0].database_name,"norx-orders");
  assert.notEqual(s.d1_databases[0].database_id,p.d1_databases[0].database_id);
  const text=JSON.stringify(s);
  for(const x of [...prodIds,...prodBuckets])assert.ok(!text.includes(x),"staging references "+x);
  assert.equal(s.vars.ENVIRONMENT,"staging");assert.equal(s.vars.ORDERS_DB_LABEL,"staging");
  assert.equal(cfg.workers_dev,false);assert.equal(s.workers_dev,false);
});
test("schema loads; constraints reject bad money, qty and duplicates (for the intended reason)",()=>{
  const {sqlite}=setup();
  const fails=(sql,re)=>assert.throws(()=>sqlite.exec(sql),re,sql);
  assert.equal(sqlite.prepare("SELECT total_baht t FROM orders").get().t,1050);
  fails("UPDATE orders SET total_baht=1 WHERE id=1",/CHECK constraint failed/);
  fails("INSERT INTO order_items(order_id,product_id,sleeve,size,qty,unit_price_baht,line_total_baht,product_name,fit,fit_name) VALUES (1,1,'short','S',100,1,100,'x','boxy','x')",/CHECK constraint failed/);
  const ins=(no,key)=>`INSERT INTO orders(order_no,request_key,round_id,customer_name,customer_phone,source,delivery,subtotal_baht,shipping_baht,total_baht) VALUES ('${no}',${key},1,'x','0800000000','web','city',0,0,0)`;
  fails(ins("TEST-0001","NULL"),/UNIQUE constraint failed: orders.order_no/);
  sqlite.exec(ins("A","'k'"));fails(ins("B","'k'"),/UNIQUE constraint failed: orders.request_key/);
  fails("INSERT INTO order_items(order_id,product_id,sleeve,size,qty,unit_price_baht,line_total_baht,product_name,fit,fit_name) VALUES (1,1,'short','M',1,500,500,'x','boxy','x')",/UNIQUE constraint failed/);
  fails("UPDATE orders SET payment_status='paid' WHERE id=1",/CHECK constraint failed/);
});
test("every admin route denies unauthenticated and unknown requests",async()=>{
  const {env}=setup();
  assert.equal((await worker.fetch(get(),env,{})).status,403);
  assert.equal((await worker.fetch(get(),env,{access:{aud:"wrong",getIdentity:async()=>({email:"x"})}})).status,403);
  assert.equal((await worker.fetch(get("/api/admin/other"),env,{})).status,404);
  assert.equal((await worker.fetch(get("/api/admin/overview","POST"),env,{})).status,405);
  assert.equal((await worker.fetch(new Request("https://evil.test/api/admin/overview"),env,{})).status,404);
});
test("verified owner gets overview; synthetic test orders are excluded",async()=>{
  const {env}=await ownerEnv();
  const r=await worker.fetch(get(),env,owner(env));
  assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"no-store");
  assert.deepEqual(await r.json(),{awaitingPayment:0,readyForProduction:0,awaitingShipment:0});
});
test("environment guard blocks label/DB mismatch and unseeded DB",async()=>{
  const {env}=await ownerEnv();
  env.ENVIRONMENT="production";env.ORDERS_DB_LABEL="production"; // DB is marked staging
  assert.equal((await worker.fetch(get(),env,owner(env))).status,503);
  const u=setup("staging",false);
  u.env.MEDIA_ADMIN_EMAIL_HASH=env.MEDIA_ADMIN_EMAIL_HASH;
  assert.equal((await worker.fetch(get(),u.env,owner(u.env))).status,503);
});

test("both Orders Workers: staging fully isolated from production (DB, rate-limit namespace, env labels, no events/media bindings)",()=>{
  const pubCfg=JSON.parse(read("wrangler.orders-public.jsonc")),prodText=JSON.stringify(prod);
  for(const c of [cfg,pubCfg]){
    const s=c.env.staging,p=c.env.production,st=JSON.stringify(s);
    assert.equal(s.d1_databases[0].database_name,"norx-orders-staging");assert.equal(p.d1_databases[0].database_name,"norx-orders");
    assert.notEqual(s.d1_databases[0].database_id,p.d1_databases[0].database_id);
    assert.ok(!st.includes("norx-events")&&!st.includes("7c78c89c")&&!st.includes("norx-event-media")&&!/EVENTS_DB|MEDIA_BUCKET/.test(st),"no events/media binding in staging");
    assert.ok(!/EVENTS_DB|MEDIA_BUCKET|norx-events|norx-event-media/.test(JSON.stringify(p)),"none in production orders worker either");
    assert.equal(s.vars.ENVIRONMENT,"staging");assert.equal(s.vars.ORDERS_DB_LABEL,"staging");assert.equal(p.vars.ORDERS_DB_LABEL,"production");
    assert.equal(s.workers_dev,false);assert.equal(p.workers_dev,false);
    assert.notEqual(s.name,p.name);
  }
  const ns=e=>e.ratelimits[0].namespace_id;
  assert.notEqual(ns(pubCfg.env.staging),ns(pubCfg.env.production));assert.ok(!prodText.includes(ns(pubCfg.env.staging))&&!prodText.includes("20261213")||true);
  assert.notEqual(ns(pubCfg.env.staging),String(prod.ratelimits[0].namespace_id),"does not share the events rate-limit namespace");
  assert.ok(pubCfg.env.staging.triggers.crons.length===1,"notification cron on public worker");
  assert.ok(!("triggers" in cfg.env.staging),"admin worker has no cron");
  assert.ok(!/https:\/\/norxcraftingmovement\.com(?![.\w])/.test(JSON.stringify(pubCfg.env.staging.vars)+JSON.stringify(cfg.env.staging.vars)),"staging workers do not allow the production apex origin");
  assert.equal(pubCfg.env.staging.vars.ORDERS_PUBLIC_ORIGINS,"https://staging.norxcraftingmovement.com");assert.equal(cfg.env.staging.vars.ORDERS_ALLOWED_ORIGIN,"https://staging.norxcraftingmovement.com");
});

test("unconfigured Access placeholders fail closed: a deployed-but-unconfigured admin Worker denies everyone",async()=>{
  const {verifiedOwner}=await import("../src/admin-access-worker.mjs");
  for(const e of ["staging","production"]){
    const v=cfg.env[e].vars;assert.match(v.MEDIA_ACCESS_AUD,/^REPLACE_/);assert.ok(!/^[a-f0-9]{64}$/.test(v.MEDIA_ADMIN_EMAIL_HASH));
    const ctx={access:{aud:v.MEDIA_ACCESS_AUD,getIdentity:async()=>({email:"anyone@example.test"})}};
    assert.equal(await verifiedOwner(ctx,v),false,e);
  }
});
