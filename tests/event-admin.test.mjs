import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {eventAdminFetch} from "../src/event-admin-worker.mjs";
const origin="https://norxcraftingmovement.com",root="/admin/events/";
const preview="https://feature-event-manager-norx-crafting-movement.norx-craftingmovement.workers.dev";
const allow=async()=>true,deny=async()=>false;
const ref="MK-123456789ABC";
function setup(){
 const sqlite=new DatabaseSync(":memory:");
 for(const file of ["0001_move_kids.sql","0002_move_kids_roster.sql","0003_move_kids_checkins.sql","0004_move_kids_registration_control.sql"])sqlite.exec(readFileSync(new URL("../migrations/events/"+file,import.meta.url),"utf8"));
 const db={prepare(sql){const positions=[];const query=sql.replace(/\?(\d+)/g,(_,pos)=>{positions.push(Number(pos)-1);return "?"});const st=sqlite.prepare(query);const bind=(values)=>{const args=positions.map(i=>values[i]);return {first:async()=>st.get(...args),all:async()=>({results:st.all(...args)}),run:async()=>st.run(...args)}};return {...bind([]),bind:(...values)=>bind(values)}}};
 const fixture={fullName:"=FORMULA",nickname:"QA 100%",phone:"0000000000",emergencyName:"TEST CONTACT",emergencyPhone:"0000000001",emergencyRelationship:"test",age:30,experience:"new",mediaConsent:false};
 sqlite.prepare("INSERT INTO move_kids_registrations(request_key,reference,payload) VALUES(?,?,?)").run("test",ref,JSON.stringify(fixture));
 return {sqlite,env:{EVENTS_DB:db,EVENTS_REGISTRATION_OPEN:"0"}};
}
const req=(path="",init={},host=origin)=>new Request(host+root+path,init);
const roster=(q="",offset=0,source=origin)=>req("roster",{method:"POST",headers:{Origin:source,"Content-Type":"application/json"},body:JSON.stringify({q,offset})});
const send=(body,source=origin)=>req("checkin",{method:"POST",headers:{Origin:source,"Content-Type":"application/json"},body:JSON.stringify(body)});
test("all private routes require signed owner authentication, unrelated routes untouched",async()=>{
 const {env,sqlite}=setup();
 for(const path of ["","roster","export"])assert.equal((await eventAdminFetch(req(path),env,deny)).status,403);
 assert.equal((await eventAdminFetch(send({reference:ref,checked:true}),env,deny)).status,403);
 assert.equal((await eventAdminFetch(req("roster",{},"https://unknown.workers.dev"),env,allow)).status,403);
 assert.equal(await eventAdminFetch(new Request(origin+"/cart/"),env,allow),null);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM move_kids_checkins").get().n,0);
});
test("isolated read-only demo with synthetic data; API and CSV disabled",async()=>{
 const {env}=setup();env.EVENT_ADMIN_DEMO="1";
 const page=await eventAdminFetch(req("",{},preview),env,deny);
 assert.equal(page.status,200);assert.match(await page.text(),/ข้อมูลสมมติเท่านั้น/);
 for(const path of ["roster","export","checkin"])assert.equal((await eventAdminFetch(req(path,{},preview),env,allow)).status,404);
});
test("roster SQL supports exact search, escaped wildcard, pagination, totals and closed status",async()=>{
 const {env}=setup();
 assert.equal((await eventAdminFetch(roster("",0,"https://evil.example"),env,allow)).status,403);
 const r=await eventAdminFetch(roster(),env,allow);
 assert.equal(r.status,200);assert.equal(r.headers.get("Cache-Control"),"no-store");
 const data=await r.json();assert.equal(data.open,false);assert.equal(data.total,1);assert.equal(data.checked,0);assert.equal(data.rows[0].reference,ref);assert.equal(data.rows[0].media_consent,0);
 assert.equal((await (await eventAdminFetch(roster("QA 100%"),env,allow)).json()).matched,1);
 assert.equal((await (await eventAdminFetch(roster("%"),env,allow)).json()).matched,1);
 assert.equal((await (await eventAdminFetch(roster("_"),env,allow)).json()).matched,0);
 assert.equal((await (await eventAdminFetch(roster("",50),env,allow)).json()).rows.length,0);
 assert.equal((await eventAdminFetch(roster("",-1),env,allow)).status,400);
});
test("check-in and undo, idempotent retries, unknown reference, cross-origin/invalid attempts",async()=>{
 const {env,sqlite}=setup();
 assert.equal((await eventAdminFetch(send({reference:ref,checked:true},"https://evil.example"),env,allow)).status,403);
 assert.equal((await eventAdminFetch(send({reference:ref,checked:1}),env,allow)).status,400);
 assert.equal((await eventAdminFetch(send({reference:"MK-AAAAAAAAAAAA",checked:true}),env,allow)).status,404);
 assert.equal((await eventAdminFetch(send({reference:ref,checked:true}),env,allow)).status,200);
 const first=sqlite.prepare("SELECT checked_in_at FROM move_kids_checkins").get().checked_in_at;assert.ok(first);
 assert.equal((await eventAdminFetch(send({reference:ref,checked:true}),env,allow)).status,200);
 assert.equal(sqlite.prepare("SELECT checked_in_at FROM move_kids_checkins").get().checked_in_at,first);
 assert.equal((await (await eventAdminFetch(roster(),env,allow)).json()).checked,1);
 assert.equal((await eventAdminFetch(send({reference:ref,checked:false}),env,allow)).status,200);
 assert.equal((await (await eventAdminFetch(roster(),env,allow)).json()).checked,0);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM move_kids_registrations").get().n,1);
});
test("CSV privacy headers and spreadsheet formula protection; missing storage fails closed",async()=>{
 const {env}=setup();const r=await eventAdminFetch(req("export"),env,allow);
 assert.equal(r.status,200);assert.match(r.headers.get("Content-Disposition"),/attachment/);assert.equal(r.headers.get("Cache-Control"),"no-store");
 assert.match(await r.text(),/"'=FORMULA"/);
 assert.equal((await eventAdminFetch(roster(),{},allow)).status,503);
});

test("owner control defaults closed, requires correct host, origin and explicit state, keeps signup records",async()=>{
 const {env,sqlite}=setup();
 const control=(open,expectedOpen,source=origin)=>req("registration",{method:"POST",headers:{Origin:source,"Content-Type":"application/json"},body:JSON.stringify({open,expectedOpen})});
 assert.equal((await eventAdminFetch(control(true,false),env,allow)).status,403);
 env.EVENTS_REGISTRATION_OPEN="admin";env.REGISTRATION_LIMITER={limit:async()=>({success:true})};
 const state=()=>sqlite.prepare("SELECT registration_open FROM event_registration_control").get().registration_open;
 assert.equal(state(),0);
 assert.equal((await eventAdminFetch(control(true,false),env,deny)).status,403);
 assert.equal((await eventAdminFetch(control(true,false,"https://evil.example"),env,allow)).status,403);
 assert.equal(state(),0);
 assert.equal((await eventAdminFetch(control(true,false),env,allow)).status,200);assert.equal(state(),1);
 assert.equal((await (await eventAdminFetch(roster(),env,allow)).json()).open,true);
 assert.equal((await eventAdminFetch(control(false,false),env,allow)).status,409);assert.equal(state(),1);
 assert.equal((await eventAdminFetch(control(false,true),env,allow)).status,200);assert.equal(state(),0);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM move_kids_registrations").get().n,1);
});
test("QR is a PNG download and points to the public event, preview cannot mutate",async()=>{
 const {env}=setup();
 const r=await eventAdminFetch(req("qr?download=1"),env,allow);assert.equal(r.status,200);assert.equal(r.headers.get("Content-Type"),"image/png");assert.match(r.headers.get("Content-Disposition"),/attachment/);
 const bytes=new Uint8Array(await r.arrayBuffer());assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(new DataView(bytes.buffer).getUint32(16),984);
 const page=await eventAdminFetch(req(),env,allow);assert.match(await page.text(),/https:\/\/norxcraftingmovement.com\/events\/move-kids-2026\//);
 assert.equal((await eventAdminFetch(req("registration",{method:"POST",headers:{Origin:preview,"Content-Type":"application/json"},body:'{"open":true,"expectedOpen":false}'},preview),{...env,EVENT_ADMIN_DEMO:"1"},allow)).status,404);
});
