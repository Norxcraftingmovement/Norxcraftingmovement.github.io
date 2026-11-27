import test from "node:test";
import assert from "node:assert/strict";
import pub from "../src/orders-public-worker.mjs";
import {setupV1,orderInput,NOW} from "./helpers/orders-env.mjs";
const ORIGIN="https://norxcraftingmovement.com",U="https://orders.test/api/orders";
const realNow=Date.now;
const withClock=async(ms,f)=>{Date.now=()=>ms;try{return await f()}finally{Date.now=realNow}};
const post=(env,body,{type="text/plain;charset=utf-8",origin=ORIGIN}={})=>pub.fetch(new Request(U,{method:"POST",headers:{"Content-Type":type,...(origin?{Origin:origin}:{})},body:typeof body==="string"?body:JSON.stringify(body)}),env,{waitUntil(){}});

test("GET config / POST submit work as V1 does (text/plain body, HTTP 200 always) with CORS only for the storefront origin",async()=>{
  const {env,sqlite}=await setupV1();
  await withClock(NOW,async()=>{
    const g=await pub.fetch(new Request(U,{headers:{Origin:ORIGIN}}),env,{});
    assert.equal(g.status,200);assert.equal(g.headers.get("access-control-allow-origin"),ORIGIN);assert.equal((await g.json()).round.id,"ROUND-001");
    const r=await post(env,{action:"submit",order:orderInput()});const b=await r.json();
    assert.equal(r.status,200);assert.equal(b.ok,true);assert.match(b.id,/^NORX-/);assert.equal(r.headers.get("access-control-allow-origin"),ORIGIN);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM orders").get().n,1);
    const evil=await post(env,{action:"submit",order:orderInput()},{origin:"https://evil.test"});assert.equal(evil.headers.get("access-control-allow-origin"),null);
  });
});
test("errors keep V1 shape {ok:false,error} with HTTP 200; internal faults are generic (no leak)",async()=>{
  const {env,sqlite}=await setupV1();
  await withClock(NOW,async()=>{
    for(const [body,re] of [["not json",/ข้อมูลออเดอร์ไม่ถูกต้อง/],[{action:"other"},/ไม่รองรับคำสั่งนี้/],[{action:"submit",order:orderInput({expectedTotal:1})},/ยอดเงินเปลี่ยน/],[{action:"submit",order:{...orderInput(),website:"bot"}},/ไม่สามารถบันทึกคำขอนี้ได้/],["x".repeat(70000),/ข้อมูลออเดอร์ไม่ถูกต้อง/]]){
      const r=await post(env,body);assert.equal(r.status,200);const b=await r.json();assert.equal(b.ok,false);assert.match(b.error,re);
    }
    sqlite.exec("CREATE TRIGGER boom BEFORE INSERT ON order_items BEGIN SELECT RAISE(ABORT,'secret db detail'); END");
    const orig=console.error;console.error=()=>{};
    try{const r=await post(env,{action:"submit",order:orderInput()});const b=await r.json();assert.equal(b.ok,false);assert.ok(!/secret db detail|boom/.test(b.error));}finally{console.error=orig}
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM orders").get().n,0);
  });
});
test("OPTIONS preflight, unknown path, bad method; environment guard blocks mismatched DB",async()=>{
  const {env,sqlite}=await setupV1();
  const o=await pub.fetch(new Request(U,{method:"OPTIONS",headers:{Origin:ORIGIN}}),env,{});assert.equal(o.status,204);assert.equal(o.headers.get("access-control-allow-origin"),ORIGIN);
  assert.equal((await pub.fetch(new Request("https://orders.test/admin/orders/"),env,{})).status,404);
  assert.equal((await pub.fetch(new Request(U,{method:"DELETE"}),env,{})).status,405);
  sqlite.exec("UPDATE meta SET value='production'");
  const r=await pub.fetch(new Request(U),env,{});assert.equal((await r.json()).ok,false);
});
test("rate limiter binding is honoured",async()=>{
  const {env}=await setupV1();env.ORDERS_LIMITER={limit:async()=>({success:false})};
  await withClock(NOW,async()=>{const b=await(await post(env,{action:"submit",order:orderInput()})).json();assert.equal(b.ok,false);assert.match(b.error,/ถี่เกินไป/)});
});
test("the public worker exposes no admin or personal-data route",async()=>{
  const {env}=await setupV1();
  for(const p of ["/api/admin/orders","/api/admin/overview","/admin/shipping/","/admin/assets/style.css","/api/orders/list","/api/track"])assert.equal((await pub.fetch(new Request("https://orders.test"+p),env,{})).status,404,p);
});
test("scheduled(): dispatches queue; with no provider secret nothing is marked failed",async()=>{
  const {env,sqlite}=await setupV1();
  await withClock(NOW,async()=>{await post(env,{action:"submit",order:orderInput()})});
  const jobs=[];await pub.scheduled({},env,{waitUntil:p=>jobs.push(p)});await Promise.all(jobs);
  assert.equal(sqlite.prepare("SELECT status s FROM notification_queue").get().s,"queued");
});

test("scheduled(): a burst of orders is drained in ONE cron run (several batches), not 10 per minute",async()=>{
  const {env,sqlite}=await setupV1();env.EMAIL={send:async()=>({messageId:"m"})};env.NOTIFY_FROM="alerts@example.test";
  await withClock(NOW,async()=>{for(let i=0;i<40;i++)await post(env,{action:"submit",order:orderInput()})});
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM notification_queue WHERE status='queued'").get().n,40);
  const jobs=[];const real=Date.now;Date.now=()=>NOW+60000;try{await pub.scheduled({},env,{waitUntil:p=>jobs.push(p)});await Promise.all(jobs)}finally{Date.now=real}
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM notification_queue WHERE status='sent'").get().n,40);
});

test("rate limiter: submits and payment-page views use SEPARATE buckets; config reads are never limited; refused submits create nothing; production-strength limits are identical in staging",async()=>{
  const {env,sqlite}=await setupV1();const seen=[];let allow=true;env.ORDERS_LIMITER={limit:async({key})=>{seen.push(key);return {success:allow}}};
  const ip={"CF-Connecting-IP":"203.0.113.9"};
  await withClock(NOW,async()=>{
    await pub.fetch(new Request(U),env,{});assert.deepEqual(seen,[],"GET config is not limited");
    const ok=await pub.fetch(new Request(U,{method:"POST",headers:ip,body:JSON.stringify({action:"submit",order:orderInput()})}),env,{});assert.equal((await ok.json()).ok,true);
    await pub.fetch(new Request("https://orders.test/api/orders/pay?o=NORX-AAAAAAAA&t="+"A".repeat(22),{headers:ip}),env,{});
    assert.deepEqual(seen,["203.0.113.9","pay:203.0.113.9"]);
    allow=false;const before=sqlite.prepare("SELECT COUNT(*) n FROM orders").get().n;
    const no=await (await pub.fetch(new Request(U,{method:"POST",headers:ip,body:JSON.stringify({action:"submit",order:orderInput()})}),env,{})).json();assert.deepEqual([no.ok,/ถี่เกินไป/.test(no.error)],[false,true]);
    assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM orders").get().n,before);
    assert.equal((await pub.fetch(new Request("https://orders.test/api/orders/pay?o=NORX-AAAAAAAA&t="+"A".repeat(22),{headers:ip}),env,{})).status,429);
  });
  const {readFileSync}=await import("node:fs");const cfg=JSON.parse(readFileSync(new URL("../wrangler.orders-public.jsonc",import.meta.url),"utf8"));
  assert.deepEqual(cfg.env.staging.ratelimits[0].simple,{limit:10,period:60});assert.deepEqual(cfg.env.staging.ratelimits[0].simple,cfg.env.production.ratelimits[0].simple,"staging is not looser than production");
});
