import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,existsSync,rmSync} from "node:fs";
import {execFileSync,spawnSync} from "node:child_process";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import * as imp from "../src/v1-import.mjs";
import * as core from "../src/orders-core.mjs";
import * as svc from "../src/orders-service.mjs";
import * as ex from "../src/v2-export.mjs";
import worker from "../src/orders-admin-worker.mjs";
import {setupV1,orderInput,call,NOW,T0,DAY} from "./helpers/orders-env.mjs";
// Rollback tool (Recovery R4; the earlier local version was lost with 7b20b5f). All data is SYNTHETIC.
const S=core.STATUS,CLOSED=T0+8*DAY,root=fileURLToPath(new URL("../",import.meta.url)),script=join(root,"scripts/export-v2-to-v1.mjs");
const ADDR='บ้านเลขที่ 9/1, "หมู่บ้านทดสอบ" ซอยสมมติ ตำบลทดสอบ อำเภอทดสอบ จังหวัดทดสอบ 57000';
const fx=f=>readFileSync(new URL("./fixtures/v1-anonymized/"+f,import.meta.url),"utf8");
const snap=n=>({orders:imp.readOrdersCsv(fx(`snapshot-${n}-orders.csv`)),rounds:imp.readRoundsCsv(fx(`snapshot-${n}-rounds.csv`))});
const mk=(env,o={},now=NOW)=>svc.submitOrder(env,orderInput({expectedTotal:980,...o}),{now});
const chk=async(result,original)=>{const c=await ex.verifyRoundTrip({result,original});return {ok:c.ok,errors:c.errors,diffs:c.diffs}};
const OK={ok:true,errors:[],diffs:[]};

// A V2 database that has lived through the whole flow: ship + pickup + on-site payment, cancel, partial receipt, hand-over, tracking, an order in another round.
async function lifecycle(){
  const s=await setupV1(),{env,ctx}=s;
  const a=await mk(env,{delivery:"ship",address:ADDR,name:"=ทดสอบ นามสมมติ",expectedTotal:1030}),b=await mk(env,{delivery:"event"}),c=await mk(env),d=await mk(env);
  const e=await mk(env,{roundId:"ROUND-002"},T0+8*DAY);
  const mv=(o,from,to,x={})=>svc.changeStatus(env,"adm",{orderNo:o.id,from,to,now:NOW,...x});
  await mv(a,S.PENDING,S.PAID,{amount:1030});await mv(c,S.PENDING,S.PAID,{amount:980});await mv(b,S.PENDING,S.LATER);await mv(d,S.PENDING,S.CANCEL);
  await svc.closeRound(env,"adm","ROUND-001");await svc.sendToShop(env,"adm","ROUND-001",6,CLOSED);
  await svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"batched",to:"produced",expected:6,now:CLOSED});
  await svc.setItemsStatus(env,"adm",{round:"ROUND-001",from:"produced",to:"received",expected:6,now:CLOSED});
  await svc.changeStatus(env,"adm",{orderNo:c.id,from:S.SENT,to:S.DONE,now:CLOSED});
  await svc.changeStatus(env,"adm",{orderNo:b.id,from:S.LATER,to:S.DONE,amount:980,now:CLOSED}); // A39: money and shirts together
  const r=await call(worker,env,ctx,"/api/admin/shipments/batch",{method:"POST",body:{rows:[{orderNo:a.id,provider:"Flash Express",trackingNo:"TH0123456789AA"}],shippedAt:"2026-12-12"}});assert.equal(r.status,200);
  return {...s,ids:{a:a.id,b:b.id,c:c.id,d:d.id,e:e.id}};
}

test("rollback export of a full V2 life-cycle: the V1 CSV re-imports with 0 errors and reconciles with V2 (0 diff)",async()=>{
  const {env,ids}=await lifecycle(),state=await ex.readExportState(env.ORDERS_DB);
  assert.equal(state.orders.length,5);
  const res=await ex.exportRollback({...state,scope:"all",now:CLOSED});
  assert.deepEqual(await chk(res,state),OK);
  const rows=imp.readOrdersCsv(res.files.orders),by=id=>rows.find(r=>r.id===id);
  assert.equal(rows.length,5);
  assert.equal(by(ids.a).name,"'=ทดสอบ นามสมมติ","text that a spreadsheet could read as a formula is defused with ' (the importer strips exactly one)");
  assert.equal(by(ids.a).address,ADDR,"commas and quotes survive CSV quoting");
  assert.deepEqual(rows.map(r=>r.status).sort(),[S.CANCEL,S.PENDING,S.DONE,S.DONE,S.SENT].sort(),"statuses as V1 knows them");
  assert.equal(by(ids.a).status,S.SENT,"shipped → V1 can only say ส่งร้านแล้ว");assert.equal(by(ids.b).status,S.DONE);assert.equal(by(ids.d).status,S.CANCEL);assert.equal(by(ids.e).status,S.PENDING);
  const det=JSON.parse(by(ids.a).details);assert.equal(det.items[0].lineTotal,det.items[0].qty*det.items[0].unitPrice);assert.ok(det.round.paymentDue);
  const m=res.manifest;
  assert.equal(m.orders.rows,5);assert.deepEqual(m.orders.append.length+m.orders.full,5);
  assert.equal(m.totals.total,state.orders.reduce((n,o)=>n+o.total_baht,0));assert.equal(m.totals.pieces,10);
  assert.deepEqual(m.totals.byV1Status,{[S.SENT]:1,[S.DONE]:2,[S.CANCEL]:1,[S.PENDING]:1});
  assert.equal(m.cannotHold.ordersWithTracking,1,"the tracking number lives only in D1");
  assert.equal(m.cannotHold.ordersWithReceiptProgress,3);assert.equal(m.cannotHold.onSitePayments,1);assert.equal(m.cannotHold.exportedOrdersWhoseFinerStatusIsCollapsed,1);
  assert.ok(!/ทดสอบ นามสมมติ|0800000000/.test(res.files.manifest),"manifest holds ids and counts only, no customer data");
  assert.equal(m.csv.orders.rows,5);assert.match(m.csv.orders.sha256,/^[0-9a-f]{64}$/);
  // the same CSV loads into a fresh V2 (re-cutover after a rollback) and reconciles
  const {env:env2}=await setupV1({rounds:false});
  const p=await imp.planSync({orders:rows,rounds:imp.readRoundsCsv(res.files.rounds),state:await imp.readState(env2.ORDERS_DB),mode:"safe",now:CLOSED});
  assert.equal(p.ok,true,JSON.stringify(p.errors.slice(0,3)));await imp.runSync(env2.ORDERS_DB,p.plan,{dryRun:false});
  assert.deepEqual(await imp.reconcileState(p.plan,await imp.readState(env2.ORDERS_DB)),{ok:true,diffs:[],orphans:[],v2NativeOrders:0});
});

test("rollback delta after cutover: V2-born orders are appended, imported orders changed in V2 are replaced, untouched imports and test orders stay out",async()=>{
  const {env,sqlite}=await setupV1({rounds:false});
  const first=await imp.planSync({...snap(1),state:await imp.readState(env.ORDERS_DB),mode:"safe",now:CLOSED});assert.equal(first.ok,true);await imp.runSync(env.ORDERS_DB,first.plan,{dryRun:false});
  const q=async(o={})=>ex.exportRollback({...(await ex.readExportState(env.ORDERS_DB)),...o});
  const idle=await q();assert.deepEqual([idle.manifest.orders.rows,idle.manifest.rounds.rows,idle.manifest.v2.unchangedSinceImport,idle.manifest.v2.excludedTest,idle.manifest.v2.imported],[0,0,34,1,35],"right after import nothing needs to go back (the fixture has 1 synthetic test order)");
  const W=Date.parse("2026-11-18T05:00:00Z"),pending=snap(1).orders.find(o=>o.roundId==="ROUND-003"&&o.status===S.PENDING&&o.delivery==="city");
  await svc.changeStatus(env,"adm",{orderNo:pending.id,from:S.PENDING,to:S.PAID,amount:Number(pending.total),now:W}); // an imported order changed in V2
  const born=await mk(env,{roundId:"ROUND-003"},W);                                                                // an order born in V2
  const synthetic=await mk(env,{roundId:"ROUND-003"},W);sqlite.prepare("UPDATE orders SET is_test=1 WHERE order_no=?").run(synthetic.id);
  const state=await ex.readExportState(env.ORDERS_DB),res=await ex.exportRollback({...state,now:W});
  assert.deepEqual(res.manifest.orders.append,[born.id]);assert.deepEqual(res.manifest.orders.replace,[pending.id]);
  assert.deepEqual([res.manifest.v2.excludedTest,res.manifest.v2.unchangedSinceImport,res.manifest.v2.v2Born],[2,33,2],"2 test orders (1 imported fixture + 1 new), 33 untouched imports");
  assert.equal(res.manifest.rounds.rows,0,"no round changed, V1 already has them");assert.deepEqual(res.manifest.rounds.referencedByOrders,["ROUND-003"]);
  assert.equal(imp.readOrdersCsv(res.files.orders).find(r=>r.id===pending.id).status,S.PAID);
  assert.deepEqual(await chk(res,state),OK);
  const withTest=await ex.exportRollback({...state,includeTest:true,now:W});
  assert.deepEqual(withTest.manifest.orders.append.sort(),[born.id,synthetic.id].sort());assert.equal(imp.readOrdersCsv(withTest.files.orders).find(r=>r.id===synthetic.id).note,"ทดสอบ");
  assert.deepEqual(await chk(withTest,state),OK);
  const all=await ex.exportRollback({...state,scope:"all",now:W});assert.equal(all.manifest.orders.rows,35,"37 orders minus 2 test orders");assert.equal(all.manifest.rounds.rows,3);assert.deepEqual(await chk(all,state),OK);
});

test("a V2 round that V1 never had is exported with its orders (state, times, deliveries, sent time)",async()=>{
  const {env,sqlite}=await setupV1();
  await mk(env);sqlite.prepare("UPDATE rounds SET status='closed' WHERE code='ROUND-001'").run();
  const state=await ex.readExportState(env.ORDERS_DB),res=await ex.exportRollback({...state,now:NOW});
  assert.deepEqual(res.manifest.rounds.append,["ROUND-001","ROUND-002"]);
  const r=imp.readRoundsCsv(res.files.rounds).find(x=>x.id==="ROUND-001");assert.equal(r.state,"ปิดรับ");assert.equal(r.deliveries,"city,event,ship");assert.equal(r.shipping,"50");
  assert.deepEqual(await chk(res,state),OK);
});

test("the check is not decorative: a corrupted export is caught (money, status, missing column)",async()=>{
  const {env}=await lifecycle(),state=await ex.readExportState(env.ORDERS_DB),res=await ex.exportRollback({...state,scope:"all",now:CLOSED});
  const rows=imp.readOrdersCsv(res.files.orders),t=rows.findIndex(r=>r.status===S.DONE); // row order is not fixed (ids are random): always tamper with a delivered order
  assert.ok(t>=0);
  const tamper=(f)=>({...res,files:{...res.files,orders:imp.ordersToCsv(rows.map((r,i)=>(i===t?f({...r}):r)))}});
  const money=await ex.verifyRoundTrip({result:tamper(r=>({...r,total:String(Number(r.total)+10),shipping:String(Number(r.shipping)+10)})),original:state});
  assert.equal(money.ok,false);assert.ok(money.diffs.some(d=>/total/.test(d.check)));
  const status=await ex.verifyRoundTrip({result:tamper(r=>({...r,status:S.CANCEL})),original:state});assert.equal(status.ok,false);assert.ok(status.diffs.some(d=>d.check==="status"||/status/.test(d.check)));
  const name=await ex.verifyRoundTrip({result:tamper(r=>({...r,phone:"0800000001"})),original:state});assert.equal(name.ok,false);assert.ok(name.diffs.some(d=>d.check==="phone"));
  const broken=await ex.verifyRoundTrip({result:tamper(r=>({...r,status:"สถานะไม่มีจริง"})),original:state});assert.equal(broken.ok,false);assert.match(JSON.stringify(broken.errors),/unknown V1 status/);
  await assert.rejects(ex.verifyRoundTrip({result:{...res,files:{...res.files,orders:"a,b\n1,2\n"}},original:state}),/missing columns/);
});

test("wrangler output (with or without banner lines) and plain arrays are read the same way",()=>{
  const rows=[{order_no:"NORX-AAAAAAAA"}],wr=JSON.stringify([{results:[{j:JSON.stringify(rows)}],success:true,meta:{}}]);
  assert.deepEqual(ex.parseRows(wr),rows);assert.deepEqual(ex.parseRows("\n ⛅️ wrangler 4.168.0\n────\n[WARNING] something\n"+wr),rows);assert.deepEqual(ex.parseRows(JSON.stringify(rows)),rows);
  assert.deepEqual(ex.parseRows(JSON.stringify([{results:[{j:null}]}])),[]);assert.throws(()=>ex.parseRows("no json here"),/no JSON/);assert.throws(()=>ex.parseRows('{"a":1}'),/array/);
});

test("command line: --print-sql, end-to-end export from wrangler-style JSON, refuses to write customer data into tracked repo folders",async()=>{
  const sql=execFileSync(process.execPath,[script,"--print-sql"],{encoding:"utf8"});assert.match(sql,/-- orders[\s\S]*json_group_array[\s\S]*-- rounds[\s\S]*-- products/);
  assert.ok(!/\b(UPDATE|INSERT|DELETE|DROP|ALTER|CREATE|ATTACH|PRAGMA|REPLACE)\b/i.test(sql),"read-only statements only");
  assert.ok(sql.split("\n").filter(l=>l&&!l.startsWith("--")).every(l=>/^SELECT /.test(l)),"every statement is a SELECT");
  const {env}=await lifecycle(),state=await ex.readExportState(env.ORDERS_DB),dir=mkdtempSync(join(tmpdir(),"norx-rollback-"));
  try{
    const wr=v=>JSON.stringify([{results:[{j:JSON.stringify(v)}],success:true}]);
    for(const [k,v] of Object.entries(state))writeFileSync(join(dir,k+".json"),wr(v));
    const args=["--orders",join(dir,"orders.json"),"--rounds",join(dir,"rounds.json"),"--products",join(dir,"products.json"),"--out",join(dir,"out"),"--all"];
    const ok=spawnSync(process.execPath,[script,...args],{encoding:"utf8"});
    assert.equal(ok.status,0,ok.stdout+ok.stderr);assert.match(ok.stdout,/ROUND-TRIP OK/);assert.match(ok.stdout,/orders: 5 rows/);
    for(const f of ["orders-v1.csv","rounds-v1.csv","manifest.json"])assert.ok(existsSync(join(dir,"out",f)),f);
    assert.equal(JSON.parse(readFileSync(join(dir,"out/manifest.json"),"utf8")).orders.rows,5);
    const bad=spawnSync(process.execPath,[script,...args.slice(0,-3),"--out",join(root,"docs/rollback-should-not-exist")],{encoding:"utf8"});
    assert.equal(bad.status,2);assert.match(bad.stderr,/\/private\/ or \/\.staging\//);assert.ok(!existsSync(join(root,"docs/rollback-should-not-exist")));
    const missing=spawnSync(process.execPath,[script],{encoding:"utf8"});assert.equal(missing.status,2);
  }finally{rmSync(dir,{recursive:true,force:true})}
});
