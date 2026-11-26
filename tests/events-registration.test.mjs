import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/events-worker.mjs";
const route = "/api/events/move-kids-2026/registration";
const origin = "http://localhost:8787";
const production = "https://norxcraftingmovement.com";
const schema = readFileSync(new URL("../migrations/events/0001_move_kids.sql", import.meta.url), "utf8");
function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  const db = {prepare(query) { const wrap = (values) => {
    const statement = sqlite.prepare(query.replace(/\?\d+/g, "?"));
    return {run: async () => statement.run(...values), first: async () => statement.get(...values)};
  }; return {...wrap([]), bind: (...values) => wrap(values)}; }};
  return {sqlite, env:{EVENTS_DB:db, EVENTS_TEST_MODE:"1", EVENTS_REGISTRATION_OPEN:"0",
    REGISTRATION_LIMITER:{limit:async()=>({success:true})}, ASSETS:{fetch:async()=>new Response("static")}}};
}
const payload = () => ({
  key: crypto.randomUUID(), fullName:"TEST PERSON", nickname:"TEST",
  phone:"0000000000", emergencyName:"TEST CONTACT", emergencyPhone:"0000000001",
  emergencyRelationship:"test", age:30, experience:"new",
  termsAccepted:true, safetyAccepted:true, equipmentAccepted:true, mediaConsent:false
});
function get(env, host=origin) { return worker.fetch(new Request(host+route), env); }
function post(env, values=payload(), host=origin, extra={}) {
  return worker.fetch(new Request(host+route,{method:"POST",headers:{
    Origin:host, "Content-Type":"application/json","CF-Connecting-IP":"192.0.2.1",...extra},
    body:typeof values==="string"?values:JSON.stringify(values)}),env);
}
const count = sqlite => sqlite.prepare("SELECT count(*) AS n FROM move_kids_registrations").get().n;
test("production closed and preview cannot write even if open flag enabled", async()=>{
  const {env,sqlite}=setup();
  assert.equal((await (await get(env,production)).json()).open,false);
  assert.equal((await post(env,payload(),production)).status,403);
  env.EVENTS_REGISTRATION_OPEN="1";
  assert.equal((await post(env,payload(),"https://preview.workers.dev")).status,403);
  assert.equal(count(sqlite),0);
});
test("local test submits with media opt-out; replay returns same ref and one row",async()=>{
  const {env,sqlite}=setup(); const p=payload();
  assert.deepEqual(await (await get(env)).json(),{open:true,test:true});
  const first=await (await post(env,p)).json();
  assert.match(first.reference,/^MK-/); assert.equal(first.test,true);
  assert.deepEqual(await (await post(env,p)).json(),first); assert.equal(count(sqlite),1);
  assert.equal(JSON.parse(sqlite.prepare("SELECT payload FROM move_kids_registrations").get().payload).mediaConsent,false);
  assert.equal((await post(env,{...p,nickname:"different"})).status,409);
});
test("media opt-in accepted and never required",async()=>{
  const {env,sqlite}=setup(); assert.equal((await post(env,{...payload(),mediaConsent:true})).status,200);
  assert.equal(JSON.parse(sqlite.prepare("SELECT payload FROM move_kids_registrations").get().payload).mediaConsent,true);
});
test("invalid fields, unapproved guardian/health input, malformed JSON, UUID, size",async()=>{
  const {env,sqlite}=setup();
  for(const bad of [{age:-1},{age:121},{phone:"bad"},{fullName:" "},{equipmentAccepted:false},{mediaConsent:"yes"},{mediaConsent:undefined},{key:"-".repeat(36)},{guardianName:"TEST"},{health:"TEST"}]){
    assert.equal((await post(env,{...payload(),...bad})).status,400,JSON.stringify(bad));
  }
  assert.equal((await post(env,"{")).status,400);
  assert.equal((await post(env,"x".repeat(4097))).status,413);
  assert.equal((await post(env,payload(),origin,{"Content-Type":"application/jsonevil"})).status,415);
  assert.equal(count(sqlite),0);
});
test("cross origin denied and GET/POST responses are not cacheable",async()=>{
  const {env,sqlite}=setup();
  assert.equal((await post(env,payload(),origin,{Origin:"https://other.example"})).status,403);
  assert.equal((await get(env)).headers.get("Cache-Control"),"no-store");
  assert.equal(count(sqlite),0);
});
test("missing database/limiter or broken database fail closed",async()=>{
  const {env}=setup();
  assert.equal((await (await get({...env,EVENTS_DB:undefined})).json()).open,false);
  assert.equal((await (await get({...env,EVENTS_REGISTRATION_OPEN:"1",REGISTRATION_LIMITER:undefined},production)).json()).open,false);
  const broken={...env,EVENTS_DB:{prepare(){throw Error("private detail")}}};
  assert.equal((await get(broken)).status,503);
  const result=await post(broken); assert.equal(result.status,503); assert.deepEqual(await result.json(),{error:"UNAVAILABLE"});
});
test("production rate limit rejects without writing, then accepts with allowed limiter (simulated only)",async()=>{
  const {env,sqlite}=setup(); env.EVENTS_REGISTRATION_OPEN="1";
  env.REGISTRATION_LIMITER={limit:async()=>({success:false})};
  assert.equal((await post(env,payload(),production)).status,429); assert.equal(count(sqlite),0);
  env.REGISTRATION_LIMITER={limit:async()=>({success:true})};
  const result=await (await post(env,payload(),production)).json();
  assert.match(result.reference,/^MK-/); assert.equal(result.test,false); assert.equal(count(sqlite),1);
});
test("unrelated route uses existing static assets; no roster endpoint",async()=>{
  const {env}=setup(); const response=await worker.fetch(new Request(origin+"/cart/"),env);
  assert.equal(await response.text(),"static");
  assert.deepEqual(await (await get(env)).json(),{open:true,test:true});
});
