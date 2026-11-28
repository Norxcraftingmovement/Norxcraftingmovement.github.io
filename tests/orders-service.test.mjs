import test from "node:test";
import assert from "node:assert/strict";
import * as svc from "../src/orders-service.mjs";
import * as core from "../src/orders-core.mjs";
import {setupV1,orderInput,NOW,T0,DAY} from "./helpers/orders-env.mjs";
const count=(db,t,w="1")=>db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${w}`).get().n;
const rejects=(p,re)=>assert.rejects(p,e=>e instanceof core.UserError&&re.test(e.message));

test("create order: V1 receipt shape, id format, server-side totals, snapshots, history, outbox — all in one atomic write",async()=>{
  const {env,sqlite}=await setupV1();
  const r=await svc.submitOrder(env,orderInput(),{now:NOW});
  assert.match(r.id,/^NORX-[0-9A-F]{8}$/);
  assert.deepEqual(Object.keys(r),["ok","id","name","roundId","items","subtotal","shipping","total","paymentDue","status"]);
  assert.equal(r.ok,true);assert.equal(r.total,980);assert.equal(r.shipping,0);assert.equal(r.status,"รอโอน");assert.equal(r.roundId,"ROUND-001");
  assert.deepEqual(Object.keys(r.items[0]),["product","fit","sleeve","size","qty","name","fitName","unitPrice","lineTotal"]);
  const o=sqlite.prepare("SELECT * FROM orders").get();
  assert.equal(o.payment_status,"pending");assert.equal(o.fulfillment_status,"received");assert.equal(o.is_test,0);assert.equal(o.source,"web");
  const it=sqlite.prepare("SELECT * FROM order_items").get();
  assert.deepEqual([it.product_name,it.fit_name,it.unit_price_baht,it.line_total_baht],["HOME TERRAIN EDITION","ทรง Boxy",490,980]);
  assert.equal(count(sqlite,"order_status_history"),1);
  const q=sqlite.prepare("SELECT * FROM notification_queue").get();assert.equal(q.status,"queued");assert.equal(q.template,"order_alert");
  assert.equal(JSON.parse(q.payload).orderNo,r.id);assert.ok(!JSON.parse(q.payload).address,"no address in alert");
  assert.equal(count(sqlite,"shipping_addresses"),0);
  assert.equal(count(sqlite,"latency_log","kind='order_creation'"),1);
});
test("shipping is charged once per order (not per item); pickup/event are free; address stored only for ship",async()=>{
  const {env,sqlite}=await setupV1();
  const items=[{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:1},{product:"drop03",fit:"boxy",sleeve:"long",size:"L",qty:1},{product:"drop02",fit:"regular",sleeve:"long",size:"XXS",qty:3}];
  const ship=await svc.submitOrder(env,orderInput({delivery:"ship",address:"99/9 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 50000",items,expectedTotal:490+590+3*590+50}),{now:NOW});
  assert.equal(ship.subtotal,490+590+1770);assert.equal(ship.shipping,50);assert.equal(ship.total,ship.subtotal+50);
  assert.equal(sqlite.prepare("SELECT postal_code p FROM shipping_addresses").get().p,"50000");
  for(const d of ["city","event"]){const r=await svc.submitOrder(env,orderInput({delivery:d,address:"ignored 99999",expectedTotal:980}),{now:NOW});assert.equal(r.shipping,0);}
  assert.equal(count(sqlite,"shipping_addresses"),1);
});
test("duplicate lines merge; same product different size stays separate; qty cap 99",async()=>{
  const {env,sqlite}=await setupV1();
  const r=await svc.submitOrder(env,orderInput({items:[{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:1},{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:2},{product:"drop03",fit:"boxy",sleeve:"short",size:"L",qty:1}],expectedTotal:1960}),{now:NOW});
  assert.equal(r.items.length,2);assert.equal(r.items.find(i=>i.size==="M").qty,3);assert.equal(count(sqlite,"order_items"),2);
  await rejects(svc.submitOrder(env,orderInput({items:[{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:60},{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:60}]}),{now:NOW}),/เกิน 99/);
});
test("idempotency: same requestId + same payload → same order, one row, one alert; different payload → rejected",async()=>{
  const {env,sqlite}=await setupV1();const input=orderInput();
  const a=await svc.submitOrder(env,input,{now:NOW}),b=await svc.submitOrder(env,{...input},{now:NOW+5000});
  assert.deepEqual(b,a);assert.equal(count(sqlite,"orders"),1);assert.equal(count(sqlite,"order_items"),1);assert.equal(count(sqlite,"notification_queue"),1);
  await rejects(svc.submitOrder(env,{...input,name:"คนอื่น ทดสอบ"},{now:NOW}),/รหัสคำขอซ้ำกับข้อมูลที่ต่างกัน/);
  // replay is accepted even after the round closed (V1: fingerprint match short-circuits before quoting)
  const late=await svc.submitOrder(env,input,{now:T0+9*DAY});assert.equal(late.id,a.id);
});
test("idempotency under concurrency: 12 parallel submissions of one request create exactly one order",async()=>{
  const {env,sqlite}=await setupV1();const input=orderInput();
  const rs=await Promise.all(Array.from({length:12},()=>svc.submitOrder(env,{...input},{now:NOW})));
  assert.equal(new Set(rs.map(r=>r.id)).size,1);assert.equal(count(sqlite,"orders"),1);assert.equal(count(sqlite,"order_items"),1);assert.equal(count(sqlite,"notification_queue"),1);
  // 12 distinct requests all succeed with distinct ids
  const many=await Promise.all(Array.from({length:12},()=>svc.submitOrder(env,orderInput(),{now:NOW})));
  assert.equal(new Set(many.map(r=>r.id)).size,12);assert.equal(count(sqlite,"orders"),13);
});
test("server-side price validation: wrong expectedTotal rejected, client cannot inject prices, nothing written",async()=>{
  const {env,sqlite}=await setupV1();
  for(const bad of [979,981,0,undefined,"980",null])await rejects(svc.submitOrder(env,orderInput({expectedTotal:bad}),{now:NOW}),/ยอดเงินเปลี่ยน/);
  const tampered=orderInput();tampered.items[0].unitPrice=1;tampered.items[0].price=1;tampered.total=1;
  const r=await svc.submitOrder(env,tampered,{now:NOW});assert.equal(r.total,980);
  assert.equal(count(sqlite,"orders"),1);
  // price edited by owner → old expectedTotal is refused, new price accepted
  sqlite.exec("UPDATE product_variants SET price_baht=500 WHERE product_id=1 AND sleeve='short'");
  await rejects(svc.submitOrder(env,orderInput(),{now:NOW}),/ยอดเงินเปลี่ยน/);
  assert.equal((await svc.submitOrder(env,orderInput({expectedTotal:1000}),{now:NOW})).total,1000);
  // order keeps the snapshot even after a later price change
  sqlite.exec("UPDATE product_variants SET price_baht=999 WHERE product_id=1");
  const row=sqlite.prepare("SELECT total_baht t FROM orders ORDER BY id DESC LIMIT 1").get();assert.equal(row.t,1000);
});
test("price unavailable / zero in catalog is refused (V1: 'ราคาไม่พร้อมใช้งาน') and unknown items rejected",async()=>{
  const {env}=await setupV1();
  const bad=[{product:"nope",fit:"boxy",sleeve:"short",size:"M",qty:1},{product:"drop03",fit:"regular",sleeve:"short",size:"M",qty:1},{product:"drop03",fit:"boxy",sleeve:"short",size:"XXS",qty:1},{product:"drop03",fit:"boxy",sleeve:"mid",size:"M",qty:1},{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:0}];
  for(const i of bad)await rejects(svc.submitOrder(env,orderInput({items:[i]}),{now:NOW}),/รุ่น ทรง ไซส์ หรือจำนวนไม่ถูกต้อง/);
});
test("rounds: closed/not yet open/other round/unoffered delivery are refused like V1",async()=>{
  const {env,sqlite}=await setupV1();
  await rejects(svc.submitOrder(env,orderInput(),{now:T0-1}),/ปิดรับแล้ว หรือมีการเปลี่ยนรอบ/);          // before open
  await rejects(svc.submitOrder(env,orderInput(),{now:T0+6*DAY+86340e3+1}),/ปิดรับแล้ว/);                    // 1ms after close
  assert.ok((await svc.submitOrder(env,orderInput(),{now:T0})).ok);                                           // exactly at open
  assert.ok((await svc.submitOrder(env,orderInput(),{now:T0+6*DAY+86340e3})).ok);                              // exactly at close
  await rejects(svc.submitOrder(env,orderInput({roundId:"ROUND-002"}),{now:NOW}),/ปิดรับแล้ว หรือมีการเปลี่ยนรอบ/); // not the current round
  const r2=await svc.submitOrder(env,orderInput({roundId:"ROUND-002",expectedTotal:980}),{now:T0+8*DAY});assert.equal(r2.roundId,"ROUND-002");
  await rejects(svc.submitOrder(env,orderInput({roundId:"ROUND-002",delivery:"event"}),{now:T0+8*DAY}),/วิธีรับสินค้านี้ไม่เปิดในรอบนี้/);
  sqlite.exec("UPDATE rounds SET status='closed' WHERE code='ROUND-001'");
  await rejects(svc.submitOrder(env,orderInput(),{now:NOW}),/ปิดรับแล้ว/);
});
test("ATOMIC: round closes or price changes between quote and commit → no order, no items, no alert",async()=>{
  for(const sabotage of ["UPDATE rounds SET status='closed' WHERE code='ROUND-001'","UPDATE product_variants SET price_baht=1 WHERE product_id=1 AND sleeve='short'","UPDATE rounds SET shipping_baht=99 WHERE code='ROUND-001'"]){
    const {env,sqlite}=await setupV1();const real=env.ORDERS_DB.batch;
    env.ORDERS_DB.batch=async(l)=>{sqlite.exec(sabotage);return real(l)};
    const ship=sabotage.includes("shipping");
    await rejects(svc.submitOrder(env,orderInput(ship?{delivery:"ship",address:"99/9 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 50000",expectedTotal:1030}:{}),{now:NOW}),/เปลี่ยน กรุณาโหลดหน้าใหม่/);
    for(const t of ["orders","order_items","shipping_addresses","order_status_history","notification_queue"])assert.equal(count(sqlite,t),0,t+" after "+sabotage);
  }
});
test("ATOMIC: a failure while writing the outbox rolls back the whole order (no half-written orders)",async()=>{
  const {env,sqlite}=await setupV1();
  sqlite.exec("CREATE TRIGGER boom BEFORE INSERT ON notification_queue BEGIN SELECT RAISE(ABORT,'boom'); END");
  await assert.rejects(svc.submitOrder(env,orderInput(),{now:NOW}),/boom/);
  for(const t of ["orders","order_items","order_status_history","notification_queue"])assert.equal(count(sqlite,t),0,t);
  sqlite.exec("DROP TRIGGER boom");
  assert.ok((await svc.submitOrder(env,orderInput(),{now:NOW})).ok);
});
test("order creation does not wait for email: no provider configured or a failing provider cannot affect it",async()=>{
  const {env,sqlite}=await setupV1();let called=0;
  env.NOTIFY_WEBHOOK_URL="https://mail.invalid/hook";const f=globalThis.fetch;globalThis.fetch=async()=>{called++;throw new Error("network down")};
  try{const r=await svc.submitOrder(env,orderInput(),{now:NOW});assert.ok(r.ok);assert.equal(called,0,"submit never touches the mail provider");}finally{globalThis.fetch=f}
  assert.equal(sqlite.prepare("SELECT status s FROM notification_queue").get().s,"queued");
});
test("test mode (not live): needs the test key; orders are flagged is_test and noted; live mode ignores key",async()=>{
  const {env,sqlite}=await setupV1({live:false});
  await rejects(svc.submitOrder(env,orderInput(),{now:NOW}),/โหมดทดสอบ/);
  await rejects(svc.submitOrder(env,{...orderInput(),testKey:"wrong"},{now:NOW}),/โหมดทดสอบ/);
  const r=await svc.submitOrder(env,{...orderInput(),testKey:"test-key-12345"},{now:NOW});assert.ok(r.ok);
  const o=sqlite.prepare("SELECT is_test,note FROM orders").get();assert.deepEqual([o.is_test,o.note],[1,"ทดสอบ"]);
  const live=await setupV1();assert.ok((await svc.submitOrder(live.env,{...orderInput(),testKey:"x"},{now:NOW})).ok);
});
test("public config: V1 shape the storefront (shop.js) reads; no secrets (test key hash) leaked",async()=>{
  const {env}=await setupV1();
  const c=await svc.publicConfig(env,NOW);
  for(const k of ["ok","testOnly","rolling","serverNow","bank","chatUrl","pageUrl","eventName","products","round","nextRound"])assert.ok(k in c,k);
  assert.equal(c.round.id,"ROUND-001");assert.equal(c.nextRound.id,"ROUND-002");assert.deepEqual(c.products.map(p=>p.id),["drop03","drop02"]);
  assert.deepEqual(c.products[0].prices,{short:490,long:590});assert.deepEqual(c.products[0].sizes,["XS","S","M","L","XL","2XL"]);
  assert.deepEqual(Object.keys(c.round).sort(),["closesAt","deliveries","eventName","id","name","opensAt","paymentDue","readyText","shipping"]); // eventName: added key (per-round event name; "" = use cfg.eventName), the V1 keys are unchanged
  assert.ok(!JSON.stringify(c).includes("testKeyHash"));
  const live=await setupV1({live:false});assert.equal((await svc.publicConfig(live.env,NOW)).testOnly,true);
  const empty=await setupV1();empty.sqlite.exec("DELETE FROM settings");assert.equal((await svc.publicConfig(empty.env,NOW)).ok,false);
});
test("weekly rolling rounds: successor created once (even under concurrency), V1 naming/dates, 'event' dropped",async()=>{
  const {env,sqlite}=await setupV1({rolling:true});
  const after=T0+20*DAY; // both seeded rounds closed long ago
  const cs=await Promise.all(Array.from({length:8},()=>svc.publicConfig(env,after)));
  assert.equal(count(sqlite,"rounds"),3);
  const r=sqlite.prepare("SELECT * FROM rounds WHERE code='ROUND-003'").get();
  assert.equal(r.name,"รอบ 3");assert.equal(r.status,"open");assert.equal(r.deliveries,'["city","ship"]');assert.equal(r.successor_of,2);
  const expect=core.weeklySuccessor({name:"รอบ 2",closesAt:new Date(T0+13*DAY+86340e3).toISOString(),paymentDue:new Date(T0+14*DAY).toISOString(),shipping:60,supplierShipping:80,deliveries:["city","ship"]});
  assert.equal(r.opens_at,new Date(Date.parse(expect.opensAt)).toISOString());assert.equal(r.closes_at,new Date(Date.parse(expect.closesAt)).toISOString());
  assert.equal(r.ready_text,expect.readyText);assert.ok(cs.every(c=>c.ok));
  // not rolling → nothing created
  const off=await setupV1({rolling:false});await svc.publicConfig(off.env,after);assert.equal(count(off.sqlite,"rounds"),2);
});
test("round codes keep V1 sequence (ROUND-NNN) when created from admin; overlap/validation rules",async()=>{
  const {env,sqlite}=await setupV1();
  const mk=(o={})=>({name:"รอบทดสอบ 3",opensAt:"2026-12-15T00:00",closesAt:"2026-12-20T23:59",paymentDue:"2026-12-21T10:00",deliveries:["city","ship"],shipping:50,supplierShipping:80,...o});
  const r=await svc.saveRound(env,"admin",mk());assert.equal(r.id,"ROUND-003");
  assert.equal(sqlite.prepare("SELECT opens_at o FROM rounds WHERE code='ROUND-003'").get().o,"2026-12-14T17:00:00.000Z"); // Bangkok -> UTC
  for(const [bad,re] of [[{name:"x"},/ตั้งชื่อรอบ/],[{closesAt:"2026-12-14T00:00"},/วันปิดรับต้องหลังวันเปิดรับ/],[{paymentDue:"2026-12-20T00:00"},/กำหนดโอนต้องไม่ก่อน/],[{deliveries:[]},/อย่างน้อย 1 แบบ/],[{shipping:1001},/ค่าส่งไม่ถูกต้อง/],[{opensAt:"garbage"},/รูปแบบวันเวลา/]])
    await rejects(svc.saveRound(env,"admin",mk(bad)),re);
  await svc.openRound(env,"admin","ROUND-003",NOW);
  const r4=await svc.saveRound(env,"admin",mk({name:"ทับซ้อน",opensAt:"2026-12-16T00:00"}));
  await rejects(svc.openRound(env,"admin",r4.id,NOW),/ซ้อนกับ/);
  await svc.closeRound(env,"admin","ROUND-003");await rejects(svc.closeRound(env,"admin","ROUND-003"),/ไม่ได้เปิดรับอยู่/);
});
