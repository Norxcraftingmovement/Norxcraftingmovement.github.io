import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/orders-admin-worker.mjs";
import {setup,call,origin} from "./helpers/orders-env.mjs";
const sender={brandName:"NORX TEST",senderName:"ผู้ส่ง ทดสอบ",address:"1 ถนนทดสอบ ตำบลสมมติ อำเภอสมมติ จังหวัดสมมติ 00000",phone:"0800000000"};
const j=async r=>({status:r.status,body:await r.json()});

test("every new route denies a non-owner and anonymous callers (no data leak)",async()=>{
  const {env}=await setup();
  const routes=[["GET","/api/admin/settings/sender"],["PUT","/api/admin/settings/sender",sender],["GET","/api/admin/labels/orders"],["POST","/api/admin/labels/data",{ids:[1]}],
    ["POST","/api/admin/labels/printed",{ids:[1]}],["PUT","/api/admin/orders/2/address",{}],["PUT","/api/admin/orders/2/shipment",{}],
    ["GET","/admin/shipping/"],["GET","/admin/settings/"],["GET","/admin/assets/style.css"],["GET","/admin/assets/sarabun-thai-400-normal.woff2"]];
  for(const [method,path,body] of routes){
    for(const ctx of [{},{access:{aud:"wrong",getIdentity:async()=>({email:"owner@example.test"})}},{access:{aud:"aud",getIdentity:async()=>({email:"intruder@example.test"})}}]){
      const r=await call(worker,env,ctx,path,{method,body});assert.equal(r.status,403,method+" "+path);
      assert.ok(!(await r.text()).includes("TEST-000"));
    }
  }
});
test("unknown assets / html under assets / wrong method / other host",async()=>{
  const {env,ctx}=await setup();
  assert.equal((await call(worker,env,ctx,"/admin/assets/nope.js")).status,404);
  assert.equal((await call(worker,env,ctx,"/admin/assets/shipping.html")).status,404);
  assert.equal((await call(worker,env,ctx,"/admin/assets/../x")).status,404);
  assert.equal((await call(worker,env,ctx,"/admin/shipping/",{method:"DELETE"})).status,405);
  assert.equal((await worker.fetch(new Request("https://evil.test/admin/shipping/"),env,ctx)).status,404);
});
test("pages and assets: owner OK, strict CSP, correct types, Sarabun + logo served",async()=>{
  const {env,ctx}=await setup();
  const p=await call(worker,env,ctx,"/admin/shipping/");assert.equal(p.status,200);
  const csp=p.headers.get("content-security-policy");assert.match(csp,/script-src 'self'/);assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  const html=await p.text();assert.ok(!/<script(?![^>]*src=)/.test(html),"no inline scripts");assert.ok(!/\sstyle=/.test(html),"no inline style attributes");
  const f=await call(worker,env,ctx,"/admin/assets/sarabun-thai-700-normal.woff2");assert.equal(f.headers.get("content-type"),"font/woff2");
  assert.equal(new Uint8Array(await f.arrayBuffer()).slice(0,4).join(),"119,79,70,50"); // wOF2
  const l=await call(worker,env,ctx,"/admin/assets/norx-logo.png");assert.equal(new Uint8Array(await l.arrayBuffer())[1],80);
});
test("sender settings: empty → save → read back; validation; audit logged; real data not in repo seed",async()=>{
  const {env,ctx,sqlite}=await setup();
  assert.equal((await j(await call(worker,env,ctx,"/api/admin/settings/sender"))).body.sender,null);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM settings").get().n,0);
  for(const bad of [{...sender,brandName:""},{...sender,phone:"abc"},{...sender,address:"สั้น"},{...sender,senderName:"x".repeat(200)}])
    assert.equal((await j(await call(worker,env,ctx,"/api/admin/settings/sender",{method:"PUT",body:bad}))).body.error,"INVALID_SENDER");
  assert.equal((await j(await call(worker,env,ctx,"/api/admin/settings/sender",{method:"PUT",body:sender}))).status,200);
  assert.deepEqual((await j(await call(worker,env,ctx,"/api/admin/settings/sender"))).body.sender,sender);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='sender.update'").get().n,1);
});
test("writes need same-origin + JSON (CSRF) and reject oversized/garbage bodies",async()=>{
  const {env,ctx}=await setup();
  const post=(headers,body="{}")=>worker.fetch(new Request(origin+"/api/admin/labels/printed",{method:"POST",headers,body}),env,ctx);
  assert.equal((await post({"Content-Type":"application/json"})).status,403);
  assert.equal((await post({"Content-Type":"application/json",Origin:"https://evil.test"})).status,403);
  assert.equal((await post({"Content-Type":"text/plain",Origin:origin},'{"ids":[2]}')).status,400);
  assert.equal((await post({"Content-Type":"application/json",Origin:origin},"not json")).status,400);
  assert.equal((await post({"Content-Type":"application/json",Origin:origin},JSON.stringify({ids:[1],pad:"x".repeat(70000)}))).status,400);
});
test("label orders lists only shipping orders; label data returns long Thai address intact, sender, item count",async()=>{
  const {env,ctx}=await setup();
  const list=(await j(await call(worker,env,ctx,"/api/admin/labels/orders"))).body.orders;
  assert.deepEqual(list.map(o=>o.orderNo).sort(),["TEST-0001","TEST-0002","TEST-0003"]);
  assert.ok(list.every(o=>o.isTest===1));
  assert.equal((await j(await call(worker,env,ctx,"/api/admin/labels/orders?q=0002"))).body.orders.length,1);
  assert.equal((await j(await call(worker,env,ctx,"/api/admin/labels/orders?q=%25"))).body.orders.length,0); // LIKE wildcard escaped
  await call(worker,env,ctx,"/api/admin/settings/sender",{method:"PUT",body:sender});
  const r=(await j(await call(worker,env,ctx,"/api/admin/labels/data",{method:"POST",body:{ids:[3,2,4,999]}}))).body;
  assert.deepEqual(r.labels.map(l=>l.orderNo),["TEST-0003","TEST-0002"]);assert.deepEqual(r.missing,[4,999]);
  assert.equal(r.labels[0].itemCount,2);assert.equal(r.labels[0].postalCode,"10110");assert.ok(r.labels[0].address.length>200);assert.deepEqual(r.sender,sender);
  for(const bad of [{ids:[]},{ids:["1"]},{ids:Array.from({length:51},(_,i)=>i+1)},{ids:[-1]},{}])assert.equal((await call(worker,env,ctx,"/api/admin/labels/data",{method:"POST",body:bad})).status,400);
});
test("printing / marking printed NEVER changes order status; reprint increments counter",async()=>{
  const {env,ctx,sqlite}=await setup();
  const snap=()=>JSON.stringify(sqlite.prepare("SELECT id,payment_status,fulfillment_status,updated_at FROM orders ORDER BY id").all());
  const hist=()=>sqlite.prepare("SELECT COUNT(*) n FROM order_status_history").get().n,before=snap(),h0=hist();
  for(let i=0;i<2;i++)assert.equal((await call(worker,env,ctx,"/api/admin/labels/printed",{method:"POST",body:{ids:[2,3]}})).status,200);
  assert.equal(snap(),before);assert.equal(hist(),h0);
  assert.deepEqual(sqlite.prepare("SELECT order_id,label_printed_count c FROM shipments ORDER BY order_id").all().map(r=>[r.order_id,r.c]),[[2,2],[3,2]]);
  assert.equal(sqlite.prepare("SELECT fulfillment_status s FROM orders WHERE id=2").get().s,"ready_ship"); // still NOT shipped
  assert.equal((await j(await call(worker,env,ctx,"/api/admin/labels/orders?printed=1"))).body.orders.length,2);
});
test("edit address: validates, derives postal code, audits before/after; 404 for unknown",async()=>{
  const {env,ctx,sqlite}=await setup();
  const put=(id,b)=>call(worker,env,ctx,`/api/admin/orders/${id}/address`,{method:"PUT",body:b});
  const ok={recipient:"ทดสอบ แก้ไข",phone:"080-000-0009",address:"5/5 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 50000"};
  for(const bad of [{...ok,phone:"123"},{...ok,address:"สั้นไป 50000"},{...ok,address:"ที่อยู่ยาวพอแต่ไม่มีรหัสไปรษณีย์เลย"},{...ok,recipient:""}])assert.equal((await put(2,bad)).status,400);
  assert.equal((await put(999,ok)).status,404);
  assert.equal((await put(2,ok)).status,200);
  const row=sqlite.prepare("SELECT recipient,phone,postal_code,edited_at FROM shipping_addresses WHERE order_id=2").get();
  assert.equal(row.phone,"0800000009");assert.equal(row.postal_code,"50000");assert.ok(row.edited_at);
  const a=sqlite.prepare("SELECT before,after FROM audit_log WHERE action='address.update'").get();assert.match(a.before,/57000/);assert.match(a.after,/50000/);
});
test("shipment: provider/tracking/date saved without touching status; validation",async()=>{
  const {env,ctx,sqlite}=await setup();
  const put=(b)=>call(worker,env,ctx,"/api/admin/orders/2/shipment",{method:"PUT",body:b});
  for(const bad of [{trackingNo:"AB 12"},{trackingNo:"x".repeat(41)},{shippedAt:"27/11/2026"},{provider:"x".repeat(41)}])assert.equal((await put(bad)).status,400);
  assert.equal((await put({provider:"TEST Express",trackingNo:"TST123-9",shippedAt:"2026-11-27"})).status,200);
  assert.deepEqual({...sqlite.prepare("SELECT provider,tracking_no,shipped_at FROM shipments WHERE order_id=2").get()},{provider:"TEST Express",tracking_no:"TST123-9",shipped_at:"2026-11-27"});
  assert.equal(sqlite.prepare("SELECT fulfillment_status s FROM orders WHERE id=2").get().s,"ready_ship");
  assert.equal((await call(worker,env,ctx,"/api/admin/orders/999/shipment",{method:"PUT",body:{}})).status,404);
});
test("schema additions: on-site payment, completed status, notification queue, latency log",async()=>{
  const {sqlite}=await setup();
  assert.equal(sqlite.prepare("SELECT payment_timing t FROM orders WHERE order_no='TEST-0005'").get().t,"on_site");
  sqlite.exec("UPDATE orders SET fulfillment_status='completed',received_at='2026-11-27' WHERE id=5");
  assert.throws(()=>sqlite.exec("UPDATE orders SET payment_timing='cod' WHERE id=5"));
  sqlite.exec("INSERT INTO notification_queue(order_id,channel,template,payload) VALUES (5,'email','order_received','{}')");
  assert.throws(()=>sqlite.exec("INSERT INTO notification_queue(channel,template,payload) VALUES ('email','x','not json')"));
  sqlite.exec("INSERT INTO notification_failures(queue_id,attempt,error) VALUES (1,1,'timeout')");
  sqlite.exec("INSERT INTO latency_log(kind,ref,ms) VALUES ('order_creation','TEST-0005',120),('notification','1',900)");
  assert.throws(()=>sqlite.exec("INSERT INTO latency_log(kind,ms) VALUES ('other',1)"));
});
