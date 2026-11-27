import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import * as v2 from "../src/orders-core.mjs";
import {build,loadV1Core} from "../scripts/gen-v1-golden.mjs";
const rt=x=>JSON.parse(JSON.stringify(x));
const golden=JSON.parse(readFileSync(new URL("./fixtures/v1-golden.json",import.meta.url),"utf8"));
const v2core={...v2};

test("V2 core reproduces every recorded V1 output (normalize, errors, quote, fingerprint, rounds, summary, moves, receipt)",()=>{
  const out=rt(build(v2core));
  for(const k of Object.keys(golden.cases)){
    assert.equal(out.cases[k].length,golden.cases[k].length,k+" count");
    out.cases[k].forEach((c,i)=>assert.deepStrictEqual(c,golden.cases[k][i],k+" #"+i));
  }
  assert.ok(golden.cases.normalize.some(c=>c.error)&&golden.cases.normalize.some(c=>c.out),"golden has both accepted and rejected inputs");
});
test("golden fixture covers the behaviours the owner confirmed",()=>{
  const q=golden.cases.quote.filter(c=>c.out);
  assert.ok(q.some(c=>c.out.shipping>0&&c.normalized.delivery==="ship"),"shipping charged for ship");
  assert.ok(q.filter(c=>c.normalized.delivery!=="ship").every(c=>c.out.shipping===0),"city/event pickup free");
  assert.ok(q.every(c=>c.out.total===c.out.subtotal+c.out.shipping));
  assert.ok(golden.cases.rounds.some(c=>c.successorOf),"rolling weekly successors");
  const s=golden.cases.summary.find(c=>c.out.laterOrders>0);assert.ok(s,"has deferred on-site orders");
  const laterOnly=s.orders.filter(o=>o.status==="จ่ายหน้างาน"&&o.roundId===s.round.id).reduce((n,o)=>n+o.total,0);
  assert.equal(s.out.laterAmount,laterOnly);
  const paid=s.orders.filter(o=>["ชำระแล้ว","ส่งร้านแล้ว","ส่งมอบแล้ว"].includes(o.status)&&o.roundId===s.round.id).reduce((n,o)=>n+o.total,0);
  assert.equal(s.out.revenue,paid,"deferred on-site excluded from revenue");
});
test("differential vs live V1 source when NORX_V1_SOURCE is set (local only)",{skip:!process.env.NORX_V1_SOURCE||!existsSync(process.env.NORX_V1_SOURCE||"")},()=>{
  const v1=rt(build(loadV1Core(process.env.NORX_V1_SOURCE))),out=rt(build(v2core));
  assert.deepStrictEqual(out,v1);
});
test("two-axis status mapping is lossless for all six V1 statuses; deferred on-site is not paid",()=>{
  for(const s of Object.values(v2.STATUS)){const m=v2.FROM_LEGACY[s];assert.ok(m,s);assert.equal(v2.toLegacy(m.payment,m.fulfillment),s,s)}
  assert.notEqual(v2.FROM_LEGACY[v2.STATUS.LATER].payment,"confirmed");
  assert.equal(v2.PAID_LIKE.includes(v2.STATUS.LATER),false);
  assert.equal(v2.toLegacy("confirmed","ready_ship"),v2.STATUS.SENT); // later V2 fulfillment steps still read as "ส่งร้านแล้ว" to V1
  assert.equal(v2.legacyStatus("เห็นยอดแล้ว"),v2.STATUS.PAID);
});
test("admin transition rules match V1 setOrderStatus",()=>{
  const S=v2.STATUS,mk=(status,total=980)=>({id:"NORX-AAAA0001",status,total}),rd=(state)=>({state});
  const t=(o)=>()=>v2.checkTransition(o);
  assert.doesNotThrow(t({order:mk(S.PENDING),round:rd("open"),from:S.PENDING,to:S.PAID,amount:980}));
  assert.throws(t({order:mk(S.PENDING),round:rd("open"),from:S.PENDING,to:S.PAID,amount:979}),/ยอดเงินไม่ตรง/);
  assert.throws(t({order:mk(S.PAID),round:rd("open"),from:S.PENDING,to:S.PAID,amount:980}),/ถูกเปลี่ยนเป็น "ชำระแล้ว" แล้ว/);     // stale view
  assert.throws(t({order:mk(S.PENDING),round:rd("open"),from:S.PENDING,to:S.SENT}),/ไม่ได้/);                                         // illegal move
  assert.throws(t({order:mk(S.PENDING),round:rd("sent"),from:S.PENDING,to:S.CANCEL}),/ส่งร้านแล้ว เปลี่ยนสถานะนี้ไม่ได้/);
  assert.throws(t({order:mk(S.LATER),round:rd("closed"),from:S.LATER,to:S.DONE,amount:980}),/ยังไม่ได้ส่งร้าน/);
  assert.doesNotThrow(t({order:mk(S.LATER),round:rd("sent"),from:S.LATER,to:S.DONE,amount:980}));
  assert.doesNotThrow(t({order:mk(S.SENT),round:rd("sent"),from:S.SENT,to:S.DONE}));  // no amount needed after sent to shop
  assert.doesNotThrow(t({order:mk(S.PENDING),round:rd("open"),from:S.PENDING,to:S.LATER}));
  assert.throws(t({order:mk(S.LATER),round:rd("open"),from:S.LATER,to:S.SENT}),/ไม่ได้/); // on-site orders are not "sent" by moving, only by round cut-off
});
