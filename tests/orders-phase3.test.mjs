import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/orders-admin-worker.mjs";
import * as svc from "../src/orders-service.mjs";
import * as core from "../src/orders-core.mjs";
import {csvCell,toCsv} from "../src/csv.mjs";
import {setupV1,orderInput,call,NOW,T0,DAY} from "./helpers/orders-env.mjs";
const S=core.STATUS,CLOSED=T0+8*DAY;
const it=(p,fit,sleeve,size,qty)=>({product:p,fit,sleeve,size,qty});
const price=i=>(i.sleeve==="short"?490:590)*i.qty;
const mk=(env,o={})=>{const items=o.items??[it("drop03","boxy","short","M",2)];return svc.submitOrder(env,orderInput({expectedTotal:items.reduce((n,i)=>n+price(i),0)+(o.delivery==="ship"?50:0),...o,items}),{now:NOW})};
const pay=(env,r,to=S.PAID)=>svc.changeStatus(env,"adm",{orderNo:r.id,from:S.PENDING,to,amount:to===S.PAID?r.total:undefined,now:NOW});
async function scenario(){
  const c=await setupV1();const {env}=c;
  const a=await mk(env,{items:[it("drop03","boxy","short","M",2),it("drop02","regular","long","XXS",1)]});await pay(env,a);                 // paid
  const b=await mk(env,{delivery:"ship",address:"99/9 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 50000",items:[it("drop03","boxy","short","M",1)]});await pay(env,b);   // paid ship
  const d=await mk(env,{delivery:"event",items:[it("drop03","boxy","long","L",3)]});await pay(env,d,S.LATER);                      // on-site
  const e=await mk(env,{items:[it("drop02","regular","short","S",4)]});                                                            // pending
  const f=await mk(env,{items:[it("drop03","boxy","short","XS",1)]});await pay(env,f);await svc.changeStatus(env,"adm",{orderNo:f.id,from:S.PAID,to:S.CANCEL,now:NOW}); // cancelled
  return {...c,a,b,d,e,f};
}

test("dashboard: awaiting payment / ready for production / awaiting shipment / notifications; events are not read from here",async()=>{
  const {env}=await scenario();
  const d=await svc.dashboard(env,{now:NOW});
  assert.equal(d.awaitingPayment.count,1);assert.equal(d.awaitingPayment.amount,4*490);assert.equal(d.awaitingPayment.oldest[0].round,"ROUND-001");
  assert.deepEqual([d.readyForProduction.orders,d.readyForProduction.pieces],[3,2+1+1+3]);assert.equal(d.readyForProduction.rounds[0].code,"ROUND-001");
  assert.equal(d.awaitingShipment.count,0,"not shippable until sent to shop");assert.equal(d.notifications.queued,5);assert.equal(d.integrityViolations,0);assert.equal(d.events,null);
  assert.equal(d.round.code,"ROUND-001");assert.equal(d.round.summary.paidOrders,2);
  // after cut-off: ship orders appear as awaiting shipment, pickup as awaiting hand-over
  await svc.closeRound(env,"adm","ROUND-001");await svc.cancelUnpaid(env,"adm","ROUND-001",1,CLOSED);
  const sent=await svc.sendToShop(env,"adm","ROUND-001",2+1+1+3,CLOSED);assert.equal(sent.pieces,7);
  const d2=await svc.dashboard(env,{now:CLOSED});
  assert.equal(d2.awaitingPayment.count,0);assert.equal(d2.readyForProduction.pieces,0);assert.equal(d2.awaitingShipment.count,1);assert.equal(d2.awaitingShipment.orders[0].name,"ทดสอบ นามสมมติ");assert.equal(d2.awaitingHandover.count,1,"paid city order; on-site order stays unpaid/received");
});
test("dashboard hides test orders unless asked (staging)",async()=>{
  const {env}=await setupV1({live:false});
  await svc.submitOrder(env,{...orderInput({expectedTotal:980}),testKey:"test-key-12345"},{now:NOW});
  assert.equal((await svc.dashboard(env,{now:NOW})).awaitingPayment.count,0);assert.equal((await svc.dashboard(env,{now:NOW,includeTest:true})).awaitingPayment.count,1);
});
test("production summary: by collection/product/fit/sleeve/size with payment split; pending & cancelled never counted as production; catalog order",async()=>{
  const {env,sqlite}=await scenario();sqlite.exec("INSERT INTO collections(id,slug,name,status) VALUES (1,'c1','Collection ทดสอบ','active');UPDATE products SET collection_id=1 WHERE slug='drop03'");
  const s=await svc.productionSummary(env,{round:"ROUND-001"});
  const key=r=>[r.product,r.sleeve,r.size].join("|"),m=Object.fromEntries(s.rows.map(r=>[key(r),r]));
  assert.deepEqual(s.rows.map(key),["drop03|short|M","drop03|long|L","drop02|short|S","drop02|long|XXS"],"catalog order: product, short before long, size order");
  assert.deepEqual([m["drop03|short|M"].production,m["drop03|short|M"].paid,m["drop03|short|M"].deferred],[3,3,0]);
  assert.deepEqual([m["drop03|long|L"].production,m["drop03|long|L"].paid,m["drop03|long|L"].deferred],[3,0,3],"on-site counts for production but is NOT paid");
  assert.deepEqual([m["drop02|short|S"].production,m["drop02|short|S"].pending],[0,4],"pending shown, not produced");
  assert.ok(!("drop03|short|XS" in m),"cancelled order excluded");assert.equal(m["drop03|short|M"].collection,"Collection ทดสอบ");assert.equal(m["drop02|long|XXS"].collection,"—");
  assert.deepEqual([s.totals.production,s.totals.paid,s.totals.deferred,s.totals.pending],[3+3+1,4,3,4]);
  assert.equal((await svc.productionSummary(env,{round:"ROUND-002"})).rows.length,0);assert.equal((await svc.productionSummary(env,{round:"all"})).totals.production,7);
  // matches the V1 summary (core.summary) on pieces and revenue for the same round
  const v1=(await svc.roundsWithSummary(env,NOW)).rounds.find(r=>r.id==="ROUND-001").summary;assert.equal(v1.pieces,s.totals.production);
});
test("production CSV: BOM + Thai headers + totals row; every cell formula-safe",async()=>{
  const {env}=await scenario();const csv=svc.productionCsv(await svc.productionSummary(env,{round:"ROUND-001"}));
  assert.ok(csv.startsWith("﻿\"รอบ\""));assert.match(csv,/"ผลิต \(ชำระแล้ว\+จ่ายหน้างาน\)"/);assert.match(csv.trimEnd().split("\r\n").at(-1),/"รวม","7","4","3","4"/);
  for(const [v,out] of [["=1+1","\"'=1+1\""],["+SUM(A1)","\"'+SUM(A1)\""],["-2","\"'-2\""],["@x","\"'@x\""],["  =cmd","\"'  =cmd\""],["\t=x","\"'\t=x\""],["ปกติ","\"ปกติ\""],["a\"b","\"a\"\"b\""],[null,"\"\""]])assert.equal(csvCell(v),out);
  assert.equal(toCsv([["a","=b"]]),"﻿\"a\",\"'=b\"\r\n");
});
test("orders CSV: hostile names/notes cannot become formulas, address included for ship only, export is audited",async()=>{
  const {env,sqlite}=await setupV1();
  const r=await svc.submitOrder(env,orderInput({name:"=HYPERLINK(\"http://x\",\"y\") ทดสอบ",delivery:"ship",address:"99/9 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 50000",expectedTotal:1030}),{now:NOW});
  const csv=await svc.ordersCsv(env,"adm",{round:"ROUND-001"});
  assert.match(csv,/"'=HYPERLINK/);assert.ok(!/,"=HYPERLINK/.test(csv));assert.match(csv,/99\/9 ถนนทดสอบ/);assert.match(csv,new RegExp(r.id));
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='export.orders'").get().n,1);
});
test("batch production status: only after cut-off, atomic, guarded by the piece count the admin saw, valid transitions only",async()=>{
  const {env,sqlite}=await scenario();const st=()=>Object.fromEntries(sqlite.prepare("SELECT production_status s, SUM(qty) q FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.payment_status IN ('confirmed','deferred_on_site') AND o.fulfillment_status!='cancelled' GROUP BY 1").all().map(r=>[r.s,r.q]));
  const rej=(p,re)=>assert.rejects(p,e=>e instanceof core.UserError&&re.test(e.message));
  await rej(svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"batched",to:"produced",expected:7,now:NOW}),/ต้องตัดยอดส่งร้านก่อน/);
  await svc.closeRound(env,"adm","ROUND-001");await svc.cancelUnpaid(env,"adm","ROUND-001",1,CLOSED);await svc.sendToShop(env,"adm","ROUND-001",7,CLOSED);
  assert.deepEqual(st(),{batched:7});
  await rej(svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"batched",to:"received",expected:7}),/ไม่ได้/);
  await rej(svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"pending",to:"batched",expected:7}),/ไม่ได้/);
  await rej(svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"batched",to:"produced",expected:6}),/จำนวนชิ้นเปลี่ยนไป/);
  assert.deepEqual(st(),{batched:7},"nothing changed after a mismatch");
  // one lot (drop03 short M = 3 pieces) first, then the rest
  assert.deepEqual(await svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"batched",to:"produced",product:"drop03",sleeve:"short",size:"M",expected:3}),{rows:2,pieces:3});
  assert.deepEqual(st(),{batched:4,produced:3});
  await svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"batched",to:"produced",expected:4});await svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"produced",to:"received",expected:7});
  assert.deepEqual(st(),{received:7});assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='production.items_status'").get().n,3);
  await svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"received",to:"produced",expected:7});assert.deepEqual(st(),{produced:7},"undo works");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM order_items WHERE production_status='batched' AND order_id IN (SELECT id FROM orders WHERE fulfillment_status='cancelled')").get().n,0,"cancelled orders untouched");
  const sum=await svc.productionSummary(env,{round:"ROUND-001"});assert.equal(sum.totals.status.produced,7);
});
test("admin pages: one consistent menu (9 entries) on every page, current page marked, strict CSP, owner-only",async()=>{
  const {env,ctx}=await setupV1();
  const pages=[["/admin/","ภาพรวม"],["/admin/orders/","ออเดอร์"],["/admin/production/","การผลิต"],["/admin/shipping/","จัดส่ง"],["/admin/products/","สินค้า"],["/admin/products/1/content/","สินค้า"],["/admin/website/","เว็บไซต์"],["/admin/settings/","ตั้งค่า"]];
  for(const [path,label] of pages){
    const res=await call(worker,env,ctx,path);assert.equal(res.status,200,path);const html=await res.text();
    const navHtml=html.slice(html.indexOf("<nav"),html.indexOf("</nav>")),links=[...navHtml.matchAll(/<a href="(\/admin\/[^"]*)"( aria-current="page")?>([^<]+)<\/a>/g)];
    assert.deepEqual(links.map(m=>m[3]),["ภาพรวม","ออเดอร์","การผลิต","จัดส่ง","สินค้า","เว็บไซต์","กิจกรรม","สื่อ","ตั้งค่า"],path);
    assert.deepEqual(links.filter(m=>m[2]).map(m=>m[3]),[label],path+" marks itself current");
    assert.ok(!/<script(?![^>]*src=)/.test(html)&&!/\sstyle=/.test(html),path+" no inline script/style");assert.match(res.headers.get("content-security-policy"),/default-src 'none'/);
    assert.match(html,/<html lang="th"/);assert.match(html,/class="skip"/);assert.match(html,/<main id="main"/);assert.match(html,/name="viewport"/);
    assert.equal((await call(worker,env,{},path)).status,403,path+" requires owner");
  }
  assert.equal((await call(worker,env,ctx,"/admin")).status,200);
});
test("new Phase 03 routes reject anonymous/non-owner callers and CSRF; CSV downloads are attachments, no-store",async()=>{
  const {env,ctx}=await scenario();
  const routes=[["GET","/api/admin/dashboard"],["GET","/api/admin/production/summary?round=ROUND-001"],["GET","/api/admin/production/summary.csv"],["POST","/api/admin/production/items-status",{round:"ROUND-001",from:"batched",to:"produced",expected:1}],["GET","/api/admin/orders/export.csv"]];
  for(const [m,p,b] of routes){assert.equal((await call(worker,env,{},p,{method:m,body:b})).status,403,p);assert.equal((await call(worker,env,{access:{aud:"aud",getIdentity:async()=>({email:"x@example.test"})}},p,{method:m,body:b})).status,403,p)}
  const cross=await worker.fetch(new Request("https://orders.test/api/admin/production/items-status",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://evil.test"},body:"{}"}),env,ctx);assert.equal(cross.status,403);
  const csv=await call(worker,env,ctx,"/api/admin/orders/export.csv");assert.equal(csv.status,200);assert.match(csv.headers.get("content-disposition"),/attachment; filename="NORX-orders-all\.csv"/);assert.equal(csv.headers.get("cache-control"),"no-store");assert.match(csv.headers.get("content-type"),/text\/csv/);
  const bad=await call(worker,env,ctx,"/api/admin/production/items-status",{method:"POST",body:{round:"ROUND-001",from:"batched",to:"produced",expected:1}});assert.equal(bad.status,400);assert.match((await bad.json()).message,/ต้องตัดยอดส่งร้านก่อน/);
});
