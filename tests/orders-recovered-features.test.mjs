import test from "node:test";
import assert from "node:assert/strict";
import * as svc from "../src/orders-service.mjs";
import * as core from "../src/orders-core.mjs";
import worker from "../src/orders-admin-worker.mjs";
import {s10CheckDigit,checkTracking,canonicalCarrier,CARRIERS,OTHER} from "../admin-ui/carriers.mjs";
import {setup,setupV1,orderInput,call,NOW,T0,DAY} from "./helpers/orders-env.mjs";
// Features restored from staging Admin 589b707d (Recovery R2). Their original tests were lost with 7b20b5f; these are new.
// All data is SYNTHETIC; tracking numbers are made up (the Thailand Post one only has a computed check digit).
const S=core.STATUS,CLOSED=T0+8*DAY;
const rejects=(p,re)=>assert.rejects(p,e=>e instanceof core.UserError&&re.test(e.message));
const st=(sqlite,id)=>({...sqlite.prepare("SELECT payment_status p,fulfillment_status f FROM orders WHERE order_no=?").get(id)});
const ADDR="ทดสอบ นามสมมติ 99 ถนนสมมติ ตำบลทดสอบ อำเภอทดสอบ จังหวัดทดสอบ 57000";
// `count` paid orders (2 pieces each) in ROUND-001, round closed and sent to the shop (items batched).
async function sentRound({ship=false,count=1}={}){
  const s=await setupV1(),orders=[];
  for(let i=0;i<count;i++){
    const o=await svc.submitOrder(s.env,orderInput(ship?{delivery:"ship",address:ADDR,expectedTotal:1030}:{}),{now:NOW});
    await svc.changeStatus(s.env,"adm",{orderNo:o.id,from:S.PENDING,to:S.PAID,amount:ship?1030:980,now:NOW});orders.push(o);
  }
  await svc.closeRound(s.env,"adm","ROUND-001");
  await svc.sendToShop(s.env,"adm","ROUND-001",2*count,CLOSED);
  return {...s,orders};
}
const receiveAll=async(env,pieces)=>{
  await svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"batched",to:"produced",expected:pieces,now:CLOSED});
  await svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"produced",to:"received",expected:pieces,now:CLOSED});
};

test("carriers: Thailand Post S10 check digit and Flash format only WARN; unknown carriers are never format-checked",()=>{
  assert.equal(s10CheckDigit("12345678"),5,"8·1+6·2+4·3+2·4+3·5+5·6+9·7+7·8 = 204, 11 − 204 mod 11 = 5");
  const raw=d=>11-([...d].reduce((s,c,i)=>s+Number(c)*[8,6,4,2,3,5,9,7][i],0)%11);
  const find=want=>{for(let i=0;i<1e6;i++){const d=String(i).padStart(8,"0");if(raw(d)===want)return d}};
  assert.equal(s10CheckDigit(find(10)),0,"raw 10 → 0");assert.equal(s10CheckDigit(find(11)),5,"raw 11 → 5");
  assert.deepEqual(checkTracking("ไปรษณีย์ไทย","EE123456785TH"),{ok:true,warnings:[]});
  assert.equal(checkTracking("EMS"," ee123456785th ").ok,true,"alias + case/space tolerant");
  const wrongDigit=checkTracking("ไปรษณีย์ไทย","EE123456784TH");assert.equal(wrongDigit.ok,false);assert.match(wrongDigit.warnings[0],/หลักสุดท้าย/);
  assert.match(checkTracking("thai post","EE12345678TH").warnings[0],/ตัวอักษร 2 ตัว/);
  assert.equal(checkTracking("flash","TH0123456789AB").ok,true);assert.equal(checkTracking("Flash Express","TH123").ok,false);
  assert.deepEqual(checkTracking("ขนส่งสมมติ","anything-goes"),{ok:true,warnings:[]},"unknown carrier: no format check");
  assert.deepEqual(checkTracking("Flash Express",""),{ok:true,warnings:[]});
  assert.equal(canonicalCarrier("  Flash   express "),"Flash Express");assert.equal(canonicalCarrier("แฟลช"),"Flash Express");
  assert.equal(canonicalCarrier("ขนส่งสมมติ"),"ขนส่งสมมติ");assert.equal(OTHER,"อื่น ๆ");
  assert.deepEqual(CARRIERS.map(c=>c.name),["Flash Express","ไปรษณีย์ไทย"]);
});

test("partial receipts: per-line receipts with the count the admin saw; stale or over-receipts refused; complete order → pickup queue; audited",async()=>{
  const {env,sqlite,orders:[o]}=await sentRound();
  await rejects(svc.receiptLines(env,"ROUND-002",true),/ต้องตัดยอดส่งร้านก่อน/);
  assert.deepEqual((await svc.receiptLines(env,"ROUND-001",true)).lines,[],"nothing to receive before the factory has produced it");
  await svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"batched",to:"produced",expected:2,now:CLOSED});
  const {lines}=await svc.receiptLines(env,"ROUND-001",true);
  assert.equal(lines.length,1);assert.equal(lines[0].orderNo,o.id);assert.equal(lines[0].qty,2);assert.equal(lines[0].received,0);
  const id=lines[0].id,recv=(expected,add)=>svc.receivePartial(env,"adm",{round:"ROUND-001",lines:[{id,expected,add}],includeTest:true,now:CLOSED});
  const item=()=>({...sqlite.prepare("SELECT received_qty r,production_status s FROM order_items WHERE id=?").get(id)});
  await rejects(recv(0,0),/ตรวจจำนวนที่รับ/);
  await rejects(svc.receivePartial(env,"adm",{round:"ROUND-001",lines:[{id,expected:0,add:1},{id,expected:0,add:1}],includeTest:true,now:CLOSED}),/ตรวจจำนวนที่รับ/);
  assert.deepEqual(await recv(0,1),{pieces:1});
  assert.deepEqual(item(),{r:1,s:"produced"});assert.deepEqual(st(sqlite,o.id),{p:"confirmed",f:"in_production"});
  // R5: the production table showed "รับแล้ว 0" during a partial receipt; the received pieces are now reported (the bulk-action counts stay as they were)
  const mid=await svc.productionSummary(env,{round:"ROUND-001"});
  assert.deepEqual([mid.rows[0].status.produced,mid.rows[0].status.received,mid.rows[0].partial,mid.totals.partial],[2,0,1,1]);
  const midCsv=svc.productionCsv(mid);assert.match(midCsv,/"ผลิตเสร็จ \(รอรับของ\)","รับของแล้ว \(รวมรับบางส่วน\)"/);assert.match(midCsv.trimEnd().split("\r\n").at(-1),/"รวม","2","2","0","0","0","0","1","1"$/);
  await rejects(recv(0,1),/เปลี่ยนไปแล้ว/);await rejects(recv(1,2),/เปลี่ยนไปแล้ว/);
  assert.deepEqual(item(),{r:1,s:"produced"},"refused receipts change nothing");
  await rejects(svc.changeStatus(env,"adm",{orderNo:o.id,from:S.SENT,to:S.DONE,now:CLOSED}),/รับเสื้อยังไม่ครบ/);
  assert.deepEqual(await recv(1,1),{pieces:1});
  assert.deepEqual(item(),{r:2,s:"received"});assert.deepEqual(st(sqlite,o.id),{p:"confirmed",f:"ready_pickup"});
  const done=await svc.productionSummary(env,{round:"ROUND-001"});assert.deepEqual([done.totals.status.produced,done.totals.status.received,done.totals.partial],[0,2,0]);
  assert.deepEqual((await svc.receiptLines(env,"ROUND-001",true)).lines,[]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='production.partial_receipt'").get().n,2);
  assert.deepEqual(await svc.changeStatus(env,"adm",{orderNo:o.id,from:S.SENT,to:S.DONE,now:CLOSED}),{changed:true,status:S.DONE});
});

test("partial receipts through the Admin API (owner only, same guards)",async()=>{
  const {env,ctx,sqlite}=await sentRound();
  await svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"batched",to:"produced",expected:2,now:CLOSED});
  const g=await (await call(worker,env,ctx,"/api/admin/production/receipts?round=ROUND-001&includeTest=1")).json();
  assert.equal(g.ok,true);assert.equal(g.lines.length,1);
  const p=await call(worker,env,ctx,"/api/admin/production/receipts",{method:"POST",body:{round:"ROUND-001",includeTest:true,lines:[{id:g.lines[0].id,expected:0,add:2}]}});
  assert.equal(p.status,200);assert.deepEqual(await p.json(),{ok:true,pieces:2});
  const again=await call(worker,env,ctx,"/api/admin/production/receipts",{method:"POST",body:{round:"ROUND-001",includeTest:true,lines:[{id:g.lines[0].id,expected:0,add:2}]}});
  assert.equal(again.status,400);assert.match((await again.json()).message,/เปลี่ยนไปแล้ว/);
  assert.equal(sqlite.prepare("SELECT received_qty r FROM order_items").get().r,2);
});

test("batch shipping: only ready-to-ship orders, real date, unique numbers; marks shipped; the overwritten number stays in the audit",async()=>{
  const {env,ctx,sqlite,orders:[a,b]}=await sentRound({ship:true,count:2});
  await receiveAll(env,4);
  assert.deepEqual(st(sqlite,a.id),{p:"confirmed",f:"ready_ship"});
  const post=async body=>{const r=await call(worker,env,ctx,"/api/admin/shipments/batch",{method:"POST",body});return {status:r.status,...(await r.json())}};
  const row=(o,t)=>({orderNo:o.id,provider:"Flash Express",trackingNo:t});
  assert.match((await post({rows:[row(a,"TH0123456789AA")],shippedAt:"2026-02-30"})).message,/วันที่ส่งไม่ถูกต้อง/);
  assert.match((await post({rows:[row(a,"TH0123456789AA"),row(a,"TH0123456789AB")],shippedAt:"2026-12-12"})).message,/เลขออเดอร์ซ้ำ/);
  assert.match((await post({rows:[row(a,"TH0123456789AA"),row(b,"TH0123456789AA")],shippedAt:"2026-12-12"})).message,/เลขพัสดุซ้ำ/);
  assert.match((await post({rows:[{orderNo:"NORX-NOPE0000",provider:"Flash Express",trackingNo:"TH0123456789AA"}],shippedAt:"2026-12-12"})).message,/ไม่อยู่ในคิวพร้อมจัดส่ง/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM orders WHERE fulfillment_status='shipped'").get().n,0,"refused batches change nothing");
  // a number typed earlier without a date (order stays in the queue), then corrected by the batch
  const aid=sqlite.prepare("SELECT id FROM orders WHERE order_no=?").get(a.id).id;
  assert.equal((await call(worker,env,ctx,"/api/admin/orders/"+aid+"/shipment",{method:"PUT",body:{provider:"Flash Express",trackingNo:"TH00000000TYPO"}})).status,200);
  const ok=await post({rows:[row(a,"th0123456789aa")],shippedAt:"2026-12-12"});
  assert.deepEqual(ok,{status:200,ok:true,shipped:1});
  assert.deepEqual(st(sqlite,a.id),{p:"confirmed",f:"shipped"});
  assert.deepEqual({...sqlite.prepare("SELECT provider p,tracking_no t,shipped_at d FROM shipments WHERE order_id=?").get(aid)},{p:"Flash Express",t:"TH0123456789AA",d:"2026-12-12"});
  const au=sqlite.prepare("SELECT before b,after a FROM audit_log WHERE action='shipment.batch'").get();
  assert.match(au.b,/TH00000000TYPO/,"previous number kept");assert.match(au.a,/TH0123456789AA/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM order_status_history WHERE kind='fulfillment' AND to_status='shipped'").get().n,1);
  assert.match((await post({rows:[row(a,"TH0123456789AC")],shippedAt:"2026-12-12"})).message,/ไม่อยู่ในคิวพร้อมจัดส่ง/,"already shipped");
  assert.match((await post({rows:[row(b,"TH0123456789AA")],shippedAt:"2026-12-12"})).message,/ผูกกับออเดอร์อื่นแล้ว/);
  assert.equal(st(sqlite,b.id).f,"ready_ship");
});

test("synthetic seed orders (TEST- ids) can be handled from the Admin; other id shapes are still not routed (R5)",async()=>{
  const {env,ctx}=await setup();
  const list=await (await call(worker,env,ctx,"/api/admin/orders")).json(),t=list.orders.find(o=>o.id.startsWith("TEST-")&&o.status===S.PENDING);
  assert.ok(t,"the seed has a pending TEST- order");
  const r=await call(worker,env,ctx,"/api/admin/orders/"+t.id+"/status",{method:"POST",body:{from:S.PENDING,to:S.CANCEL}});
  assert.equal(r.status,200);assert.equal((await r.json()).changed,true);
  assert.equal((await call(worker,env,ctx,"/api/admin/orders/XYZ-0001/status",{method:"POST",body:{from:S.PENDING,to:S.CANCEL}})).status,404);
  assert.equal((await call(worker,env,ctx,"/api/admin/orders/TEST-%2e%2e/status",{method:"POST",body:{from:S.PENDING,to:S.CANCEL}})).status,404);
});

test("admin assets: scripts and styles are re-validated on every load (no-cache); fonts and images stay cached",async()=>{
  const {env,ctx}=await setupV1();
  for(const f of ["style.css","orders-app.mjs","carriers.mjs"]){const r=await call(worker,env,ctx,"/admin/assets/"+f);assert.equal(r.status,200,f);assert.equal(r.headers.get("cache-control"),"private, no-cache",f)}
  for(const f of ["sarabun-thai-400-normal.woff2","norx-logo.png"]){const r=await call(worker,env,ctx,"/admin/assets/"+f);assert.equal(r.status,200,f);assert.equal(r.headers.get("cache-control"),"private, max-age=3600",f)}
});
