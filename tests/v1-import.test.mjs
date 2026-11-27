import test from "node:test";
import assert from "node:assert/strict";
import * as imp from "../src/v1-import.mjs";
import * as core from "../src/orders-core.mjs";
import * as svc from "../src/orders-service.mjs";
import {setupV1} from "./helpers/orders-env.mjs";
const S=core.STATUS,PRODUCTS=["drop03","drop02"];
// SYNTHETIC V1 sheet rows (column order = V1 SHEETS.orders.head). Phones/names carry V1's leading "'" formula guard.
const item=(p,fit,sleeve,size,qty,price=490)=>({product:p,fit,sleeve,size,qty,name:p==="drop03"?"HOME TERRAIN EDITION":"WOVEN STRIDE EDITION",fitName:fit==="boxy"?"ทรง Boxy":"ทรงปกติ",unitPrice:price,lineTotal:qty*price});
const rnd={id:"ROUND-001",name:"รอบ 1",paymentDue:"2026-12-07T10:00:00+07:00",readyText:"x"};
const mkRow=(id,status,{delivery="city",items=[item("drop03","boxy","short","M",2)],shipping=0,note="",req}={})=>{
  const subtotal=items.reduce((n,i)=>n+i.lineTotal,0);
  return [id,req??"req-"+id.slice(5)+"-abcdefghij","fp-"+id,"2026-12-02T10:00:00.000Z","ROUND-001","'ทดสอบ "+id,"'0800000000",delivery,delivery==="ship"?"'99/9 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 50000":"",subtotal,shipping,subtotal+shipping,status,"2026-12-03T10:00:00.000Z","admin",JSON.stringify({items,round:rnd}),note];
};
const rounds=[["ROUND-001","รอบ 1","2026-12-01T00:00:00+07:00","2026-12-06T23:59:00+07:00","2026-12-07T10:00:00+07:00","ส่งร้านแล้ว",50,80,"city,event,ship","x","2026-12-08T10:00:00.000Z"]];
const orders=()=>[mkRow("NORX-AAAA0001",S.PENDING),mkRow("NORX-AAAA0002",S.PAID,{delivery:"ship",shipping:50}),mkRow("NORX-AAAA0003",S.LATER,{delivery:"event"}),
  mkRow("NORX-AAAA0004",S.SENT,{items:[item("drop02","regular","long","XXS",1,590),item("drop03","boxy","short","L",3)]}),mkRow("NORX-AAAA0005",S.DONE),mkRow("NORX-AAAA0006",S.CANCEL),
  mkRow("NORX-AAAA0007","เห็นยอดแล้ว"),mkRow("NORX-AAAA0008",S.PENDING,{note:"ทดสอบ"})];
const plan=()=>imp.planImport({rounds,orders:orders(),knownProducts:PRODUCTS});

test("plan: all six V1 statuses (+legacy 'เห็นยอดแล้ว') map to two-axis status; order ids, request ids, fingerprints preserved",()=>{
  const p=plan();assert.equal(p.ok,true,JSON.stringify(p.errors));
  const m=Object.fromEntries(p.plan.orders.map(o=>[o.order_no,[o.payment_status,o.fulfillment_status]]));
  assert.deepEqual(m["NORX-AAAA0001"],["pending","received"]);assert.deepEqual(m["NORX-AAAA0002"],["pending","received"].map((x,i)=>["confirmed","received"][i]));
  assert.deepEqual(m["NORX-AAAA0003"],["deferred_on_site","received"]);assert.deepEqual(m["NORX-AAAA0004"],["confirmed","in_production"]);
  assert.deepEqual(m["NORX-AAAA0005"],["confirmed","completed"]);assert.deepEqual(m["NORX-AAAA0006"],["cancelled","cancelled"]);assert.deepEqual(m["NORX-AAAA0007"],["confirmed","received"]);
  const o=p.plan.orders[0];assert.equal(o.customer_phone,"0800000000");assert.ok(!o.customer_name.startsWith("'"));assert.equal(o.fingerprint,"fp-NORX-AAAA0001");
  assert.equal(p.plan.orders.find(x=>x.order_no==="NORX-AAAA0008").is_test,1);
  assert.equal(p.plan.rounds[0].status,"sent");assert.equal(p.plan.rounds[0].opens_at,"2026-11-30T17:00:00.000Z");
});
test("fail-closed: unknown status, money mismatch, bad items, duplicates, unknown product/round state stop the plan",()=>{
  const bad=[mkRow("NORX-BBBB0001","ส่งต่อแล้ว"),Object.assign(mkRow("NORX-BBBB0002",S.PAID),{11:999}),mkRow("NORX-BBBB0003",S.PAID,{items:[item("nope","boxy","short","M",1)]}),
    mkRow("NORX-BBBB0004",S.PAID),mkRow("NORX-BBBB0004",S.PAID),mkRow("NORX-BBBB0005",S.PAID,{req:"same-request-0000000"}),mkRow("NORX-BBBB0006",S.PAID,{req:"same-request-0000000"})];
  const p=imp.planImport({rounds:[[...rounds[0].slice(0,5),"???",...rounds[0].slice(6)]],orders:bad,knownProducts:PRODUCTS});
  assert.equal(p.ok,false);const msgs=p.errors.map(e=>e.error).join("|");
  for(const re of [/unknown V1 status/,/money mismatch/,/unknown product/,/duplicate order id/,/duplicate requestId/,/unknown round state/])assert.match(msgs,re);
});
test("dry-run writes nothing; real import preserves ids; second import is a no-op (duplicate prevention)",async()=>{
  const {env,sqlite}=await setupV1({rounds:false});const p=plan().plan;
  assert.deepEqual(await imp.runImport(env.ORDERS_DB,p,{dryRun:true}),{dryRun:true,groups:9});
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM orders").get().n,0);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM rounds").get().n,0);
  await imp.runImport(env.ORDERS_DB,p,{dryRun:false});
  const snap=()=>JSON.stringify(["orders","order_items","shipping_addresses","order_status_history","rounds"].map(t=>sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));
  const after1=snap();assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM orders").get().n,8);
  assert.deepEqual(sqlite.prepare("SELECT order_no FROM orders ORDER BY id").all().map(r=>r.order_no),p.orders.map(o=>o.order_no));
  await imp.runImport(env.ORDERS_DB,p,{dryRun:false});await imp.runImport(env.ORDERS_DB,p,{dryRun:false});
  assert.equal(snap(),after1,"re-running changes nothing");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM order_status_history").get().n,8);
  const sentItems=sqlite.prepare("SELECT production_status s FROM order_items WHERE order_id=(SELECT id FROM orders WHERE order_no='NORX-AAAA0004')").all();assert.ok(sentItems.every(r=>r.s==="batched"));
});
test("reconciliation: 0 diff after import; detects tampering (money, status, address, missing order)",async()=>{
  const {env,sqlite}=await setupV1({rounds:false});const p=plan().plan;await imp.runImport(env.ORDERS_DB,p,{dryRun:false});
  assert.deepEqual(await imp.reconcile(env.ORDERS_DB,p),{ok:true,diffs:[]});
  sqlite.exec("PRAGMA ignore_check_constraints=ON");
  sqlite.exec("UPDATE order_items SET qty=3 WHERE id=1");
  sqlite.exec("UPDATE orders SET payment_status='pending' WHERE order_no='NORX-AAAA0002'");
  sqlite.exec("UPDATE shipping_addresses SET address='เปลี่ยนที่อยู่' WHERE order_id=(SELECT id FROM orders WHERE order_no='NORX-AAAA0002')");
  const r=await imp.reconcile(env.ORDERS_DB,p);assert.equal(r.ok,false);const checks=r.diffs.map(d=>d.check);
  for(const c of ["piece count","status counts","status","items","shipping address"])assert.ok(checks.includes(c),c+" in "+checks);
  const empty=await setupV1({rounds:false});assert.equal((await imp.reconcile(empty.env.ORDERS_DB,p)).diffs.some(d=>d.check==="order count"),true);
});
test("CUTOVER SAFETY: a V1-era retry (same requestId + payload) hitting V2 after import returns the ORIGINAL order, no duplicate",async()=>{
  const {env,sqlite}=await setupV1({rounds:false});
  const cfgRound=["ROUND-001","รอบ 1","2026-12-01T00:00:00+07:00","2026-12-06T23:59:00+07:00","2026-12-07T10:00:00+07:00","เปิดรับ",50,80,"city,event,ship","x",""];
  const input={requestId:"req-v1-original-0001",roundId:"ROUND-001",name:"ทดสอบ นามสมมติ",phone:"0800000000",delivery:"city",address:"",items:[{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:2}],preorder:true,sizing:true,privacy:true,expectedTotal:980};
  const catalog=await (async()=>{await imp.runImport(env.ORDERS_DB,imp.planImport({rounds:[cfgRound],orders:[],knownProducts:PRODUCTS}).plan,{dryRun:false});return svc.loadConfig(env)})();
  const fp=await core.fingerprint(core.normalize(input,catalog)); // V1 and V2 compute this identically (golden-tested)
  const row=mkRow("NORX-CCCC0001",S.PENDING,{req:input.requestId});row[2]=fp;
  await imp.runImport(env.ORDERS_DB,imp.planImport({rounds:[cfgRound],orders:[row],knownProducts:PRODUCTS}).plan,{dryRun:false});
  const r=await svc.submitOrder(env,input,{now:Date.parse("2026-12-03T00:00:00Z")});
  assert.equal(r.id,"NORX-CCCC0001");assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM orders").get().n,1);
  await assert.rejects(svc.submitOrder(env,{...input,name:"คนอื่น ทดสอบ"},{now:Date.parse("2026-12-03T00:00:00Z")}),/รหัสคำขอซ้ำกับข้อมูลที่ต่างกัน/);
});
