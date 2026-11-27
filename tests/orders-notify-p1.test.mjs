import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/orders-admin-worker.mjs";
import * as svc from "../src/orders-service.mjs";
import {dispatchDue,makeProvider,makeEmailProvider,renderOrderAlert,notificationReadiness,BACKOFF_MS} from "../src/orders-notify.mjs";
import {setupV1,orderInput,call,NOW} from "./helpers/orders-env.mjs";
const row=(sqlite)=>sqlite.prepare("SELECT * FROM notification_queue ORDER BY id").all();
const mk=env=>svc.submitOrder(env,orderInput(),{now:NOW});

test("P1: provider succeeds but the Worker stops before SENT is recorded → reclaimed, retried with the SAME idempotency key and a duplicate warning, then sent",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);const calls=[];
  const provider=async(r,meta)=>{calls.push({id:r.id,...meta})};
  // Simulate the Worker being killed right after the provider returned: every write that marks SENT fails.
  const real=env.ORDERS_DB.batch;
  env.ORDERS_DB.batch=async l=>{throw new Error("Worker terminated")};
  await assert.rejects(dispatchDue(env,provider,{now:NOW+1000}),/Worker terminated/);
  env.ORDERS_DB.batch=real;
  assert.equal(calls.length,1);assert.equal(calls[0].possibleDuplicate,false);
  let q=row(sqlite)[0];assert.equal(q.status,"sending");assert.ok(q.provider_called_at,"call was recorded BEFORE the provider ran");
  // not reclaimed while the lock is fresh
  assert.equal((await dispatchDue(env,provider,{now:NOW+2000})).claimed,0);assert.equal(calls.length,1);
  // later: stale lock → failure logged as unconfirmed, marked possible duplicate, retried after backoff
  const t=NOW+6*60e3;const s=await dispatchDue(env,provider,{now:t});assert.equal(s.reclaimed,1);
  q=row(sqlite)[0];assert.equal(q.status,"failed");assert.equal(q.possible_duplicate,1);assert.equal(q.attempts,1);
  assert.match(sqlite.prepare("SELECT error e FROM notification_failures").get().e,/delivery unconfirmed.*possible duplicate/);
  assert.equal((await dispatchDue(env,provider,{now:t+BACKOFF_MS[0]-1})).claimed,0,"respects backoff");
  const s2=await dispatchDue(env,provider,{now:t+BACKOFF_MS[0]});assert.equal(s2.sent,1);
  assert.equal(calls.length,2);assert.equal(calls[1].idempotencyKey,calls[0].idempotencyKey,"same key so the receiver can de-duplicate");assert.equal(calls[1].possibleDuplicate,true);
  q=row(sqlite)[0];assert.equal(q.status,"sent");assert.ok(q.sent_at);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM latency_log WHERE kind='notification'").get().n,1);
  assert.equal((await dispatchDue(env,provider,{now:t+99e9})).claimed,0,"never sent a third time");
});
test("P1: worker dies BEFORE calling the provider → plain retry, not flagged as duplicate",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);
  sqlite.prepare("UPDATE notification_queue SET status='sending', locked_at=?, provider_called_at=NULL").run(new Date(NOW-6*60e3).toISOString());
  const calls=[];const s=await dispatchDue(env,async(r,m)=>{calls.push(m)},{now:NOW});assert.equal(s.reclaimed,1);
  assert.equal(row(sqlite)[0].possible_duplicate,0);await dispatchDue(env,async(r,m)=>{calls.push(m)},{now:NOW+BACKOFF_MS[0]});
  assert.deepEqual(calls.map(c=>c.possibleDuplicate),[false]);
});
test("P1: ambiguous provider errors (timeout/abort) mark a possible duplicate; clear refusals do not",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);await mk(env);
  let n=0;const prov=async()=>{n++;if(n===1){const e=new Error("timed out");e.name="TimeoutError";throw e}throw new Error("550 mailbox unavailable")};
  await dispatchDue(env,prov,{now:NOW+1000});
  const [a,b]=row(sqlite);assert.deepEqual([a.status,a.possible_duplicate],["failed",1]);assert.deepEqual([b.status,b.possible_duplicate],["failed",0]);
});
test("D17: native email provider (mock binding) sends the V1 alert text with idempotency header; no network/DNS/service is touched",async()=>{
  const {env,sqlite}=await setupV1();const r=await mk(env);const sent=[];
  env.EMAIL={send:async m=>{sent.push(m)}};env.NOTIFY_FROM="alerts@example.test";env.ORDERS_ADMIN_URL="https://admin.example.test/admin/orders/";
  const f=globalThis.fetch;globalThis.fetch=async()=>{throw new Error("network must not be used")};
  try{
    const prov=makeProvider(env,async()=>"owner@example.test");
    assert.ok(prov);await dispatchDue(env,prov,{now:NOW+1000});
  }finally{globalThis.fetch=f}
  assert.equal(sent.length,1);const m=sent[0];
  assert.deepEqual([m.to,m.from],["owner@example.test","alerts@example.test"]);
  assert.equal(m.subject,"[NORX] "+r.id+" · 980 บาท");
  assert.match(m.text,new RegExp("ออเดอร์ใหม่ "+r.id));assert.match(m.text,/HOME TERRAIN EDITION \/ แขนสั้น \/ M × 2/);assert.match(m.text,/ยอดที่ต้องตรวจ 980 บาท/);assert.match(m.text,/ตรวจสลิปในเพจและเงินเข้าบัญชีก่อนยืนยัน/);assert.match(m.text,/admin\.example\.test/);
  assert.equal(m.headers["X-NORX-Idempotency-Key"],"norx-notification-1");assert.ok(!m.text.includes("ที่อยู่"),"no address in alert");
  assert.equal(row(sqlite)[0].status,"sent");
  assert.match(renderOrderAlert({orderNo:"X",name:"n",phone:"p",total:1,items:[]},{possibleDuplicate:true}).subject,/อาจซ้ำ/);
});
test("D17: email provider failures are logged WITHOUT e-mail addresses; missing recipient/sender fail clearly; readiness reports what is missing",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);
  env.EMAIL={send:async()=>{throw new Error("destination owner@example.test is not a verified address")}};env.NOTIFY_FROM="alerts@example.test";
  await dispatchDue(env,makeProvider(env,async()=>"owner@example.test"),{now:NOW+1000});
  const e=sqlite.prepare("SELECT error e FROM notification_failures").get().e;assert.ok(!/@/.test(e)&&/\[email\]/.test(e),e);assert.ok(!/@/.test(row(sqlite)[0].last_error));
  // missing recipient / sender
  const a=await setupV1();await mk(a.env);a.env.EMAIL={send:async()=>{throw new Error("must not send")}};a.env.NOTIFY_FROM="alerts@example.test";
  await dispatchDue(a.env,makeProvider(a.env,async()=>null),{now:NOW+1000});assert.match(row(a.sqlite)[0].last_error,/recipient not configured/);
  const b=await setupV1();await mk(b.env);b.env.EMAIL={send:async()=>{}};await dispatchDue(b.env,makeProvider(b.env,async()=>"owner@example.test"),{now:NOW+1000});assert.match(row(b.sqlite)[0].last_error,/NOTIFY_FROM/);
  // readiness
  const rec=async()=>"owner@example.test";
  assert.deepEqual(await notificationReadiness({},rec),{mode:"none",ready:false,missing:["ช่องทางส่ง (Email binding หรือ webhook)"]});
  assert.deepEqual(await notificationReadiness({EMAIL:{send(){}},NOTIFY_FROM:"a@example.test"},rec),{mode:"email",ready:true,missing:[]});
  assert.equal((await notificationReadiness({EMAIL:{send(){}}},rec)).ready,false);assert.equal((await notificationReadiness({EMAIL:{send(){}},NOTIFY_FROM:"a@example.test"},async()=>"")).ready,false);
  assert.equal((await notificationReadiness({NOTIFY_WEBHOOK_URL:"https://h.test"},rec)).mode,"webhook");
});
test("D17: provider preference email > webhook > none; binding absent/invalid never throws at construction",()=>{
  const rec=async()=>"o@example.test";
  assert.equal(makeProvider({},rec),null);assert.equal(makeEmailProvider({EMAIL:{}},rec),null);assert.equal(makeEmailProvider({EMAIL:"x"},rec),null);
  assert.equal(typeof makeProvider({NOTIFY_WEBHOOK_URL:"https://h.test"},rec),"function");
  const both=makeProvider({EMAIL:{send(){}},NOTIFY_WEBHOOK_URL:"https://h.test"},rec);assert.equal(typeof both,"function");
});
test("admin notifications endpoint exposes readiness (owner only) and sending is never triggered by viewing it",async()=>{
  const {env,ctx}=await setupV1();let sends=0;env.EMAIL={send:async()=>{sends++}};env.NOTIFY_FROM="a@example.test";
  const ok=await (await call(worker,env,ctx,"/api/admin/notifications")).json();assert.equal(ok.readiness.mode,"email");assert.equal(ok.readiness.ready,true);assert.equal(sends,0);
  assert.equal((await call(worker,env,{},"/api/admin/notifications")).status,403);
});
