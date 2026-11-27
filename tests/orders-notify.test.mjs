import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/orders-admin-worker.mjs";
import * as svc from "../src/orders-service.mjs";
import {dispatchDue,retryNotification,markNotificationReceived,listNotifications,notificationHistory,latencyStats,classifyError,makeProvider,makeEmailProvider,renderOrderAlert,notificationReadiness,BACKOFF_MS,MAX_AMBIGUOUS} from "../src/orders-notify.mjs";
import {setupV1,orderInput,call,NOW} from "./helpers/orders-env.mjs";
const q=(sqlite,w="1")=>sqlite.prepare("SELECT * FROM notification_queue WHERE "+w).all();
const mk=env=>svc.submitOrder(env,orderInput(),{now:NOW});
const timeout=()=>{const e=new Error("socket timed out talking to owner@example.test (0899999999)");e.name="TimeoutError";return e};
const refuse=(code="E_REFUSED")=>{const e=new Error("550 mailbox owner@example.test unavailable for สมชาย ใจดี");e.code=code;return e};
const allText=sqlite=>JSON.stringify(["notification_queue","notification_failures","notification_events","audit_log","latency_log"].map(t=>sqlite.prepare(`SELECT * FROM ${t}`).all()));
const providerLog=()=>{const calls=[];return {calls,fn:async(r,m)=>{calls.push({id:r.id,...m})}}};

test("success: queued → accepted by provider; messageId stored; NOT marked delivery-confirmed; latency recorded separately",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);
  const s=await dispatchDue(env,async()=>({messageId:"msg-abc123"}),{now:NOW+1000});assert.equal(s.sent,1);
  const r=q(sqlite)[0];assert.deepEqual([r.status,r.attempts,r.provider_message_id,r.delivery_confirmed_at],["sent",1,"msg-abc123",null]);assert.ok(r.provider_accepted_at);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM latency_log WHERE kind='notification'").get().n,1);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM latency_log WHERE kind='order_creation'").get().n,1);
  assert.equal((await dispatchDue(env,async()=>{throw new Error("must not resend")},{now:NOW+2000})).claimed,0);
  assert.deepEqual((await notificationHistory(env,1)).events.map(e=>e.event),["provider_called","provider_accepted"]);
  assert.equal((await latencyStats(env)).notification.count,1);
  assert.equal(await markNotificationReceived(env,1,NOW+3000),true);assert.ok(q(sqlite)[0].delivery_confirmed_at,"only the owner (or a future provider event) confirms inbox delivery");
});
test("NORMAL failures: backoff 1m/5m/30m/2h/12h, exactly 5 provider calls, then dead; never earlier than backoff",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);const p=providerLog();const fail=async(r,m)=>{p.calls.push(m);throw refuse()};let t=NOW+1000;
  for(let n=1;n<=5;n++){
    assert.equal((await dispatchDue(env,fail,{now:t})).claimed,1,"attempt "+n);const r=q(sqlite)[0];assert.equal(r.attempts,n);assert.equal(r.status,n<5?"failed":"dead");
    if(n<5){assert.equal(Date.parse(r.next_attempt_at)-t,BACKOFF_MS[n-1]);assert.equal((await dispatchDue(env,fail,{now:t+BACKOFF_MS[n-1]-1})).claimed,0);t+=BACKOFF_MS[n-1]}
  }
  assert.equal(p.calls.length,5);assert.equal((await dispatchDue(env,fail,{now:t+99e9})).claimed,0,"dead = no automatic attempts");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM notification_failures WHERE kind='failed'").get().n,5);assert.ok(p.calls.every(c=>c.possibleDuplicate===false),"definite refusals never flag a duplicate");
});
test("AMBIGUOUS failures are bounded: two consecutive TimeoutErrors = exactly TWO provider calls, then 'unconfirmed' with no further automatic attempts",async()=>{
  assert.equal(MAX_AMBIGUOUS,2);
  const {env,sqlite}=await setupV1();await mk(env);const p=providerLog();const hang=async(r,m)=>{p.calls.push(m);throw timeout()};
  await dispatchDue(env,hang,{now:NOW+1000});let r=q(sqlite)[0];assert.deepEqual([r.status,r.ambiguous_count,r.possible_duplicate,r.attempts],["failed",1,1,1]);
  const t=NOW+1000+BACKOFF_MS[0];assert.equal((await dispatchDue(env,hang,{now:t-1})).claimed,0);
  const s=await dispatchDue(env,hang,{now:t});assert.equal(s.unconfirmed,1);r=q(sqlite)[0];assert.deepEqual([r.status,r.ambiguous_count,r.attempts],["unconfirmed",2,2]);
  for(const later of [t+1,t+BACKOFF_MS[1],t+864e5,t+99*864e5])assert.equal((await dispatchDue(env,hang,{now:later})).claimed,0);
  assert.equal(p.calls.length,2,"NOT five");assert.deepEqual(p.calls.map(c=>c.possibleDuplicate),[false,true]);
  assert.deepEqual((await notificationHistory(env,1)).failures.map(f=>[f.kind,f.attempt]),[["ambiguous",1],["ambiguous",2]]);
  assert.ok((await notificationHistory(env,1)).events.some(e=>e.event==="unconfirmed_no_more_automatic_attempts"));
  assert.deepEqual((await listNotifications(env)).map(n=>[n.status,n.ambiguousCount,n.possibleDuplicate]),[["unconfirmed",2,1]]);
  // owner decision: resend resets counters but KEEPS the whole history
  assert.equal(await retryNotification(env,1,t+1e3),true);r=q(sqlite)[0];assert.deepEqual([r.status,r.attempts,r.ambiguous_count],["queued",0,0]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM notification_failures").get().n,2,"audit history preserved");assert.ok((await notificationHistory(env,1)).events.some(e=>e.event==="manual_retry"));
  assert.equal((await dispatchDue(env,async()=>({messageId:"m2"}),{now:t+2e3})).sent,1);
});
test("mixed sequences stay bounded: ambiguous then definite refusals total ≤5 calls; definite then ambiguous still allows only one extra ambiguous retry",async()=>{
  const a=await setupV1();await mk(a.env);let t=NOW+1000,calls=0;
  const seq=[timeout,()=>refuse(),()=>refuse(),()=>refuse(),()=>refuse(),()=>refuse()];
  for(const f of seq){const s=await dispatchDue(a.env,async()=>{calls++;throw f()},{now:t});if(!s.claimed)break;t+=12*3600e3+1}
  assert.equal(calls,5);assert.equal(q(a.sqlite)[0].status,"dead");assert.equal(q(a.sqlite)[0].possible_duplicate,1,"flag persists after an earlier ambiguous attempt");
  const b=await setupV1();await mk(b.env);t=NOW+1000;calls=0;
  const seq2=[()=>refuse(),timeout,timeout,timeout,timeout];
  for(const f of seq2){const s=await dispatchDue(b.env,async()=>{calls++;throw f()},{now:t});if(!s.claimed)break;t+=12*3600e3+1}
  assert.equal(calls,3);assert.equal(q(b.sqlite)[0].status,"unconfirmed");
});
test("provider accepted but the Worker stopped before SENT: recovered as AMBIGUOUS — one more attempt (flagged), then stop; never a third call",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);const p=providerLog();
  const real=env.ORDERS_DB.batch;env.ORDERS_DB.batch=async()=>{throw new Error("Worker terminated")};
  await assert.rejects(dispatchDue(env,p.fn,{now:NOW+1000}),/Worker terminated/);env.ORDERS_DB.batch=real;
  assert.equal(p.calls.length,1);let r=q(sqlite)[0];assert.equal(r.status,"sending");assert.ok(r.provider_called_at);
  assert.equal((await dispatchDue(env,p.fn,{now:NOW+2000})).claimed,0,"fresh lock is respected");
  let t=NOW+6*60e3;let s=await dispatchDue(env,p.fn,{now:t});assert.equal(s.reclaimed,1);r=q(sqlite)[0];assert.deepEqual([r.status,r.ambiguous_count,r.possible_duplicate],["failed",1,1]);
  t+=BACKOFF_MS[0];await dispatchDue(env,p.fn,{now:t});assert.equal(p.calls.length,2);assert.equal(p.calls[1].possibleDuplicate,true);assert.equal(q(sqlite)[0].status,"sent");
  assert.equal((await dispatchDue(env,p.fn,{now:t+99e9})).claimed,0);assert.equal(p.calls.length,2);
  // ... and if the second attempt ALSO dies after the call, automatic attempts stop
  const b=await setupV1();await mk(b.env);const pb=providerLog();let tt=NOW+1000;
  for(let i=0;i<2;i++){const rb=b.env.ORDERS_DB.batch;b.env.ORDERS_DB.batch=async()=>{throw new Error("Worker terminated")};await assert.rejects(dispatchDue(b.env,pb.fn,{now:tt}),/terminated/);b.env.ORDERS_DB.batch=rb;tt+=6*60e3;await dispatchDue(b.env,async()=>{},{now:tt});tt+=BACKOFF_MS[0]}
  assert.equal(pb.calls.length,2);assert.equal(q(b.sqlite)[0].status,"unconfirmed");
});
test("Worker stopped BEFORE calling the provider: counted as a reclaim (bounded), not ambiguous, no duplicate flag",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);
  sqlite.prepare("UPDATE notification_queue SET status='sending', locked_at=?, lock_token='dead-worker', provider_called_at=NULL").run(new Date(NOW-6*60e3).toISOString());
  const s=await dispatchDue(env,null,{now:NOW});assert.equal(s.reclaimed,1);const r=q(sqlite)[0];assert.deepEqual([r.status,r.attempts,r.ambiguous_count,r.possible_duplicate],["failed",1,0,0]);
  assert.equal(sqlite.prepare("SELECT kind k FROM notification_failures").get().k,"reclaimed");
});
test("RACE: many workers recovering the same stale lock record exactly one outcome (compare-and-set)",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);
  sqlite.prepare("UPDATE notification_queue SET status='sending', locked_at=?, lock_token='w1', provider_called_at=?").run(new Date(NOW-6*60e3).toISOString(),new Date(NOW-6*60e3).toISOString());
  const rs=await Promise.all(Array.from({length:8},()=>dispatchDue(env,null,{now:NOW})));
  assert.equal(rs.reduce((n,s)=>n+s.reclaimed,0),1);const r=q(sqlite)[0];assert.deepEqual([r.attempts,r.ambiguous_count],[1,1]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM notification_failures").get().n,1);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM notification_events").get().n,1);
});
test("RACE: a slow worker finishing AFTER its row was recovered cannot overwrite the recovery (late accept is logged)",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);let released;
  const slow=async()=>{await new Promise(r=>{released=r});return {messageId:"late"}};
  const run=dispatchDue(env,slow,{now:NOW+1000});await new Promise(r=>setTimeout(r,20));
  const s=await dispatchDue(env,null,{now:NOW+1000+6*60e3});assert.equal(s.reclaimed,1);   // another worker recovers the stale row
  released();const out=await run;assert.equal(out.lateAccept,1);assert.equal(out.sent,0);
  const r=q(sqlite)[0];assert.notEqual(r.status,"sent");assert.ok((await notificationHistory(env,1)).events.some(e=>e.event==="late_accept_after_reclaim"));
});
test("concurrent dispatchers never send the same message twice (atomic claim)",async()=>{
  const {env}=await setupV1();for(let i=0;i<6;i++)await mk(env);const sent=[];
  const run=()=>dispatchDue(env,async row=>{sent.push(row.id);await new Promise(r=>setTimeout(r,1));return {}},{now:NOW+1000,batch:3});
  await Promise.all([run(),run(),run(),run()]);await dispatchDue(env,async row=>{sent.push(row.id);return {}},{now:NOW+1000,batch:10});
  assert.equal(sent.length,6);assert.equal(new Set(sent).size,6);
});
test("PII: raw provider errors (addresses, phones, names) are never stored anywhere; only codes and fixed text",async()=>{
  const {env,sqlite}=await setupV1();await mk(env);
  await dispatchDue(env,async()=>{throw refuse("E_RECIPIENT_NOT_ALLOWED")},{now:NOW+1000});
  await dispatchDue(env,async()=>{const e=timeout();e.code="E_TIMEOUT";throw e},{now:NOW+1000+BACKOFF_MS[0]});
  const dump=allText(sqlite);for(const leak of ["owner@example.test","0899999999","สมชาย","mailbox","socket timed out","550"])assert.ok(!dump.includes(leak),leak);
  assert.ok(dump.includes("E_RECIPIENT_NOT_ALLOWED")&&dump.includes("E_TIMEOUT"));
  assert.deepEqual(classifyError(new Error("hello owner@example.test")),{code:"unknown",ambiguous:false});assert.deepEqual(classifyError(timeout()),{code:"TimeoutError",ambiguous:true});
  assert.deepEqual(classifyError({name:"Error",code:"weird code with spaces and a@b.c"}),{code:"unknown",ambiguous:false});
  const e=new Error("x");e.ambiguous=true;assert.deepEqual(classifyError(e),{code:"timeout",ambiguous:true});
  const adminList=JSON.stringify(await listNotifications(env));assert.ok(!adminList.includes("owner@example.test"));
});
test("Cloudflare Email Service provider (mock binding): send({from,to,subject,text}) → messageId stored; no custom headers assumed; no network",async()=>{
  const {env,sqlite}=await setupV1();const r=await mk(env);const sent=[];
  env.EMAIL={send:async m=>{sent.push(m);return {messageId:"<cf-abc123@example.test>"}}};env.NOTIFY_FROM="alerts@example.test";env.ORDERS_ADMIN_URL="https://admin.example.test/admin/orders/";
  const f=globalThis.fetch;globalThis.fetch=async()=>{throw new Error("network must not be used")};
  try{await dispatchDue(env,makeProvider(env,async()=>"owner@example.test"),{now:NOW+1000})}finally{globalThis.fetch=f}
  assert.equal(sent.length,1);const m=sent[0];assert.deepEqual(Object.keys(m).sort(),["from","subject","text","to"],"structured API only; no headers invented");
  assert.deepEqual([m.to,m.from],["owner@example.test","alerts@example.test"]);assert.equal(m.subject,"[NORX] "+r.id+" · 980 บาท");
  assert.match(m.text,/ยอดที่ต้องตรวจ 980 บาท/);assert.match(m.text,/รหัสอ้างอิงการแจ้งเตือน: norx-notification-1/);assert.ok(!m.text.includes("ที่อยู่"));
  const row=q(sqlite)[0];assert.equal(row.status,"sent");assert.match(row.provider_message_id,/^<cf-abc123@…>$/,"id kept, domain part dropped");assert.equal(row.delivery_confirmed_at,null);
  assert.match(renderOrderAlert({orderNo:"X",name:"n",phone:"p",total:1,items:[]},{possibleDuplicate:true}).subject,/อาจซ้ำ/);
});
test("email provider: missing recipient/sender → clear code (not a crash); a send without messageId is still 'accepted' but flagged",async()=>{
  const a=await setupV1();await mk(a.env);a.env.EMAIL={send:async()=>{throw new Error("must not send")}};a.env.NOTIFY_FROM="alerts@example.test";
  await dispatchDue(a.env,makeProvider(a.env,async()=>null),{now:NOW+1000});assert.equal(q(a.sqlite)[0].last_error_code,"recipient_not_configured");
  const b=await setupV1();await mk(b.env);b.env.EMAIL={send:async()=>{}};await dispatchDue(b.env,makeProvider(b.env,async()=>"owner@example.test"),{now:NOW+1000});assert.equal(q(b.sqlite)[0].last_error_code,"sender_not_configured");
  const c=await setupV1();await mk(c.env);c.env.EMAIL={send:async()=>({})};c.env.NOTIFY_FROM="alerts@example.test";await dispatchDue(c.env,makeProvider(c.env,async()=>"owner@example.test"),{now:NOW+1000});
  assert.deepEqual([q(c.sqlite)[0].status,q(c.sqlite)[0].provider_message_id],["sent",null]);assert.ok((await notificationHistory(c.env,1)).events.some(e=>e.detail==="no_message_id"));
});
test("webhook fallback: 5xx/timeouts are ambiguous, 4xx definite; readiness and provider preference",async()=>{
  const f=globalThis.fetch;
  try{
    for(const [status,amb] of [[503,true],[500,true],[400,false],[403,false]]){
      const {env,sqlite}=await setupV1();await mk(env);env.NOTIFY_WEBHOOK_URL="https://hook.test/x";globalThis.fetch=async()=>new Response("no",{status});
      await dispatchDue(env,makeProvider(env,async()=>"o@example.test"),{now:NOW+1000});const r=q(sqlite)[0];assert.deepEqual([r.ambiguous_count,r.last_error_code],[amb?1:0,"http_"+status],String(status));
    }
  }finally{globalThis.fetch=f}
  const rec=async()=>"owner@example.test";
  assert.equal(makeProvider({},rec),null);assert.equal(makeEmailProvider({EMAIL:{}},rec),null);
  assert.deepEqual(await notificationReadiness({},rec),{mode:"none",ready:false,missing:["ช่องทางส่ง (Email binding หรือ webhook)"]});
  assert.deepEqual(await notificationReadiness({EMAIL:{send(){}},NOTIFY_FROM:"a@example.test"},rec),{mode:"email",ready:true,missing:[]});
  assert.equal((await notificationReadiness({EMAIL:{send(){}}},rec)).ready,false);assert.equal((await dispatchDue({ORDERS_DB:(await setupV1()).env.ORDERS_DB},null,{now:NOW})).claimed,0);
});
test("admin: history/retry/mark-received routes are owner-only and CSRF-protected; failed email never touches the order",async()=>{
  const {env,ctx,sqlite}=await setupV1();const r=await mk(env);await dispatchDue(env,async()=>{throw timeout()},{now:NOW+1000});await dispatchDue(env,async()=>{throw timeout()},{now:NOW+1000+BACKOFF_MS[0]});
  assert.equal(q(sqlite)[0].status,"unconfirmed");assert.equal(sqlite.prepare("SELECT payment_status p FROM orders WHERE order_no=?").get(r.id).p,"pending");
  for(const [m,p] of [["GET","/api/admin/notifications/1/history"],["POST","/api/admin/notifications/1/retry"],["POST","/api/admin/notifications/1/received"]])assert.equal((await call(worker,env,{},p,{method:m,body:m==="POST"?{}:undefined})).status,403,p);
  const cross=await worker.fetch(new Request("https://orders.test/api/admin/notifications/1/received",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://evil.test"},body:"{}"}),env,ctx);assert.equal(cross.status,403);
  const h=await (await call(worker,env,ctx,"/api/admin/notifications/1/history")).json();assert.equal(h.failures.length,2);
  assert.equal((await (await call(worker,env,ctx,"/api/admin/notifications/1/received",{method:"POST",body:{}})).json()).marked,true);assert.ok(q(sqlite)[0].delivery_confirmed_at);
});
