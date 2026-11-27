import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/orders-admin-worker.mjs";
import * as svc from "../src/orders-service.mjs";
import {setupV1,orderInput,call,origin,NOW} from "./helpers/orders-env.mjs";
const j=async r=>({status:r.status,body:await r.json()});
const store={bank:{name:"TEST BANK",account:"000-0-00000-0",holder:"TEST HOLDER"},chatUrl:"https://example.test/c",pageUrl:"https://example.test/p",eventName:"TEST",liveEnabled:true,rolling:false,notifyTo:"owner@example.test"};

test("EVERY new admin route/page rejects anonymous, wrong-AUD and wrong-identity callers and leaks nothing",async()=>{
  const {env,sqlite}=await setupV1();const r=await svc.submitOrder(env,orderInput(),{now:NOW});
  const routes=[["GET","/api/admin/orders"],["POST",`/api/admin/orders/${r.id}/status`,{from:"รอโอน",to:"ชำระแล้ว",amount:980}],["GET","/api/admin/rounds"],["POST","/api/admin/rounds",{}],
    ["POST","/api/admin/rounds/ROUND-001/open",{}],["POST","/api/admin/rounds/ROUND-001/close",{}],["POST","/api/admin/rounds/ROUND-001/cancel-unpaid",{expected:1}],["POST","/api/admin/rounds/ROUND-001/send-to-shop",{expectedPieces:2}],
    ["GET","/api/admin/pulse"],["GET","/api/admin/notifications"],["POST","/api/admin/notifications/1/retry",{}],["GET","/api/admin/metrics/latency"],["GET","/api/admin/settings/storefront"],["PUT","/api/admin/settings/storefront",store],["GET","/admin/orders/"]];
  const bad=[{},{access:{aud:"wrong",getIdentity:async()=>({email:"owner@example.test"})}},{access:{aud:"aud",getIdentity:async()=>({email:"intruder@example.test"})}}];
  for(const [method,path,body] of routes)for(const ctx of bad){
    const res=await call(worker,env,ctx,path,{method,body});assert.equal(res.status,403,method+" "+path);const t=await res.text();assert.ok(!t.includes(r.id)&&!t.includes("TEST BANK")&&!t.includes("0800000000"),"no data leak");
  }
  assert.equal(sqlite.prepare("SELECT payment_status p FROM orders").get().p,"pending","unauthorised calls changed nothing");
});
test("writes require same-origin (CSRF); wrong method on new routes is 405; unknown order/round patterns 404",async()=>{
  const {env,ctx}=await setupV1();const r=await svc.submitOrder(env,orderInput(),{now:NOW});
  const cross=await worker.fetch(new Request(origin+`/api/admin/orders/${r.id}/status`,{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://evil.test"},body:JSON.stringify({from:"รอโอน",to:"ชำระแล้ว",amount:980})}),env,ctx);
  assert.equal(cross.status,403);
  assert.equal((await call(worker,env,ctx,"/api/admin/rounds",{method:"DELETE"})).status,405);
  assert.equal((await call(worker,env,ctx,"/api/admin/rounds/NOPE/open",{method:"POST",body:{}})).status,404);
  assert.equal((await call(worker,env,ctx,"/api/admin/orders/not-an-order/status",{method:"POST",body:{}})).status,404);
});
test("owner flow over HTTP: list, confirm payment (amount check), user errors are 400 with Thai message, pulse reflects change",async()=>{
  const {env,ctx}=await setupV1();const r=await svc.submitOrder(env,orderInput(),{now:NOW});
  const list=(await j(await call(worker,env,ctx,"/api/admin/orders"))).body.orders;assert.equal(list[0].status,"รอโอน");assert.deepEqual(list[0].moves,["ชำระแล้ว","จ่ายหน้างาน","ยกเลิก"]);
  const p1=(await j(await call(worker,env,ctx,"/api/admin/pulse"))).body.token;
  const bad=await j(await call(worker,env,ctx,`/api/admin/orders/${r.id}/status`,{method:"POST",body:{from:"รอโอน",to:"ชำระแล้ว",amount:1}}));
  assert.equal(bad.status,400);assert.deepEqual([bad.body.ok,bad.body.error],[false,"USER_ERROR"]);assert.match(bad.body.message,/ยอดเงินไม่ตรง/);
  assert.equal((await j(await call(worker,env,ctx,`/api/admin/orders/${r.id}/status`,{method:"POST",body:{from:"รอโอน",to:"ชำระแล้ว",amount:980}}))).body.changed,true);
  assert.notEqual((await j(await call(worker,env,ctx,"/api/admin/pulse"))).body.token,p1);
  const rounds=(await j(await call(worker,env,ctx,"/api/admin/rounds"))).body.rounds;assert.equal(rounds.find(x=>x.id==="ROUND-001").summary.revenue,980);
  assert.equal((await j(await call(worker,env,ctx,"/api/admin/metrics/latency"))).body.latency.order_creation.count,1);
});
test("internal faults are generic 500s (no SQL/stack leak)",async()=>{
  const {env,ctx,sqlite}=await setupV1();sqlite.exec("DROP TABLE notification_queue");
  const r=await call(worker,env,ctx,"/api/admin/notifications");assert.equal(r.status,500);const t=await r.text();assert.ok(!/no such table|notification_queue/.test(t));
});
test("storefront settings: bank/links/live switch editable by owner only; test-key stored hashed and never returned; validated",async()=>{
  const {env,ctx,sqlite}=await setupV1();
  const put=b=>call(worker,env,ctx,"/api/admin/settings/storefront",{method:"PUT",body:b});
  for(const bad of [{...store,bank:{...store.bank,account:"abc"}},{...store,chatUrl:"http://insecure.test"},{...store,liveEnabled:"yes"},{...store,notifyTo:"nope"},{...store,testKey:"short"}])assert.equal((await put(bad)).status,400);
  assert.equal((await put({...store,liveEnabled:false,testKey:"another-test-key"})).status,200);
  const g=(await j(await call(worker,env,ctx,"/api/admin/settings/storefront"))).body.storefront;
  assert.equal(g.liveEnabled,false);assert.equal(g.testKeySet,true);assert.ok(!JSON.stringify(g).includes("another-test-key")&&!("testKeyHash" in g));
  assert.ok(!sqlite.prepare("SELECT value v FROM settings WHERE key='storefront'").get().v.includes("another-test-key"),"stored hashed");
  // storefront immediately reflects the owner's settings (bank from D1, not code)
  assert.equal((await svc.publicConfig(env,NOW)).testOnly,true);
  assert.equal((await put({...store,liveEnabled:true})).status,200);assert.equal((await svc.publicConfig(env,NOW)).testOnly,false);
  const a=sqlite.prepare("SELECT after FROM audit_log WHERE action='storefront.update' ORDER BY id DESC").get().after;assert.ok(!a.includes("000-0-00000-0"),"audit has no bank number");
});
test("orders page + client modules are served, CSP strict, no inline script/style",async()=>{
  const {env,ctx}=await setupV1();
  const p=await call(worker,env,ctx,"/admin/orders/");assert.equal(p.status,200);assert.match(p.headers.get("content-security-policy"),/script-src 'self'/);
  const html=await p.text();assert.ok(!/<script(?![^>]*src=)/.test(html)&&!/\sstyle=/.test(html));
  const js=await call(worker,env,ctx,"/admin/assets/orders-app.mjs");assert.equal(js.headers.get("content-type"),"text/javascript; charset=utf-8");
});
