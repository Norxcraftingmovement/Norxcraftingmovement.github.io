import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import * as imp from "../src/v1-import.mjs";
import * as core from "../src/orders-core.mjs";
import * as svc from "../src/orders-service.mjs";
import {setupV1,d1} from "./helpers/orders-env.mjs";
const S=core.STATUS,PRODUCTS=["drop03","drop02"];
const fx=f=>readFileSync(new URL("./fixtures/v1-anonymized/"+f,import.meta.url),"utf8");
const snap=n=>({orders:imp.readOrdersCsv(fx(`snapshot-${n}-orders.csv`)),rounds:imp.readRoundsCsv(fx(`snapshot-${n}-rounds.csv`))});
const state=async env=>imp.readState(env.ORDERS_DB);
const sync=async(env,n,mode="safe",{apply=true}={})=>{const s=snap(n),p=await imp.planSync({...s,state:await state(env),mode,now:Date.parse("2026-12-01T00:00:00Z")});assert.equal(p.ok,true,JSON.stringify(p.errors.slice(0,3)));if(apply)await imp.runSync(env.ORDERS_DB,p.plan,{dryRun:false});return p};
const dump=sqlite=>JSON.stringify(["orders","order_items","shipping_addresses","payments","order_status_history","rounds","audit_log"].map(t=>sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));
const fresh=()=>setupV1({rounds:false});
const legacy=(sqlite,no)=>{const r=sqlite.prepare("SELECT payment_status p,fulfillment_status f FROM orders WHERE order_no=?").get(no);return r&&core.toLegacy(r.p,r.f)};

test("D19 fixtures are anonymised: no personal data, CSV round-trips, ids/status/money survive",()=>{
  const a=snap(1);assert.equal(a.orders.length,35);assert.equal(a.rounds.length,3);
  const text=fx("snapshot-1-orders.csv")+fx("snapshot-2-orders.csv");
  assert.ok(!/PII-|@|0899\d{6}/.test(text),"no names/emails/real-looking phones");
  assert.ok(a.orders.every(o=>/^0800\d{6}$/.test(o.phone)&&/^ลูกค้าทดสอบ \d{4}$/.test(o.name)));
  assert.ok(a.orders.some(o=>o.id.startsWith("NORX-LEGACY-")));assert.deepEqual([...new Set(a.orders.map(o=>o.status))].sort(),[...Object.values(S),"เห็นยอดแล้ว"].sort());
  assert.deepEqual(imp.readOrdersCsv(imp.ordersToCsv(a.orders)),a.orders,"CSV write→read is lossless (quotes, commas, newlines, Thai)");
  assert.throws(()=>imp.readOrdersCsv("a,b\n1,2"),/missing columns/);
});
test("anonymiser removes every personal field, keeps structure, recomputes a consistent fingerprint, is deterministic",async()=>{
  const row={id:"NORX-ABCDEF12",requestId:"req-abcdefghijklmnop",fingerprint:"old",createdAt:"2026-12-02T10:00:00.000Z",roundId:"ROUND-001",name:"สมชาย จริงใจ",phone:"0891234567",delivery:"ship",address:"12/3 ซอยลับ ถนนจริง ตำบลจริง จังหวัดจริง 57000",subtotal:490,shipping:50,total:540,status:S.PAID,updatedAt:"2026-12-03T10:00:00.000Z",updatedBy:"person@example.com",
    details:JSON.stringify({items:[{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:1,name:"N",fitName:"F",unitPrice:490,lineTotal:490}],round:{id:"ROUND-001"}}),note:"ลูกค้าโทรมาขอเลื่อน"};
  const [a]=await imp.anonymizeOrders([row]),[b]=await imp.anonymizeOrders([row]);
  assert.deepEqual(a,b);const t=JSON.stringify(a);
  for(const leak of ["สมชาย","0891234567","ซอยลับ","person@example","ลูกค้าโทร"])assert.ok(!t.includes(leak),leak);
  assert.equal(a.id,row.id);assert.equal(a.total,540);assert.equal(a.status,S.PAID);assert.match(a.address,/57000$/);assert.equal(a.note,"หมายเหตุ");
  const fp=await core.fingerprint({requestId:row.requestId,roundId:"ROUND-001",name:a.name,phone:a.phone,delivery:"ship",address:a.address,items:[{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:1}],preorder:true,sizing:true,privacy:true});
  assert.equal(a.fingerprint,fp);
});
test("first import of snapshot 1: all rows in, reconciliation = 0 diff, payments consistent; second run is a no-op",async()=>{
  const {env,sqlite}=await fresh();const p=await sync(env,1);
  assert.equal(p.plan.report.inserted.length,35);assert.equal(p.plan.report.roundsInserted.length,3);
  const st=await state(env);const r=await imp.reconcileState(p.plan,st);assert.deepEqual(r,{ok:true,diffs:[],orphans:[],v2NativeOrders:0});
  assert.deepEqual(await svc.paymentIntegrity(env),[]);
  const before=dump(sqlite),p2=await sync(env,1);
  assert.equal(p2.plan.orders.length+p2.plan.rounds.length,0);assert.equal(p2.plan.report.unchanged.length,35);assert.equal(dump(sqlite),before);
});
test("P0 DELTA: V1 changed after the first import → final sync updates orders and rounds, reconciles every important field",async()=>{
  const {env,sqlite}=await fresh();await sync(env,1);
  const s1=snap(1),s2=snap(2),byId=(s)=>new Map(s.orders.map(o=>[o.id,o]));
  const m1=byId(s1),m2=byId(s2);
  const changed=[...m2.keys()].filter(k=>m1.has(k)&&(m1.get(k).status!==m2.get(k).status||m1.get(k).address!==m2.get(k).address||m1.get(k).details!==m2.get(k).details||m1.get(k).total!==m2.get(k).total));
  const added=[...m2.keys()].filter(k=>!m1.has(k)),removed=[...m1.keys()].filter(k=>!m2.has(k));
  assert.ok(changed.length>=10&&added.length===3&&removed.join()==="NORX-LEGACY-002");
  const p=await sync(env,2,"safe",{apply:false}),R=p.plan.report;
  assert.deepEqual(R.updated.sort(),changed.sort());assert.deepEqual(R.inserted.sort(),added.sort());assert.deepEqual(R.orphans,removed);
  assert.deepEqual(R.conflicts,[]);assert.deepEqual(R.roundsUpdated.sort(),["ROUND-002","ROUND-003"]);assert.equal(p.needsAttention,false);
  await imp.runSync(env.ORDERS_DB,p.plan,{dryRun:false});
  // field-level spot checks of what changed
  for(const id of changed)assert.equal(legacy(sqlite,id),core.legacyStatus(m2.get(id).status),id);
  const addrChanged=changed.find(k=>m1.get(k).address!==m2.get(k).address&&m2.get(k).delivery==="ship");
  assert.equal(sqlite.prepare("SELECT a.address a FROM shipping_addresses a JOIN orders o ON o.id=a.order_id WHERE o.order_no=?").get(addrChanged).a,m2.get(addrChanged).address);
  const qtyChanged=changed.find(k=>m1.get(k).details!==m2.get(k).details);
  const qty=JSON.parse(m2.get(qtyChanged).details).items.reduce((n,i)=>n+i.qty,0);assert.equal(sqlite.prepare("SELECT SUM(qty) q FROM order_items WHERE order_id=(SELECT id FROM orders WHERE order_no=?)").get(qtyChanged).q,qty);
  assert.equal(sqlite.prepare("SELECT status s FROM rounds WHERE code='ROUND-002'").get().s,"sent");
  assert.equal(sqlite.prepare("SELECT closes_at c FROM rounds WHERE code='ROUND-003'").get().c,new Date("2026-11-23T23:59:00+07:00").toISOString());
  // orphan is KEPT, reported, never deleted
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM orders WHERE order_no='NORX-LEGACY-002'").get().n,1);
  const st=await state(env),rec=await imp.reconcileState(p.plan,st);
  assert.equal(rec.ok,true,JSON.stringify(rec.diffs.slice(0,3)));assert.deepEqual(rec.orphans,["NORX-LEGACY-002"]);
  assert.deepEqual(await svc.paymentIntegrity(env),[],"payments follow every status change (voided/added)");
  assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM order_status_history WHERE actor='v1_delta_sync'").get().n>=changed.length);
  assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='order.v1_sync'").get().n>=changed.length);
  // totals line up with V1 snapshot 2 for money and pieces
  const v1sum=f=>[...m2.values()].filter(o=>o.id!=="NORX-LEGACY-002").reduce((n,o)=>n+f(o),0);
  assert.equal(sqlite.prepare("SELECT SUM(total_baht) t FROM orders WHERE order_no!='NORX-LEGACY-002'").get().t,v1sum(o=>+o.total));
});
test("delta sync is idempotent: re-applying the same plan or SQL changes nothing; a new plan has no operations",async()=>{
  const {env,sqlite}=await fresh();await sync(env,1);const p=await sync(env,2);const after=dump(sqlite);
  await imp.runSync(env.ORDERS_DB,p.plan,{dryRun:false});await imp.runSync(env.ORDERS_DB,p.plan,{dryRun:false});
  assert.equal(dump(sqlite),after,"re-running the same statements is a no-op");
  const sql=imp.renderSql(p.plan);sqlite.exec("BEGIN");sqlite.exec(sql);sqlite.exec("COMMIT");assert.equal(dump(sqlite),after,"re-running the rendered SQL is a no-op");
  const p3=await sync(env,2,"safe",{apply:false});assert.equal(p3.plan.orders.length+p3.plan.rounds.length,0);
});
test("offline pipeline: rendered SQL (for wrangler d1 execute --file) yields exactly the same database as direct apply",async()=>{
  const a=await fresh(),b=await fresh();
  await sync(a.env,1);await sync(a.env,2);
  for(const n of [1,2]){const p=await imp.planSync({...snap(n),state:await state(b.env),now:Date.parse("2026-12-01T00:00:00Z")});assert.equal(p.ok,true);const sql=imp.renderSql(p.plan);assert.ok(!/\?\d/.test(sql),"no unbound parameters");b.sqlite.exec(sql)}
  assert.deepEqual(await state(a.env),await state(b.env));
  const rec=await imp.reconcileState((await imp.planSync({...snap(2),state:await state(b.env)})).plan,await state(b.env));assert.equal(rec.ok,true);
});
test("conflicts: V2-side edits are protected in safe mode; v1-wins (final sync during V1 freeze) overwrites with an audit trail",async()=>{
  const {env,sqlite}=await fresh();await sync(env,1);const s1=snap(1),s2=snap(2);
  const m1=new Map(s1.orders.map(o=>[o.id,o])),m2=new Map(s2.orders.map(o=>[o.id,o]));
  const both=[...m2.keys()].find(k=>m1.has(k)&&m1.get(k).status===S.PENDING&&m2.get(k).status===S.PAID);   // changed in V1 …
  const localOnly=[...m1.keys()].find(k=>m1.has(k)&&m2.has(k)&&m1.get(k).details===m2.get(k).details&&m1.get(k).status===m2.get(k).status&&m1.get(k).status===S.PENDING&&k!==both); // unchanged in V1
  assert.ok(both&&localOnly);
  // … and edited in V2 by someone
  await svc.changeStatus(env,"adm",{orderNo:both,from:S.PENDING,to:S.LATER,now:Date.now()});
  await svc.changeStatus(env,"adm",{orderNo:localOnly,from:S.PENDING,to:S.LATER,now:Date.now()});
  const safe=await sync(env,2,"safe",{apply:false});
  assert.deepEqual(safe.plan.report.conflicts.map(c=>c.order),[both]);assert.deepEqual(safe.plan.report.localChanges,[localOnly]);assert.equal(safe.needsAttention,true);
  await imp.runSync(env.ORDERS_DB,safe.plan,{dryRun:false});
  assert.equal(legacy(sqlite,both),S.LATER,"V2 edit kept");assert.equal(legacy(sqlite,localOnly),S.LATER,"V2 edit kept");
  const rec=await imp.reconcileState(safe.plan,await state(env));assert.ok(rec.diffs.some(d=>d.order===both&&d.check==="status"),"reconciliation still reports the difference");
  const wins=await sync(env,2,"v1-wins");
  assert.equal(legacy(sqlite,both),S.PAID);assert.equal(legacy(sqlite,localOnly),S.PENDING,"V1 is authoritative at final sync");
  assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='order.v1_overwrite'").get().n>=2);
  assert.equal((await imp.reconcileState(wins.plan,await state(env))).ok,true);assert.deepEqual(await svc.paymentIntegrity(env),[]);
});
test("stale plan: if V2 changes between planning and applying, the guarded UPDATE does not overwrite it",async()=>{
  const {env,sqlite}=await fresh();await sync(env,1);
  const m1=new Map(snap(1).orders.map(o=>[o.id,o])),m2=new Map(snap(2).orders.map(o=>[o.id,o]));
  const k=[...m2.keys()].find(x=>m1.has(x)&&m1.get(x).status===S.PENDING&&m2.get(x).status===S.PAID);
  const p=await sync(env,2,"safe",{apply:false});
  await svc.changeStatus(env,"adm",{orderNo:k,from:S.PENDING,to:S.LATER,now:Date.now()}); // V2 edit lands after the plan was made
  const hash=sqlite.prepare("SELECT import_hash h FROM orders WHERE order_no=?").get(k).h;
  await imp.runSync(env.ORDERS_DB,p.plan,{dryRun:false});
  assert.equal(legacy(sqlite,k),S.LATER,"stale update skipped");
  assert.equal(sqlite.prepare("SELECT import_hash h FROM orders WHERE order_no=?").get(k).h,hash,"marker untouched");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payments WHERE status='confirmed' AND order_id=(SELECT id FROM orders WHERE order_no=?)").get(k).n,0,"no payment created from a skipped update");
});
test("V2-native orders and orphans are reported, never touched; V2 production progress on untouched items survives a sync",async()=>{
  const {env,sqlite}=await fresh();await sync(env,1);
  const p0=await imp.planSync({...snap(1),state:await state(env)});
  sqlite.exec(`UPDATE order_items SET production_status='produced' WHERE order_id IN (SELECT id FROM orders WHERE order_no IN (SELECT order_no FROM orders WHERE fulfillment_status='in_production' LIMIT 3))`);
  const p=await sync(env,2);
  assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM order_items WHERE production_status='produced'").get().n>0,"progress kept where items did not change");
  sqlite.exec("INSERT INTO rounds(code,name,opens_at,closes_at,payment_due_at,deliveries,status) VALUES ('ROUND-900','native','2026-12-01T00:00:00.000Z','2026-12-02T00:00:00.000Z','2026-12-03T00:00:00.000Z','[\"city\"]','open')");
  const nat=await svc.submitOrder(env,{requestId:"native-order-abcdefghij",roundId:"ROUND-900",name:"ทดสอบ นามสมมติ",phone:"0800000000",delivery:"city",address:"",items:[{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:1}],preorder:true,sizing:true,privacy:true,expectedTotal:490},{now:Date.parse("2026-12-01T12:00:00Z")});
  const rec=await imp.reconcileState(p.plan,await state(env));
  assert.equal(rec.v2NativeOrders,1,"orders accepted by V2 before cutover are surfaced");assert.ok(nat.ok);assert.equal(rec.ok,true);
});
test("reconciliation detects tampering of every important field",async()=>{
  const cases=[["status","UPDATE orders SET payment_status='pending' WHERE order_no=(SELECT order_no FROM orders WHERE payment_status='confirmed' AND fulfillment_status='received' LIMIT 1)"],
    ["name","UPDATE orders SET customer_name='x' WHERE id=1"],["phone","UPDATE orders SET customer_phone='0811111111' WHERE id=1"],["delivery","UPDATE orders SET delivery='event' WHERE id=1"],
    ["address","UPDATE shipping_addresses SET address='เปลี่ยน' WHERE order_id=(SELECT order_id FROM shipping_addresses LIMIT 1)"],["items","UPDATE order_items SET qty=qty+1 WHERE id=1"],
    ["items","UPDATE order_items SET unit_price_baht=unit_price_baht+1 WHERE id=1"],["note","UPDATE orders SET note='x' WHERE id=1"],["req","UPDATE orders SET request_key='zzzzzzzzzzzzzzzzz' WHERE id=1"],
    ["fp","UPDATE orders SET fingerprint='zz' WHERE id=1"],["created","UPDATE orders SET created_at='2020-01-01T00:00:00.000Z' WHERE id=1"],["due","UPDATE orders SET payment_due_at='2020-01-01T00:00:00.000Z' WHERE id=1"],
    ["payments","UPDATE payments SET status='void' WHERE id=1"],["status","UPDATE orders SET fulfillment_status='received' WHERE fulfillment_status='completed' AND id=(SELECT MIN(id) FROM orders WHERE fulfillment_status='completed')"],
    ["order count","DELETE FROM payments WHERE order_id=2;DELETE FROM order_items WHERE order_id=2;DELETE FROM order_status_history WHERE order_id=2;DELETE FROM orders WHERE id=2"],
    ["ship","UPDATE rounds SET shipping_baht=99 WHERE code='ROUND-001'"],["sent","UPDATE rounds SET sent_at=NULL WHERE code='ROUND-001'"],["status","UPDATE rounds SET status='open' WHERE code='ROUND-002'"],["closes","UPDATE rounds SET closes_at='2030-01-01T00:00:00.000Z' WHERE code='ROUND-003'"]];
  for(const [expect,sql] of cases){
    const {env,sqlite}=await fresh();const p=await sync(env,1);sqlite.exec("PRAGMA foreign_keys=OFF");sqlite.exec("PRAGMA ignore_check_constraints=ON");sqlite.exec(sql);
    const rec=await imp.reconcileState(p.plan,await state(env));assert.equal(rec.ok,false,sql);
    assert.ok(rec.diffs.some(d=>String(d.check).includes(expect)||d.check==="order count"||d.check==="piece count"),expect+" in "+JSON.stringify(rec.diffs.map(d=>d.check)));
  }
});
