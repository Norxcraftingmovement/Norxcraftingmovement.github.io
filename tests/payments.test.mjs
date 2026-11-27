import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/orders-admin-worker.mjs";
import pub from "../src/orders-public-worker.mjs";
import * as svc from "../src/orders-service.mjs";
import * as core from "../src/orders-core.mjs";
import * as pay from "../src/payments.mjs";
import {crc16,parseTlv,verifyCrc,normalizePromptPayId,buildPromptPayPayload,maskPromptPayId} from "../src/promptpay.mjs";
import {setupV1,orderInput,call,NOW,T0,DAY} from "./helpers/orders-env.mjs";
const S=core.STATUS,ORIGIN="https://norxcraftingmovement.com";
const nid=(first12)=>{let s=0;for(let i=0;i<12;i++)s+=Number(first12[i])*(13-i);return first12+String((11-(s%11))%10)};
const ACCT=["123","4","56789","0"].join("-"); // bank-account-looking value (assembled so the repo secret scan stays meaningful)
const SYN={idType:"mobile",id:"080-000-0000",payeeName:"ผู้รับทดสอบ สมมติ"};
const withClock=async(ms,f)=>{const r=Date.now;Date.now=()=>ms;try{return await f()}finally{Date.now=r}};
async function ready(c,{verify=true}={}){await pay.putPaymentSettings(c.env,"adm",SYN);if(verify)await pay.verifyPaymentSettings(c.env,"adm",{confirmName:SYN.payeeName},NOW);return c}
const mk=(env,o={})=>svc.submitOrder(env,orderInput({expectedTotal:980,...o}),{now:NOW});
const crcTable=(()=>{const t=[];for(let n=0;n<256;n++){let c=n<<8;for(let k=0;k<8;k++)c=c&0x8000?((c<<1)^0x1021)&0xffff:(c<<1)&0xffff;t.push(c)}return t})();
const crcAlt=s=>{let c=0xffff;for(const b of new TextEncoder().encode(s))c=((c<<8)&0xffff)^crcTable[((c>>8)^b)&0xff];return c.toString(16).toUpperCase().padStart(4,"0")};

test("CRC-16/CCITT-FALSE: standard vector and agreement with an independent table-driven implementation",()=>{
  assert.equal(crc16("123456789"),"29B1");
  for(let i=0;i<200;i++){const s=Array.from({length:i%60+1},()=>String.fromCharCode(32+Math.floor(Math.random()*95))).join("");assert.equal(crc16(s),crcAlt(s))}
});
test("PromptPay payload structure: tag order, dynamic flag, AID, id sub-tag, THB, two-decimal amount, valid CRC; any tampering breaks the CRC",()=>{
  for(const [type,id,sub,val] of [["mobile","0800000000","01","0066800000000"],["national_id",nid("110170020345"),"02",null],["tax_id","0105500000000","02","0105500000000"],["ewallet","123456789012345","03","123456789012345"]]){
    const p=buildPromptPayPayload({type,id,amountBaht:980}),t=parseTlv(p);
    assert.deepEqual(t.map(x=>x[0]),["00","01","29","53","54","58","63"],type);
    assert.deepEqual([t[0][1],t[1][1],t[3][1],t[4][1],t[5][1]],["01","12","764","980.00","TH"]);
    const m=parseTlv(t[2][1]);assert.deepEqual(m[0],["00","A000000677010111"]);assert.equal(m[1][0],sub);if(val)assert.equal(m[1][1],val);
    assert.ok(verifyCrc(p));assert.equal(p.length,t.reduce((n,[,v])=>n+4+v.length,0));
    for(const i of [5,20,40,p.length-6])assert.ok(!verifyCrc(p.slice(0,i)+(p[i]==="0"?"1":"0")+p.slice(i+1)),"tamper at "+i);
  }
  for(const [a,txt] of [[1,"1.00"],[50,"50.00"],[1030,"1030.00"],[9999999,"9999999.00"]])assert.equal(parseTlv(buildPromptPayPayload({type:"mobile",id:"0800000000",amountBaht:a})).find(x=>x[0]==="54")[1],txt);
});
test("PromptPay IDs: only mobile / national ID / tax ID / e-wallet are accepted — a bank ACCOUNT NUMBER can never produce a QR",()=>{
  assert.deepEqual(normalizePromptPayId("mobile","080-000-0000"),{type:"mobile",value:"0066800000000",display:"0800000000"});
  for(const bad of [ACCT,"1473270575","123456789012","12345678","08000000","08000000000","0200000000","0100000000","abc","","0800 000 000x"])assert.throws(()=>normalizePromptPayId("mobile",bad),/ต้อง|ตัวเลข/,"mobile "+bad);
  for(const bad of [ACCT,"1234567890","12345678901234","1101700203451"])assert.throws(()=>normalizePromptPayId("national_id",bad),/13 หลัก|เลขหลักสุดท้าย/,"national "+bad);
  assert.equal(normalizePromptPayId("national_id",nid("110170020345")).value.length,13);assert.throws(()=>normalizePromptPayId("ewallet","12345"),/15 หลัก/);assert.throws(()=>normalizePromptPayId("bank_account","1234567890"),/ประเภท/);
  for(const a of [0,-1,1.5,1e7,"980",NaN,undefined])assert.throws(()=>buildPromptPayPayload({type:"mobile",id:"0800000000",amountBaht:a}),/ยอดเงิน/,String(a));
  assert.equal(maskPromptPayId("mobile","0800000000"),"080-xxx-0000");
});
test("QR image: valid SVG for the payload (no external resources); deterministic",()=>{
  const p=buildPromptPayPayload({type:"mobile",id:"0800000000",amountBaht:980}),a=pay.qrSvg(p),b=pay.qrSvg(p);
  assert.equal(a,b);assert.match(a,/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);assert.ok(!/href|<script|<image/.test(a));assert.ok(a.length>2000);
});
test("owner configuration: validates, masks the id in responses, ANY change un-verifies, verification = typing the payee name, QR not issued until verified",async()=>{
  const c=await setupV1();const {env,ctx,sqlite}=c;
  const put=(b)=>call(worker,env,ctx,"/api/admin/settings/payment",{method:"PUT",body:b});
  for(const bad of [{...SYN,id:ACCT},{...SYN,id:""},{...SYN,payeeName:"x"},{...SYN,idType:"bank_account"}])assert.equal((await put(bad)).status,400);
  const ok=await (await put(SYN)).json();assert.deepEqual([ok.payment.verified,ok.payment.idMasked],[false,"080-xxx-0000"]);assert.ok(!JSON.stringify(ok).includes("0800000000"),"full id never returned");
  // unverified → no QR on a new order
  const r0=await mk(env);assert.equal("payment" in r0,false);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payment_requests").get().n,0);
  const verify=(confirmName)=>call(worker,env,ctx,"/api/admin/settings/payment/verify",{method:"POST",body:{confirmName}});
  assert.equal((await verify("ชื่ออื่น")).status,400);assert.equal((await (await call(worker,env,ctx,"/api/admin/settings/payment")).json()).payment.verified,false);
  const v=await (await verify(SYN.payeeName)).json();assert.equal(v.payment.verified,true);assert.ok(v.payment.verifiedAt);
  assert.equal((await put(SYN)).status,200);assert.equal((await (await call(worker,env,ctx,"/api/admin/settings/payment")).json()).payment.verified,true,"identical save keeps verification");
  for(const change of [{...SYN,id:"0811111111"},{...SYN,payeeName:"ผู้รับคนอื่น"},{...SYN,idType:"ewallet",id:"123456789012345"}]){
    await verify(SYN.payeeName);await put(change);assert.equal((await (await call(worker,env,ctx,"/api/admin/settings/payment")).json()).payment.verified,false,JSON.stringify(change));await put(SYN);
  }
  assert.ok(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE action IN ('payment.settings','payment.verified')").get().n>=6);
  assert.ok(!sqlite.prepare("SELECT group_concat(after) a FROM audit_log WHERE action LIKE 'payment.%'").get().a.includes("0800000000"),"audit keeps the id masked");
  const prev=await call(worker,env,ctx,"/api/admin/settings/payment/preview.svg");assert.equal(prev.status,200);assert.match(prev.headers.get("content-type"),/svg/);
});
test("order with verified PromptPay: receipt carries payment block; QR amount = saved server total (incl. shipping); linked to the order id; payload stored",async()=>{
  const c=await ready(await setupV1());const {env,sqlite}=c;
  const r=await mk(env);assert.equal(r.ok,true);assert.ok(r.payment);
  assert.deepEqual([r.payment.provider,r.payment.reference,r.payment.amount,r.payment.payeeName],["promptpay_p2p",r.id,980,SYN.payeeName]);assert.equal(r.payment.deadline,new Date(T0+7*DAY+10*3600e3).toISOString());
  assert.match(r.payment.qrUrl,new RegExp("^/api/orders/pay\\.svg\\?o="+r.id+"&t="));assert.match(r.payment.downloadUrl,/&download=1$/);
  const req=sqlite.prepare("SELECT * FROM payment_requests").get(),ord=sqlite.prepare("SELECT id,total_baht FROM orders WHERE order_no=?").get(r.id);
  assert.deepEqual([req.order_id,req.reference,req.provider,req.expected_amount_baht,req.status,req.currency,req.payee_name,req.payee_id_masked,req.verified_at,req.bank_txn_ref],[ord.id,r.id,"promptpay_p2p",980,"awaiting","THB",SYN.payeeName,"080-xxx-0000",null,null]);
  const t=parseTlv(req.qr_payload);assert.equal(t.find(x=>x[0]==="54")[1],"980.00");assert.ok(verifyCrc(req.qr_payload));assert.equal(parseTlv(t[2][1])[1][1],"0066800000000");
  const ship=await mk(env,{delivery:"ship",address:"99/9 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 50000",expectedTotal:1030});
  assert.equal(ship.payment.amount,1030);assert.equal(parseTlv(sqlite.prepare("SELECT qr_payload q FROM payment_requests WHERE reference=?").get(ship.id).q).find(x=>x[0]==="54")[1],"1030.00");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payment_events WHERE event='qr_issued'").get().n,2);
});
test("token: random, stored hashed, wrong token = unknown order (identical 404); QR/JSON only while awaiting; QR views never change order or payment state",async()=>{
  const c=await ready(await setupV1());const {env,sqlite}=c;const r=await mk(env);const tok=new URL("https://x"+r.payment.payUrl).searchParams.get("t");
  assert.match(tok,/^[A-Za-z0-9_-]{22}$/);assert.ok(!sqlite.prepare("SELECT tracking_token_hash h FROM orders").get().h.includes(tok));assert.match(sqlite.prepare("SELECT tracking_token_hash h FROM orders").get().h,/^[a-f0-9]{64}$/);
  const before=JSON.stringify([sqlite.prepare("SELECT * FROM orders").all(),sqlite.prepare("SELECT * FROM payments").all()]);
  const req=(path)=>withClock(NOW+1000,()=>pub.fetch(new Request("https://orders.test"+path,{headers:{Origin:ORIGIN}}),env,{}));
  const ok=await req(r.payment.apiUrl);assert.equal(ok.status,200);const v=await ok.json();
  assert.deepEqual([v.order.id,v.order.total,v.order.status,v.payment.state,v.payment.amount,v.payment.reference,v.payment.payeeName],[r.id,980,S.PENDING,"awaiting",980,r.id,SYN.payeeName]);assert.ok(v.bank.name,"bank-transfer fallback present");assert.ok(!JSON.stringify(v).includes("0800000000"),"payee id is not in the JSON");
  const svg=await req(r.payment.qrUrl);assert.equal(svg.status,200);assert.match(svg.headers.get("content-type"),/svg/);assert.ok(!svg.headers.get("content-disposition"));
  assert.match((await req(r.payment.downloadUrl)).headers.get("content-disposition"),/attachment; filename="NORX-[0-9A-F]{8}-QR\.svg"/);
  const nf=[`/api/orders/pay?o=${r.id}&t=${"A".repeat(22)}`,`/api/orders/pay?o=NORX-00000000&t=${tok}`,`/api/orders/pay?o=${r.id}`,`/api/orders/pay?o=bad&t=${tok}`,`/api/orders/pay.svg?o=${r.id}&t=${"B".repeat(22)}`];
  const bodies=[];for(const p of nf){const x=await req(p);assert.equal(x.status,404,p);bodies.push(await x.text())}assert.equal(new Set(bodies).size,1,"same body for every failure");
  assert.equal(JSON.stringify([sqlite.prepare("SELECT * FROM orders").all(),sqlite.prepare("SELECT * FROM payments").all()]),before,"viewing/downloading a QR changed nothing");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payments").get().n,0);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payment_events WHERE event='qr_viewed'").get().n,1,"first view logged once");
  const cors=await req(r.payment.apiUrl);assert.equal(cors.headers.get("access-control-allow-origin"),ORIGIN);
  assert.equal((await pub.fetch(new Request("https://orders.test"+r.payment.apiUrl,{method:"POST"}),env,{})).status,405);
});
test("states: expired after the deadline, paid, cancelled and on-site show no QR; replay of the same request rotates the token and keeps ONE request",async()=>{
  const c=await ready(await setupV1());const {env,sqlite}=c;const input=orderInput({expectedTotal:980});
  const a=await svc.submitOrder(env,input,{now:NOW}),tokA=new URL("https://x"+a.payment.payUrl).searchParams.get("t");
  const b=await svc.submitOrder(env,{...input},{now:NOW+5000}),tokB=new URL("https://x"+b.payment.payUrl).searchParams.get("t");
  assert.equal(a.id,b.id);assert.notEqual(tokA,tokB);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payment_requests").get().n,1);
  assert.equal(await pay.getPayView(c.env,a.id,tokA,NOW),null,"old token revoked");assert.equal((await pay.getPayView(env,a.id,tokB,NOW)).payment.state,"awaiting");
  const due=T0+7*DAY+10*3600e3;assert.equal((await pay.getPayView(env,a.id,tokB,due)).payment.state,"awaiting");assert.equal((await pay.getPayView(env,a.id,tokB,due+1)).payment.state,"expired");assert.equal(await pay.getPaySvg(env,a.id,tokB,due+1),null);
  const mkTok=async o=>{const r=await mk(env,o);return [r,new URL("https://x"+r.payment.payUrl).searchParams.get("t")]};
  const [p1,t1]=await mkTok();await svc.changeStatus(env,"adm",{orderNo:p1.id,from:S.PENDING,to:S.PAID,amount:980,now:NOW});assert.equal((await pay.getPayView(env,p1.id,t1,NOW)).payment.state,"paid");assert.equal(await pay.getPaySvg(env,p1.id,t1,NOW),null);
  const [p2,t2]=await mkTok({delivery:"event"});await svc.changeStatus(env,"adm",{orderNo:p2.id,from:S.PENDING,to:S.LATER,now:NOW});assert.equal((await pay.getPayView(env,p2.id,t2,NOW)).payment.state,"on_site");
  const [p3,t3]=await mkTok();await svc.changeStatus(env,"adm",{orderNo:p3.id,from:S.PENDING,to:S.CANCEL,now:NOW});assert.equal((await pay.getPayView(env,p3.id,t3,NOW)).payment.state,"cancelled");
  assert.equal((await pay.getPayView(env,"NORX-NOPE0000",t3,NOW)),null);
});
test("owner confirmation links the bank transaction: payment row ↔ request; undo reopens; re-confirm works; QR/slip/anything else never marks paid",async()=>{
  const c=await ready(await setupV1());const {env,sqlite}=c;const r=await mk(env);
  assert.equal(sqlite.prepare("SELECT payment_status p FROM orders").get().p,"pending");assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payments").get().n,0,"a generated QR is not a payment");
  await assert.rejects(svc.changeStatus(env,"adm",{orderNo:r.id,from:S.PENDING,to:S.PAID,amount:980,bankTxnRef:"bad ref!",now:NOW}),e=>e instanceof core.UserError&&/เลขอ้างอิง/.test(e.message));
  await svc.changeStatus(env,"adm",{orderNo:r.id,from:S.PENDING,to:S.PAID,amount:980,bankTxnRef:"TXN-0001-SYN",now:NOW});
  const y=sqlite.prepare("SELECT y.*, q.reference ref FROM payments y JOIN payment_requests q ON q.id=y.request_id").get();
  assert.deepEqual([y.status,y.amount_baht,y.provider,y.bank_txn_ref,y.verified_by,y.ref],["confirmed",980,"promptpay_p2p","TXN-0001-SYN","adm",r.id]);assert.ok(y.verified_at);
  let q=sqlite.prepare("SELECT * FROM payment_requests").get();assert.deepEqual([q.status,q.bank_txn_ref,q.verified_by],["verified","TXN-0001-SYN","adm"]);assert.ok(q.verified_at);
  await svc.changeStatus(env,"adm",{orderNo:r.id,from:S.PAID,to:S.PENDING,now:NOW});
  q=sqlite.prepare("SELECT * FROM payment_requests").get();assert.deepEqual([q.status,q.bank_txn_ref,q.verified_at],["awaiting",null,null]);assert.equal(sqlite.prepare("SELECT status s FROM payments").get().s,"void");
  await svc.changeStatus(env,"adm",{orderNo:r.id,from:S.PENDING,to:S.PAID,amount:980,bankTxnRef:"TXN-0001-SYN",now:NOW}); // same order may re-use its own reference after an undo
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payments WHERE status='confirmed'").get().n,1);assert.deepEqual((await svc.paymentIntegrity(env)),[]);
  assert.deepEqual(sqlite.prepare("SELECT event FROM payment_events ORDER BY id").all().map(e=>e.event),["qr_issued","verified_by_owner","reopened","verified_by_owner"]);
  // manual confirmation without any reference still works (retained manual verification)
  const r2=await mk(env);await svc.changeStatus(env,"adm",{orderNo:r2.id,from:S.PENDING,to:S.PAID,amount:980,now:NOW});assert.equal(sqlite.prepare("SELECT bank_txn_ref b FROM payments WHERE order_id=(SELECT id FROM orders WHERE order_no=?)").get(r2.id).b,null);
});
test("DUPLICATE PAYMENT PREVENTION: one bank transaction can verify only one order (checked up front and by the database, also under concurrency)",async()=>{
  const c=await ready(await setupV1());const {env,sqlite}=c;const a=await mk(env),b=await mk(env),d=await mk(env);
  await svc.changeStatus(env,"adm",{orderNo:a.id,from:S.PENDING,to:S.PAID,amount:980,bankTxnRef:"TXN-SAME-0001",now:NOW});
  await assert.rejects(svc.changeStatus(env,"adm",{orderNo:b.id,from:S.PENDING,to:S.PAID,amount:980,bankTxnRef:"TXN-SAME-0001",now:NOW}),e=>e instanceof core.UserError&&/ถูกใช้ยืนยันออเดอร์อื่นแล้ว/.test(e.message));
  assert.equal(sqlite.prepare("SELECT payment_status p FROM orders WHERE order_no=?").get(b.id).p,"pending","the second order stays unpaid");
  assert.throws(()=>sqlite.exec(`INSERT INTO payments(order_id,amount_baht,status,bank_txn_ref) SELECT id,980,'confirmed','TXN-SAME-0001' FROM orders WHERE order_no='${b.id}'`),/UNIQUE constraint failed: payments\.bank_txn_ref/);
  const res=await Promise.allSettled([b,d].map(o=>svc.changeStatus(env,"adm",{orderNo:o.id,from:S.PENDING,to:S.PAID,amount:980,bankTxnRef:"TXN-RACE-0002",now:NOW})));
  assert.equal(res.filter(x=>x.status==="fulfilled").length,1);assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payments WHERE bank_txn_ref='TXN-RACE-0002' AND status='confirmed'").get().n,1);assert.deepEqual(await svc.paymentIntegrity(env),[]);
});
test("cut-off cancellation of unpaid orders also cancels their payment requests",async()=>{
  const c=await ready(await setupV1());const {env,sqlite}=c;const a=await mk(env),b=await mk(env);await svc.changeStatus(env,"adm",{orderNo:a.id,from:S.PENDING,to:S.PAID,amount:980,now:NOW});
  await svc.closeRound(env,"adm","ROUND-001");await svc.cancelUnpaid(env,"adm","ROUND-001",1,T0+8*DAY);
  assert.deepEqual(sqlite.prepare("SELECT reference r, status s FROM payment_requests ORDER BY id").all().map(x=>[x.r===a.id?"paid":"unpaid",x.s]),[["paid","verified"],["unpaid","cancelled"]]);
});
test("admin payment routes: owner-only, CSRF-protected; public worker exposes no admin payment route; storefront JSON is unchanged when QR is off",async()=>{
  const c=await setupV1();const {env,ctx}=c;
  for(const [m,p,b] of [["GET","/api/admin/settings/payment"],["PUT","/api/admin/settings/payment",SYN],["POST","/api/admin/settings/payment/verify",{confirmName:"x"}],["GET","/api/admin/settings/payment/preview.svg"]]){
    assert.equal((await call(worker,env,{},p,{method:m,body:b})).status,403,p);assert.equal((await call(worker,env,{access:{aud:"aud",getIdentity:async()=>({email:"x@example.test"})}},p,{method:m,body:b})).status,403,p)}
  const cross=await worker.fetch(new Request("https://orders.test/api/admin/settings/payment",{method:"PUT",headers:{"Content-Type":"application/json",Origin:"https://evil.test"},body:JSON.stringify(SYN)}),env,ctx);assert.equal(cross.status,403);
  assert.equal((await call(worker,env,ctx,"/api/admin/settings/payment/preview.svg")).status,404,"nothing configured yet");
  for(const p of ["/api/admin/settings/payment","/api/orders/settings"])assert.equal((await pub.fetch(new Request("https://orders.test"+p),env,{})).status,404);
  const r=await mk(env);assert.deepEqual(Object.keys(r),["ok","id","name","roundId","items","subtotal","shipping","total","paymentDue","status"],"V1 receipt shape unchanged when no QR");
  await ready(c);const r2=await mk(env);assert.deepEqual(Object.keys(r2).slice(0,10),Object.keys(r),"V1 fields keep their order; `payment` is an extra trailing field");assert.equal(Object.keys(r2).at(-1),"payment");
});

// ---------------- payment SAFETY when the receiving account changes (no real transfers anywhere) ----------------
const NEW={idType:"mobile",id:"0811111111",payeeName:"ผู้รับใหม่ สมมติ"};
const tok=r=>new URL("https://x"+r.payment.payUrl).searchParams.get("t");
const payload=(sqlite,id)=>sqlite.prepare("SELECT qr_payload q FROM payment_requests WHERE reference=?").get(id).q;
const idOf=p=>parseTlv(parseTlv(p).find(x=>x[0]==="29")[1])[1][1];
const switchTo=async(c,cfg,extra={})=>{await pay.putPaymentSettings(c.env,"adm",{...cfg,...extra},NOW);await pay.verifyPaymentSettings(c.env,"adm",{confirmName:cfg.payeeName},NOW)};

test("SAFETY: QR codes and payment links already issued keep pointing at the account they were issued for after the receiving account changes; new orders use the new account",async()=>{
  const c=await ready(await setupV1());const {env,sqlite}=c;
  const a=await mk(env),b=await mk(env);const pa=payload(sqlite,a.id),svgBefore=await pay.getPaySvg(env,a.id,tok(a),NOW),viewBefore=await pay.getPayView(env,a.id,tok(a),NOW);
  assert.equal(idOf(pa),"0066800000000");
  await switchTo(c,NEW,{acknowledgeOutstanding:true});                                  // owner changes the receiving account (acknowledging the 2 open orders)
  assert.equal(payload(sqlite,a.id),pa,"stored QR payload untouched");assert.equal(await pay.getPaySvg(env,a.id,tok(a),NOW),svgBefore,"served QR image identical");
  const viewAfter=await pay.getPayView(env,a.id,tok(a),NOW);assert.deepEqual([viewAfter.payment.payeeName,viewAfter.payment.amount,viewAfter.payment.state],[SYN.payeeName,980,"awaiting"],"payee NAME shown matches the QR it belongs to, not the new setting");assert.deepEqual(viewAfter.payment,viewBefore.payment);
  const c2=await mk(env);assert.equal(c2.payment.payeeName,NEW.payeeName);assert.equal(idOf(payload(sqlite,c2.id)),"0066811111111","new order → new account");
  assert.notEqual(payload(sqlite,c2.id),pa);
  // the admin sees which orders hold an old-account QR so the right statement is checked
  const list=await svc.listOrders(env,{});const m=Object.fromEntries(list.map(o=>[o.id,o.payment]));
  assert.equal(m[a.id].legacyPayee,true);assert.equal(m[b.id].legacyPayee,true);assert.equal(m[c2.id].legacyPayee,false);assert.equal(m[a.id].payeeMasked,"080-xxx-0000");
  // confirming an old-QR order works (money arrived in the OLD account) and links the old request + bank reference
  await svc.changeStatus(env,"adm",{orderNo:a.id,from:S.PENDING,to:S.PAID,amount:980,bankTxnRef:"OLD-ACCT-TXN-1",now:NOW});
  const y=sqlite.prepare("SELECT y.bank_txn_ref r, q.payee_id_masked m FROM payments y JOIN payment_requests q ON q.id=y.request_id WHERE y.status='confirmed'").get();assert.deepEqual([y.r,y.m],["OLD-ACCT-TXN-1","080-xxx-0000"]);
});
test("SAFETY: changing the account while unpaid QR orders exist needs an explicit acknowledgement; with none outstanding it does not; an unverified state keeps old links valid but issues no new QR",async()=>{
  const c=await ready(await setupV1());const {env,ctx,sqlite}=c;const a=await mk(env);
  const put=(b)=>call(worker,env,ctx,"/api/admin/settings/payment",{method:"PUT",body:b});
  const refused=await put(NEW);assert.equal(refused.status,400);assert.match((await refused.json()).message,/ยังรอชำระด้วย QR ของบัญชีเดิม 1 รายการ/);
  assert.equal(JSON.parse(sqlite.prepare("SELECT value v FROM settings WHERE key='payment'").get().v).promptpayId,"0800000000","nothing changed by the refused request");
  assert.equal((await put({...NEW,acknowledgeOutstanding:true})).status,200);
  const g=(await (await call(worker,env,ctx,"/api/admin/settings/payment")).json()).payment;assert.deepEqual([g.verified,g.outstandingUnpaid],[false,1]);
  // not verified yet: the new customer gets NO QR (bank fallback), the old customer's QR still works
  const n=await mk(env);assert.equal("payment" in n,false);assert.equal((await pay.getPayView(env,a.id,tok(a),NOW)).payment.state,"awaiting");
  // once the old order is paid, no outstanding requests remain for it; a further change needs no acknowledgement
  await svc.changeStatus(env,"adm",{orderNo:a.id,from:S.PENDING,to:S.PAID,amount:980,now:NOW});
  await svc.changeStatus(env,"adm",{orderNo:n.id,from:S.PENDING,to:S.CANCEL,now:NOW});
  assert.equal((await put({...SYN,id:"0822222222"})).status,200);
  // after the deadline outstanding requests no longer count
  const d=await ready(await setupV1());const o=await mk(d.env);assert.equal(await pay.outstandingRequests(d.env,NOW),1);assert.equal(await pay.outstandingRequests(d.env,T0+8*DAY),0);void o;
});
test("SAFETY: owner can withdraw every still-payable QR; links then show 'withdrawn' and serve no QR; orders stay pending; nothing is marked paid; new orders after re-verification get a fresh QR",async()=>{
  const c=await ready(await setupV1());const {env,ctx,sqlite}=c;const a=await mk(env),b=await mk(env);await svc.changeStatus(env,"adm",{orderNo:b.id,from:S.PENDING,to:S.PAID,amount:980,now:NOW});
  const rev=(body)=>call(worker,env,ctx,"/api/admin/payments/revoke-outstanding",{method:"POST",body});
  assert.equal((await rev({})).status,400);assert.equal((await call(worker,env,{},"/api/admin/payments/revoke-outstanding",{method:"POST",body:{confirm:true}})).status,403);
  const cross=await worker.fetch(new Request("https://orders.test/api/admin/payments/revoke-outstanding",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://evil.test"},body:JSON.stringify({confirm:true})}),env,ctx);assert.equal(cross.status,403);
  assert.deepEqual(await (await rev({confirm:true})).json(),{ok:true,revoked:1});
  const v=await pay.getPayView(env,a.id,tok(a),NOW);assert.deepEqual([v.payment.state,v.payment.amount],["revoked",980]);assert.ok(v.bank,"bank-transfer fallback still offered");assert.equal(await pay.getPaySvg(env,a.id,tok(a),NOW),null);
  assert.equal(sqlite.prepare("SELECT payment_status p FROM orders WHERE order_no=?").get(a.id).p,"pending");assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payments WHERE status='confirmed'").get().n,1,"only the explicitly confirmed order is paid");
  assert.equal(sqlite.prepare("SELECT status s FROM payment_requests WHERE reference=?").get(b.id).s,"verified","paid order's request untouched");
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM payment_events WHERE event='revoked_by_owner'").get().n,1);assert.equal(await pay.getPayView(env,a.id,tok(a),NOW+1000).then(x=>x.payment.state),"revoked","a view never silently re-issues it");
  await svc.changeStatus(env,"adm",{orderNo:a.id,from:S.PENDING,to:S.PAID,amount:980,bankTxnRef:"AFTER-REVOKE-1",now:NOW}); // manual confirmation still possible (money may have arrived before the revoke)
  assert.deepEqual(await svc.paymentIntegrity(env),[]);
  await switchTo(c,NEW);const n=await mk(env);assert.equal(idOf(payload(sqlite,n.id)),"0066811111111");
});
