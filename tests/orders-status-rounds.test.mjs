import test from "node:test";
import assert from "node:assert/strict";
import * as svc from "../src/orders-service.mjs";
import * as core from "../src/orders-core.mjs";
import {setupV1,orderInput,NOW,T0,DAY} from "./helpers/orders-env.mjs";
const S=core.STATUS,CLOSED=T0+8*DAY;
const rejects=(p,re)=>assert.rejects(p,e=>e instanceof core.UserError&&re.test(e.message));
const mk=async(env,o={},amount)=>svc.submitOrder(env,orderInput({expectedTotal:amount??980,...o}),{now:NOW});
const st=(sqlite,id)=>sqlite.prepare("SELECT payment_status p,fulfillment_status f FROM orders WHERE order_no=?").get(id);

test("status flow รอโอน→ชำระแล้ว (amount must match) records payment, history, audit, paid_at",async()=>{
  const {env,sqlite}=await setupV1();const r=await mk(env);
  await rejects(svc.changeStatus(env,"adm",{orderNo:r.id,from:S.PENDING,to:S.PAID,amount:979,now:NOW}),/ยอดเงินไม่ตรง/);
  assert.deepEqual({...st(sqlite,r.id)},{p:"pending",f:"received"});
  assert.deepEqual(await svc.changeStatus(env,"adm",{orderNo:r.id,from:S.PENDING,to:S.PAID,amount:980,now:NOW}),{changed:true,status:S.PAID});
  assert.deepEqual({...st(sqlite,r.id)},{p:"confirmed",f:"received"});
  const pay=sqlite.prepare("SELECT amount_baht a,method m,status s FROM payments").get();assert.deepEqual({...pay},{a:980,m:"bank_transfer",s:"confirmed"});
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM order_status_history WHERE to_status=?").get(S.PAID).n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='order.status'").get().n,1);
  assert.ok(sqlite.prepare("SELECT paid_at p FROM orders").get().p);
  assert.deepEqual(await svc.changeStatus(env,"adm",{orderNo:r.id,from:S.PAID,to:S.PAID,now:NOW}),{changed:false}); // V1: same status = no-op
});
test("stale admin view and illegal moves are refused; concurrent identical clicks apply once",async()=>{
  const {env,sqlite}=await setupV1();const r=await mk(env);
  await rejects(svc.changeStatus(env,"a",{orderNo:r.id,from:S.PENDING,to:S.SENT,now:NOW}),/ไม่ได้/);
  await svc.changeStatus(env,"a",{orderNo:r.id,from:S.PENDING,to:S.PAID,amount:980,now:NOW});
  await rejects(svc.changeStatus(env,"b",{orderNo:r.id,from:S.PENDING,to:S.CANCEL,now:NOW}),/ถูกเปลี่ยนเป็น "ชำระแล้ว" แล้ว/);
  const r2=await mk(env);
  const res=await Promise.allSettled([1,2,3,4].map(i=>svc.changeStatus(env,"u"+i,{orderNo:r2.id,from:S.PENDING,to:S.PAID,amount:980,now:NOW})));
  assert.equal(res.filter(x=>x.status==="fulfilled"&&x.value.changed).length,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payments").get().n,2,"one payment per paid order, none duplicated");
  await rejects(svc.changeStatus(env,"a",{orderNo:"NORX-NOPE0000",from:S.PENDING,to:S.PAID,now:NOW}),/ไม่พบออเดอร์/);
});
test("จ่ายหน้างาน is NOT paid: no payment/paid_at, counted in production, excluded from revenue; later becomes paid on delivery",async()=>{
  const {env,sqlite}=await setupV1();
  const a=await mk(env,{delivery:"event"}),b=await mk(env,{items:[{product:"drop02",fit:"regular",sleeve:"long",size:"M",qty:1}]},590);
  await svc.changeStatus(env,"adm",{orderNo:a.id,from:S.PENDING,to:S.LATER,now:NOW});
  await svc.changeStatus(env,"adm",{orderNo:b.id,from:S.PENDING,to:S.PAID,amount:590,now:NOW});
  assert.deepEqual({...st(sqlite,a.id)},{p:"deferred_on_site",f:"received"});
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payments WHERE order_id=(SELECT id FROM orders WHERE order_no=?)").get(a.id).n,0);
  assert.equal(sqlite.prepare("SELECT paid_at p FROM orders WHERE order_no=?").get(a.id).p,null);
  const s=(await svc.roundsWithSummary(env,NOW)).rounds.find(r=>r.id==="ROUND-001").summary;
  assert.equal(s.revenue,590,"revenue excludes on-site");assert.equal(s.laterOrders,1);assert.equal(s.laterAmount,980);assert.equal(s.pieces,3,"production counts on-site pieces too");
  assert.equal(s.paidOrders,1);assert.equal(s.byStatus[S.LATER],1);
  // cut-off: paid → ส่งร้านแล้ว; on-site stays จ่ายหน้างาน; then delivered+collected → ส่งมอบแล้ว (paid)
  await svc.closeRound(env,"adm","ROUND-001");
  const sent=await svc.sendToShop(env,"adm","ROUND-001",3,CLOSED);assert.deepEqual(sent,{sent:1,pieces:3});
  assert.deepEqual({...st(sqlite,b.id)},{p:"confirmed",f:"in_production"});assert.deepEqual({...st(sqlite,a.id)},{p:"deferred_on_site",f:"received"});
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM order_items WHERE production_status='batched'").get().n,2,"both orders' items batched");
  await svc.changeStatus(env,"adm",{orderNo:a.id,from:S.LATER,to:S.DONE,amount:980,now:CLOSED});
  assert.deepEqual({...st(sqlite,a.id)},{p:"confirmed",f:"completed"});
  assert.equal(sqlite.prepare("SELECT method m FROM payments WHERE order_id=(SELECT id FROM orders WHERE order_no=?)").get(a.id).m,"on_site");
  assert.ok(sqlite.prepare("SELECT received_at r FROM orders WHERE order_no=?").get(a.id).r);
  assert.equal((await svc.roundsWithSummary(env,CLOSED)).rounds[0].summary.revenue,590+980);
});
test("V1 rule: after cut-off ('sent') pending/paid/cancel changes are blocked; on-site→delivered before cut-off blocked",async()=>{
  const {env}=await setupV1();
  const a=await mk(env),b=await mk(env,{delivery:"event"});
  await svc.changeStatus(env,"x",{orderNo:b.id,from:S.PENDING,to:S.LATER,now:NOW});
  await rejects(svc.changeStatus(env,"x",{orderNo:b.id,from:S.LATER,to:S.DONE,amount:980,now:NOW}),/ยังไม่ได้ส่งร้าน/);
  await svc.changeStatus(env,"x",{orderNo:a.id,from:S.PENDING,to:S.PAID,amount:980,now:NOW});await svc.closeRound(env,"x","ROUND-001");
  await svc.sendToShop(env,"x","ROUND-001",4,CLOSED);
  await rejects(svc.changeStatus(env,"x",{orderNo:a.id,from:S.SENT,to:S.PENDING,now:CLOSED}),/ไม่ได้/);
  await rejects(svc.changeStatus(env,"x",{orderNo:b.id,from:S.LATER,to:S.CANCEL,now:CLOSED}),/รอบนี้ส่งร้านแล้ว/);
  assert.deepEqual(await svc.changeStatus(env,"x",{orderNo:a.id,from:S.SENT,to:S.DONE,now:CLOSED}),{changed:true,status:S.DONE});
});
test("cutoff preconditions: must be closed, no unpaid, pieces match; whole thing is atomic",async()=>{
  const {env,sqlite}=await setupV1();
  const a=await mk(env),b=await mk(env);
  await svc.changeStatus(env,"x",{orderNo:a.id,from:S.PENDING,to:S.PAID,amount:980,now:NOW});
  await rejects(svc.sendToShop(env,"x","ROUND-001",2,NOW),/ต้องปิดรับรอบนี้ก่อนตัดยอด/);
  await rejects(svc.sendToShop(env,"x","ROUND-001",2,CLOSED),/ยังมีออเดอร์รอโอน 1 รายการ/);
  await rejects(svc.cancelUnpaid(env,"x","ROUND-001",1,NOW),/ต้องปิดรับรอบนี้ก่อน/);
  await rejects(svc.cancelUnpaid(env,"x","ROUND-001",5,CLOSED),/จำนวนออเดอร์รอโอนเปลี่ยนไป/);
  assert.deepEqual({...st(sqlite,b.id)},{p:"pending",f:"received"});
  assert.deepEqual(await svc.cancelUnpaid(env,"x","ROUND-001",1,CLOSED),{cancelled:1});
  assert.deepEqual({...st(sqlite,b.id)},{p:"cancelled",f:"cancelled"});assert.equal(core.toLegacy("cancelled","cancelled"),S.CANCEL);
  await rejects(svc.sendToShop(env,"x","ROUND-001",3,CLOSED),/ยอดตัวเปลี่ยนไป/);
  // sabotage: an order flips to pending between the checks and the write → nothing is sent
  const c=await svc.submitOrder(env,orderInput({expectedTotal:980}),{now:NOW});
  const real=env.ORDERS_DB.batch;env.ORDERS_DB.batch=async l=>{sqlite.exec("UPDATE orders SET payment_status='pending' WHERE order_no='"+a.id+"'");return real(l)};
  await rejects(svc.sendToShop(env,"x","ROUND-001",2,CLOSED),/ยังมีออเดอร์รอโอน|เปลี่ยนไป/);
  env.ORDERS_DB.batch=real;
  assert.equal(sqlite.prepare("SELECT status s FROM rounds WHERE code='ROUND-001'").get().s,"open");
  assert.ok(!sqlite.prepare("SELECT 1 x FROM orders WHERE fulfillment_status='in_production'").get(),"no order was moved");
});
test("production summary matches V1 core on real DB rows (by product/fit/sleeve/size, ordered like the catalog)",async()=>{
  const {env,sqlite}=await setupV1();
  const it=(product,fit,sleeve,size,qty)=>({product,fit,sleeve,size,qty});
  const A=await mk(env,{items:[it("drop02","regular","long","XXS",2),it("drop03","boxy","short","XL",1)]},2*590+490);
  const B=await mk(env,{items:[it("drop03","boxy","short","XS",3),it("drop03","boxy","long","XS",1)]},3*490+590);
  for(const [o,amt] of [[A,2*590+490],[B,3*490+590]])await svc.changeStatus(env,"x",{orderNo:o.id,from:S.PENDING,to:S.PAID,amount:amt,now:NOW});
  const out=(await svc.roundsWithSummary(env,NOW)).rounds.find(r=>r.id==="ROUND-001");
  assert.deepEqual(out.summary.items.map(i=>[i.product,i.sleeve,i.size,i.qty]),[["drop03","short","XS",3],["drop03","short","XL",1],["drop03","long","XS",1],["drop02","long","XXS",2]]);
  assert.equal(out.summary.pieces,7);assert.equal(out.summary.revenue,2*590+490+3*490+590);
  assert.match(out.shopText,/ยอดผลิตรวม 7 ตัว/);assert.match(out.shopText,/HOME TERRAIN EDITION · ทรง Boxy · แขนสั้น = 4 ตัว\n {2}XS 3 \/ XL 1/);
  assert.equal(out.phase,"accepting");
});
test("order list: search/filter by status and round, wildcard-safe; pulse token changes on any change",async()=>{
  const {env}=await setupV1();
  const a=await mk(env,{name:"สมชาย ทดสอบ"}),b=await mk(env,{name:"สมหญิง ทดสอบ"});
  assert.equal((await svc.listOrders(env,{q:"สมชาย"})).length,1);assert.equal((await svc.listOrders(env,{q:"%"})).length,0);
  assert.equal((await svc.listOrders(env,{status:S.PENDING})).length,2);assert.equal((await svc.listOrders(env,{round:"ROUND-002"})).length,0);
  const p1=await svc.pulse(env);assert.equal(p1.orders,2);assert.deepEqual(p1.notifications,{queued:2,failed:0,dead:0});
  assert.equal((await svc.pulse(env)).token,p1.token,"stable while nothing changes");
  await svc.changeStatus(env,"x",{orderNo:a.id,from:S.PENDING,to:S.PAID,amount:980,now:NOW});
  const p2=await svc.pulse(env);assert.notEqual(p2.token,p1.token);
  await mk(env);assert.notEqual((await svc.pulse(env)).token,p2.token);
});
