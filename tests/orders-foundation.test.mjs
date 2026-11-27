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
test("schema loads; constraints reject bad money, qty and duplicates",()=>{
  const {sqlite}=setup();
  assert.equal(sqlite.prepare("SELECT total_baht t FROM orders").get().t,1050);
  assert.throws(()=>sqlite.exec("UPDATE orders SET total_baht=1 WHERE id=1"));
  assert.throws(()=>sqlite.exec("INSERT INTO order_items(order_id,product_id,sleeve,size,qty,unit_price_baht,line_total_baht) VALUES (1,1,'short','S',100,1,100)"));
  assert.throws(()=>sqlite.exec("INSERT INTO orders(order_no,customer_id,source,delivery,subtotal_baht,shipping_baht,total_baht) VALUES ('TEST-0001',1,'web','city',0,0,0)"));
  assert.throws(()=>sqlite.exec("INSERT INTO orders(order_no,request_key,customer_id,source,delivery,subtotal_baht,shipping_baht,total_baht) VALUES ('A','k',1,'web','city',0,0,0),('B','k',1,'web','city',0,0,0)"));
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
