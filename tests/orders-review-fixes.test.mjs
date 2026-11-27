import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/orders-admin-worker.mjs";
import * as svc from "../src/orders-service.mjs";
import * as core from "../src/orders-core.mjs";
import * as imp from "../src/v1-import.mjs";
import {setupV1,orderInput,call,NOW,T0,DAY} from "./helpers/orders-env.mjs";
const S=core.STATUS,CLOSED=T0+8*DAY;
const mk=(env,o={},amount)=>svc.submitOrder(env,orderInput({expectedTotal:amount??980,...o}),{now:NOW});
const pays=(sqlite,no)=>sqlite.prepare("SELECT status s,amount_baht a,method m,void_reason v FROM payments WHERE order_id=(SELECT id FROM orders WHERE order_no=?) ORDER BY id").all(no).map(r=>({...r}));
const mv=(env,no,from,to,amount,now=NOW)=>svc.changeStatus(env,"adm",{orderNo:no,from,to,amount,now});

// ---------- P0-1 payment integrity ----------
test("P0: Confirm → Undo → Confirm never leaves two confirmed payments (undo voids, re-confirm records one new)",async()=>{
  const {env,sqlite}=await setupV1();const r=await mk(env);
  for(let cycle=1;cycle<=3;cycle++){
    await mv(env,r.id,S.PENDING,S.PAID,980);
    assert.equal(pays(sqlite,r.id).filter(p=>p.s==="confirmed").length,1,"cycle "+cycle+" confirm");
    await mv(env,r.id,S.PAID,S.PENDING);
    assert.equal(pays(sqlite,r.id).filter(p=>p.s==="confirmed").length,0,"cycle "+cycle+" undo");
  }
  await mv(env,r.id,S.PENDING,S.PAID,980);
  const p=pays(sqlite,r.id);assert.equal(p.length,4);assert.equal(p.filter(x=>x.s==="confirmed").length,1);assert.equal(p.filter(x=>x.s==="void").length,3);
  assert.match(p.find(x=>x.s==="void").v,/ชำระแล้ว → รอโอน/);
  assert.deepEqual(await svc.paymentIntegrity(env),[]);
  assert.equal((await svc.roundsWithSummary(env,NOW)).rounds[0].summary.revenue,980,"revenue is not doubled");
  const sum=sqlite.prepare("SELECT SUM(amount_baht) t FROM payments WHERE status='confirmed'").get().t;assert.equal(sum,980);
});
test("P0: cancelling a paid order voids its payment; reopening and paying again is clean; on-site collection recorded once",async()=>{
  const {env,sqlite}=await setupV1();
  const a=await mk(env);await mv(env,a.id,S.PENDING,S.PAID,980);await mv(env,a.id,S.PAID,S.CANCEL);
  assert.deepEqual(pays(sqlite,a.id).map(p=>p.s),["void"]);await mv(env,a.id,S.CANCEL,S.PENDING);await mv(env,a.id,S.PENDING,S.PAID,980);
  assert.deepEqual(pays(sqlite,a.id).map(p=>p.s),["void","confirmed"]);
  const b=await mk(env,{delivery:"event"});await mv(env,b.id,S.PENDING,S.LATER);assert.deepEqual(pays(sqlite,b.id),[]);
  await mv(env,b.id,S.LATER,S.PAID,980);assert.deepEqual(pays(sqlite,b.id).map(p=>[p.s,p.m]),[["confirmed","on_site"]]);
  await mv(env,b.id,S.PAID,S.PENDING);await mv(env,b.id,S.PENDING,S.PAID,980);
  assert.equal(pays(sqlite,b.id).filter(p=>p.s==="confirmed").length,1);
  assert.deepEqual(await svc.paymentIntegrity(env),[]);
});
test("P0: database itself refuses a second confirmed payment; concurrent double-confirm records one",async()=>{
  const {env,sqlite}=await setupV1();const r=await mk(env);
  await Promise.allSettled([1,2,3,4,5].map(()=>mv(env,r.id,S.PENDING,S.PAID,980)));
  assert.equal(pays(sqlite,r.id).filter(p=>p.s==="confirmed").length,1);
  assert.throws(()=>sqlite.exec(`INSERT INTO payments(order_id,amount_baht,status) SELECT id,980,'confirmed' FROM orders WHERE order_no='${r.id}'`),/UNIQUE constraint failed: payments\.order_id/);
});
test("P0: integrity audit flags paid orders without/with wrong payment and unpaid orders with a confirmed payment",async()=>{
  const {env,sqlite}=await setupV1();const a=await mk(env),b=await mk(env);
  await mv(env,a.id,S.PENDING,S.PAID,980);
  sqlite.exec(`DELETE FROM payments`);sqlite.exec(`INSERT INTO payments(order_id,amount_baht,status) SELECT id,500,'confirmed' FROM orders WHERE order_no='${b.id}'`);
  const v=await svc.paymentIntegrity(env);assert.equal(v.length,2);
  assert.ok(v.some(x=>x.order===a.id&&x.confirmed===0)&&v.some(x=>x.order===b.id&&/unpaid/.test(x.problem)));
});
test("P0: payment flow also correct through the admin HTTP API (+ integrity endpoint is owner-only)",async()=>{
  const {env,ctx,sqlite}=await setupV1();const r=await mk(env);
  const post=(from,to,amount)=>call(worker,env,ctx,`/api/admin/orders/${r.id}/status`,{method:"POST",body:{from,to,amount}});
  for(let i=0;i<2;i++){assert.equal((await post(S.PENDING,S.PAID,980)).status,200);assert.equal((await post(S.PAID,S.PENDING)).status,200);}
  assert.equal((await post(S.PENDING,S.PAID,980)).status,200);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payments WHERE status='confirmed'").get().n,1);
  assert.deepEqual((await (await call(worker,env,ctx,"/api/admin/integrity")).json()).violations,[]);
  assert.equal((await call(worker,env,{},"/api/admin/integrity")).status,403);
});
test("P0: imported paid orders carry a payment record so later undo/confirm stays consistent",async()=>{
  const {env,sqlite}=await setupV1({rounds:false});
  const rd=[["ROUND-001","รอบ 1","2026-12-01T00:00:00+07:00","2026-12-06T23:59:00+07:00","2026-12-07T10:00:00+07:00","ปิดรับ",50,80,"city,ship","",""]];
  const it={product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:2,name:"HOME TERRAIN EDITION",fitName:"ทรง Boxy",unitPrice:490,lineTotal:980};
  const row=(id,st)=>[id,"req-"+id+"-abcdefghijk","fp","2026-12-02T10:00:00.000Z","ROUND-001","ทดสอบ","0800000000","city","",980,0,980,st,"","",JSON.stringify({items:[it],round:{}}),""];
  const orders=[row("NORX-LEGACY-001",S.PAID),row("NORX-LEGACY-002",S.PENDING),row("NORX-LEGACY-003",S.DONE),row("NORX-LEGACY-004",S.LATER)];
  const p=await imp.planSync({rounds:rd,orders,state:{orders:[],rounds:[],products:["drop03"]}});assert.equal(p.ok,true,JSON.stringify(p.errors));
  await imp.runSync(env.ORDERS_DB,p.plan,{dryRun:false});
  assert.deepEqual(await svc.paymentIntegrity(env),[]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payments WHERE status='confirmed'").get().n,2);
  await svc.changeStatus(env,"adm",{orderNo:"NORX-LEGACY-001",from:S.PAID,to:S.PENDING,now:NOW});
  await svc.changeStatus(env,"adm",{orderNo:"NORX-LEGACY-001",from:S.PENDING,to:S.PAID,amount:980,now:NOW});
  assert.equal(pays(sqlite,"NORX-LEGACY-001").filter(x=>x.s==="confirmed").length,1);assert.deepEqual(await svc.paymentIntegrity(env),[]);
});

// ---------- P1-3 NORX-LEGACY-XXX ----------
test("P1: legacy order ids with extra hyphen segments (NORX-LEGACY-001) work in every admin API",async()=>{
  const {env,ctx,sqlite}=await setupV1();
  const r=await mk(env);sqlite.prepare("UPDATE orders SET order_no='NORX-LEGACY-001' WHERE order_no=?").run(r.id);
  const get=async p=>(await call(worker,env,ctx,p)).json();
  assert.equal((await get("/api/admin/orders?q=LEGACY")).orders.length,1);
  const post=(from,to,amount)=>call(worker,env,ctx,"/api/admin/orders/NORX-LEGACY-001/status",{method:"POST",body:{from,to,amount}});
  const bad=await post(S.PENDING,S.PAID,1);assert.equal(bad.status,400);assert.match((await bad.json()).message,/ยอดเงินไม่ตรง/);
  const ok=await post(S.PENDING,S.PAID,980);assert.equal(ok.status,200);assert.equal((await ok.json()).changed,true);
  assert.equal((await get("/api/admin/orders")).orders[0].status,S.PAID);
  assert.equal((await post(S.PAID,S.PENDING,undefined)).status,200);
  assert.equal((await call(worker,env,ctx,"/api/admin/orders/NORX-LEGACY-999/status",{method:"POST",body:{from:S.PENDING,to:S.PAID,amount:1}})).status,400); // valid shape, unknown order → Thai user error, not 404/500
  for(const badId of ["NORX-","NORX-a b","norx-LEGACY-001","NORX-"+"x".repeat(70),"NORX-LEGACY-001/../x"])assert.equal((await call(worker,env,ctx,`/api/admin/orders/${badId}/status`,{method:"POST",body:{}})).status,404,badId);
  assert.equal((await call(worker,env,{},"/api/admin/orders/NORX-LEGACY-001/status",{method:"POST",body:{from:S.PENDING,to:S.PAID,amount:980}})).status,403);
});
