import test from "node:test";
import assert from "node:assert/strict";
import * as imp from "../src/v1-import.mjs";
import * as core from "../src/orders-core.mjs";
import * as svc from "../src/orders-service.mjs";
import {setupV1} from "./helpers/orders-env.mjs";
const S=core.STATUS,PRODUCTS=["drop03","drop02"];
const item=(p,fit,sleeve,size,qty,price=490)=>({product:p,fit,sleeve,size,qty,name:p==="drop03"?"HOME TERRAIN EDITION":"WOVEN STRIDE EDITION",fitName:fit==="boxy"?"ทรง Boxy":"ทรงปกติ",unitPrice:price,lineTotal:qty*price});
const rnd={id:"ROUND-001",name:"รอบ 1",paymentDue:"2026-12-07T10:00:00+07:00",readyText:"x"};
const mkRow=(id,status,{delivery="city",items=[item("drop03","boxy","short","M",2)],shipping=0,note="",req}={})=>{
  const subtotal=items.reduce((n,i)=>n+i.lineTotal,0);
  return [id,req??"req-"+id.slice(5)+"-abcdefghij","fp-"+id,"2026-12-02T10:00:00.000Z","ROUND-001","'ทดสอบ "+id,"'0800000000",delivery,delivery==="ship"?"'99/9 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 50000":"",subtotal,shipping,subtotal+shipping,status,"2026-12-03T10:00:00.000Z","admin",JSON.stringify({items,round:rnd}),note];
};
export const rounds=[["ROUND-001","รอบ 1","2026-12-01T00:00:00+07:00","2026-12-06T23:59:00+07:00","2026-12-07T10:00:00+07:00","ส่งร้านแล้ว",50,80,"city,event,ship","x","2026-12-08T10:00:00.000Z"]];
const orders=()=>[mkRow("NORX-AAAA0001",S.PENDING),mkRow("NORX-AAAA0002",S.PAID,{delivery:"ship",shipping:50}),mkRow("NORX-AAAA0003",S.LATER,{delivery:"event"}),
  mkRow("NORX-AAAA0004",S.SENT,{items:[item("drop02","regular","long","XXS",1,590),item("drop03","boxy","short","L",3)]}),mkRow("NORX-AAAA0005",S.DONE),mkRow("NORX-AAAA0006",S.CANCEL),
  mkRow("NORX-AAAA0007","เห็นยอดแล้ว"),mkRow("NORX-AAAA0008",S.PENDING,{note:"ทดสอบ"}),mkRow("NORX-LEGACY-001",S.PAID)];
const plan=(o=orders(),r=rounds,state={orders:[],rounds:[],products:PRODUCTS},mode)=>imp.planSync({rounds:r,orders:o,state,mode});

test("plan: all six V1 statuses (+legacy 'เห็นยอดแล้ว') map to two-axis status; ids (incl. NORX-LEGACY-001), request ids, fingerprints preserved",async()=>{
  const p=await plan();assert.equal(p.ok,true,JSON.stringify(p.errors));assert.deepEqual(p.warnings,[]);
  const m=Object.fromEntries(p.plan.v1.orders.map(o=>[o.order_no,[o.payment_status,o.fulfillment_status]]));
  assert.deepEqual(m["NORX-AAAA0001"],["pending","received"]);assert.deepEqual(m["NORX-AAAA0002"],["confirmed","received"]);assert.deepEqual(m["NORX-AAAA0003"],["deferred_on_site","received"]);
  assert.deepEqual(m["NORX-AAAA0004"],["confirmed","in_production"]);assert.deepEqual(m["NORX-AAAA0005"],["confirmed","completed"]);assert.deepEqual(m["NORX-AAAA0006"],["cancelled","cancelled"]);
  assert.deepEqual(m["NORX-AAAA0007"],["confirmed","received"]);assert.deepEqual(m["NORX-LEGACY-001"],["confirmed","received"]);
  const o=p.plan.v1.orders[0];assert.equal(o.customer_phone,"0800000000");assert.ok(!o.customer_name.startsWith("'"));assert.equal(o.fingerprint,"fp-NORX-AAAA0001");
  assert.equal(p.plan.v1.orders.find(x=>x.order_no==="NORX-AAAA0008").is_test,1);
  assert.equal(p.plan.v1.rounds[0].status,"sent");assert.equal(p.plan.v1.rounds[0].opens_at,"2026-11-30T17:00:00.000Z");
});
test("fail-closed: unknown status, money mismatch, bad items, duplicates, unknown product/round state, ship without address stop the plan",async()=>{
  const noAddr=mkRow("NORX-BBBB0007",S.PAID,{delivery:"ship",shipping:50});noAddr[8]="";
  const bad=[mkRow("NORX-BBBB0001","ส่งต่อแล้ว"),Object.assign(mkRow("NORX-BBBB0002",S.PAID),{11:999}),mkRow("NORX-BBBB0003",S.PAID,{items:[item("nope","boxy","short","M",1)]}),
    mkRow("NORX-BBBB0004",S.PAID),mkRow("NORX-BBBB0004",S.PAID),mkRow("NORX-BBBB0005",S.PAID,{req:"same-request-0000000"}),mkRow("NORX-BBBB0006",S.PAID,{req:"same-request-0000000"}),noAddr];
  const p=await plan(bad,[[...rounds[0].slice(0,5),"???",...rounds[0].slice(6)]]);
  assert.equal(p.ok,false);const msgs=p.errors.map(e=>e.error).join("|");
  for(const re of [/unknown V1 status/,/money mismatch/,/unknown product/,/duplicate order id/,/duplicate requestId/,/unknown round state/,/ship order without address/])assert.match(msgs,re);
});
test("dry-run writes nothing; import preserves ids and creates payments for paid-like orders only",async()=>{
  const {env,sqlite}=await setupV1({rounds:false});const p=(await plan()).plan;
  assert.deepEqual(await imp.runSync(env.ORDERS_DB,p,{dryRun:true}),{dryRun:true,groups:10});
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM orders").get().n,0);
  await imp.runSync(env.ORDERS_DB,p,{dryRun:false});
  assert.deepEqual(sqlite.prepare("SELECT order_no FROM orders ORDER BY id").all().map(r=>r.order_no),p.v1.orders.map(o=>o.order_no));
  const paid=sqlite.prepare("SELECT o.order_no n FROM payments y JOIN orders o ON o.id=y.order_id WHERE y.status='confirmed' ORDER BY 1").all().map(r=>r.n);
  assert.deepEqual(paid,["NORX-AAAA0002","NORX-AAAA0004","NORX-AAAA0005","NORX-AAAA0007","NORX-LEGACY-001"]);
  assert.deepEqual(await svc.paymentIntegrity(env),[]);
  assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM orders WHERE import_hash IS NULL").get().n===0);
  const st=await imp.readState(env.ORDERS_DB);assert.deepEqual(await imp.reconcileState(p,st),{ok:true,diffs:[],orphans:[],v2NativeOrders:0});
});
test("CUTOVER SAFETY: a V1-era retry (same requestId + payload) hitting V2 after import returns the ORIGINAL order, no duplicate",async()=>{
  const {env,sqlite}=await setupV1({rounds:false});
  const cfgRound=["ROUND-001","รอบ 1","2026-12-01T00:00:00+07:00","2026-12-06T23:59:00+07:00","2026-12-07T10:00:00+07:00","เปิดรับ",50,80,"city,event,ship","x",""];
  const input={requestId:"req-v1-original-0001",roundId:"ROUND-001",name:"ทดสอบ นามสมมติ",phone:"0800000000",delivery:"city",address:"",items:[{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:2}],preorder:true,sizing:true,privacy:true,expectedTotal:980};
  const sync=async(rows)=>{const p=await imp.planSync({rounds:[cfgRound],orders:rows,state:await imp.readState(env.ORDERS_DB)});assert.equal(p.ok,true,JSON.stringify(p.errors));await imp.runSync(env.ORDERS_DB,p.plan,{dryRun:false})};
  await sync([]);const catalog=await svc.loadConfig(env);
  const fp=await core.fingerprint(core.normalize(input,catalog)); // V1 and V2 compute this identically (golden-tested)
  const row=mkRow("NORX-CCCC0001",S.PENDING,{req:input.requestId});row[2]=fp;await sync([row]);
  const r=await svc.submitOrder(env,input,{now:Date.parse("2026-12-03T00:00:00Z")});
  assert.equal(r.id,"NORX-CCCC0001");assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM orders").get().n,1);
  await assert.rejects(svc.submitOrder(env,{...input,name:"คนอื่น ทดสอบ"},{now:Date.parse("2026-12-03T00:00:00Z")}),/รหัสคำขอซ้ำกับข้อมูลที่ต่างกัน/);
});
