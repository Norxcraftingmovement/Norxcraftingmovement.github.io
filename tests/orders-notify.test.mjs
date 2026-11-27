import test from "node:test";
import assert from "node:assert/strict";
import * as svc from "../src/orders-service.mjs";
import {dispatchDue,retryNotification,listNotifications,latencyStats,BACKOFF_MS,makeProvider} from "../src/orders-notify.mjs";
import {setupV1,orderInput,NOW} from "./helpers/orders-env.mjs";
const q=(sqlite,w="1")=>sqlite.prepare("SELECT * FROM notification_queue WHERE "+w).all();
const mk=(env)=>svc.submitOrder(env,orderInput(),{now:NOW});

test("success path: queued → sent, attempts counted, notification latency logged separately from order creation",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);const sent=[];
  const s=await dispatchDue(env,async row=>{sent.push(JSON.parse(row.payload).orderNo)},{now:NOW+1000});
  assert.deepEqual([s.claimed,s.sent,s.failed],[1,1,0]);assert.equal(q(sqlite)[0].status,"sent");assert.equal(q(sqlite)[0].attempts,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM latency_log WHERE kind='notification'").get().n,1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM latency_log WHERE kind='order_creation'").get().n,1);
  const st=await latencyStats(env);assert.equal(st.order_creation.count,1);assert.equal(st.notification.count,1);
  assert.equal((await dispatchDue(env,async()=>{throw new Error("must not resend")},{now:NOW+2000})).claimed,0,"sent rows are never resent");
});
test("failure → failure log + exponential backoff (1m,5m,30m,2h,12h) → dead after 5; no PII in log",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);let t=NOW+1000;
  for(let attempt=1;attempt<=5;attempt++){
    const s=await dispatchDue(env,async()=>{throw new Error("SMTP 421 busy")},{now:t});
    assert.equal(s.claimed,1,"attempt "+attempt);
    const row=q(sqlite)[0];assert.equal(row.attempts,attempt);assert.equal(row.status,attempt<5?"failed":"dead");
    if(attempt<5){assert.equal(Date.parse(row.next_attempt_at)-t,BACKOFF_MS[attempt-1]);
      assert.equal((await dispatchDue(env,async()=>{throw new Error("too early")},{now:t+BACKOFF_MS[attempt-1]-1})).claimed,0,"not before backoff elapses");
      t+=BACKOFF_MS[attempt-1];}
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM notification_failures").get().n,5);
  assert.ok(!sqlite.prepare("SELECT group_concat(error) e FROM notification_failures").get().e.includes("0800000000"));
  assert.equal((await dispatchDue(env,async()=>{},{now:t+99e9})).claimed,0,"dead rows are not retried automatically");
  const list=await listNotifications(env);assert.equal(list[0].status,"dead");assert.match(list[0].lastError,/SMTP 421/);
  assert.equal(await retryNotification(env,list[0].id,t),true);assert.equal(q(sqlite)[0].status,"queued");
  assert.equal((await dispatchDue(env,async()=>{},{now:t})).sent,1,"manual retry delivers");
  assert.equal(await retryNotification(env,list[0].id,t),false,"sent rows cannot be retried");
});
test("failed email never touches the order: order and status unaffected",async()=>{
  const {env,sqlite}=await setupV1();const r=await mk(env);
  await dispatchDue(env,async()=>{throw new Error("down")},{now:NOW+1000});
  assert.equal(sqlite.prepare("SELECT payment_status p FROM orders WHERE order_no=?").get(r.id).p,"pending");
});
test("no provider configured: rows stay queued, nothing is marked failed",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);
  const s=await dispatchDue(env,null,{now:NOW+1000});assert.equal(s.claimed,0);assert.equal(q(sqlite)[0].status,"queued");assert.equal(makeProvider({},()=>null),null);
});
test("concurrent dispatchers never send the same message twice (atomic claim)",async()=>{
  const {env}=await setupV1();for(let i=0;i<6;i++)await mk(env);const sent=[];
  const run=()=>dispatchDue(env,async row=>{sent.push(row.id);await new Promise(r=>setTimeout(r,1))},{now:NOW+1000,batch:3});
  await Promise.all([run(),run(),run(),run()]);await dispatchDue(env,async row=>{sent.push(row.id)},{now:NOW+1000,batch:10});
  assert.equal(sent.length,6);assert.equal(new Set(sent).size,6);
});
test("crashed worker: stale 'sending' rows are reclaimed as a failed attempt and retried",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);const now=NOW+1000;
  sqlite.prepare("UPDATE notification_queue SET status='sending', locked_at=?").run(new Date(now-6*60e3).toISOString());
  const s=await dispatchDue(env,async()=>{},{now});assert.equal(s.reclaimed,1);
  assert.equal(sqlite.prepare("SELECT error e FROM notification_failures").get().e,"worker timeout (stale lock)");
  assert.equal(q(sqlite)[0].status,"failed");
  assert.equal((await dispatchDue(env,async()=>{},{now:now+BACKOFF_MS[0]})).sent,1);
});
test("webhook provider posts alert with recipient from settings and fails on non-2xx",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);env.NOTIFY_WEBHOOK_URL="https://hook.test/x";env.NOTIFY_WEBHOOK_TOKEN="tok";
  const f=globalThis.fetch;let seen;globalThis.fetch=async(u,o)=>{seen={u,o};return new Response("no",{status:500})};
  try{
    const prov=makeProvider(env,async()=>"owner@example.test");
    await dispatchDue(env,prov,{now:NOW+1000});
    assert.equal(seen.u,"https://hook.test/x");assert.equal(seen.o.headers.Authorization,"Bearer tok");assert.equal(JSON.parse(seen.o.body).to,"owner@example.test");
    assert.equal(q(sqlite)[0].status,"failed");assert.match(q(sqlite)[0].last_error,/provider HTTP 500/);
  }finally{globalThis.fetch=f}
});
