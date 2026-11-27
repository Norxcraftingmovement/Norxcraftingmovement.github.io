import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {renderStaging,validateInputs,checkRendered,verifyD1List,deploymentCommands,productionIdentifiers,sha256,STAGING_HOST} from "../scripts/staging-lib.mjs";
import {guardSql} from "../src/env-guard-sql.mjs";
import * as imp from "../src/v1-import.mjs";
const root=new URL("../",import.meta.url),read=f=>JSON.parse(readFileSync(new URL(f,root),"utf8"));
const IN={d1Id:"11111111-2222-4333-8444-555555555555",rateLimitNs:"30000001",accessAud:"a".repeat(64),ownerEmail:"owner@example.test",notifyFrom:"alerts@example.test"};
const prod=productionIdentifiers(root);
const rendered=()=>renderStaging(IN,root);

test("committed configs: placeholders only, no real ids/addresses; workers.dev and preview URLs off everywhere; production sections fail closed",()=>{
  for(const f of ["wrangler.orders.jsonc","wrangler.orders-public.jsonc"]){
    const c=read(f);assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);
    for(const e of ["staging","production"]){const s=c.env[e];assert.equal(s.workers_dev,false);assert.equal(s.preview_urls,false);assert.match(s.d1_databases[0].database_id,/^REPLACE_/);assert.match(s.vars.MEDIA_ACCESS_AUD,/^REPLACE_/);assert.match(s.vars.MEDIA_ADMIN_EMAIL_HASH,/^REPLACE_/)}
    assert.ok(!/@(?!example)/.test(JSON.stringify(c).replace(/REPLACE_[A-Z_]+/g,"")),"no address committed");
  }
  assert.equal(read("wrangler.staging-storefront.jsonc").preview_urls,false);
  const pub=read("wrangler.orders-public.jsonc");assert.ok(!("send_email" in pub.env.production),"production sends no e-mail yet");assert.ok(!("STAGING_REQUIRE_ACCESS" in pub.env.production.vars));
  assert.match(pub.env.staging.send_email[0].destination_address,/^REPLACE_/);assert.equal(pub.env.staging.send_email[0].name,"EMAIL");
  assert.deepEqual(Object.keys(pub.env.staging.send_email[0]).sort(),["destination_address","name"],"restricted to ONE destination, no allow-lists");
});
test("render: flat staging-only configs, owner hash derived, staging DB + dedicated rate limit + one cron, e-mail binding restricted to the owner address",()=>{
  const c=rendered(),a=c["wrangler.orders.jsonc"],p=c["wrangler.orders-public.jsonc"],s=c["wrangler.staging-storefront.jsonc"];
  assert.ok(!/REPLACE_/.test(JSON.stringify(c)));for(const x of [a,p,s])assert.ok(!("env" in x)&&x.workers_dev===false&&x.preview_urls===false);
  assert.deepEqual([a.name,p.name,s.name],["norx-orders-staging","norx-orders-public-staging","norx-staging-storefront"]);
  assert.deepEqual([a.main,p.main],["../src/orders-admin-worker.mjs","../src/orders-public-worker.mjs"]);assert.equal(a.d1_databases[0].migrations_dir,"../migrations/orders");assert.equal(s.assets.directory,"../dist-staging");
  for(const x of [a,p]){assert.deepEqual([x.d1_databases[0].binding,x.d1_databases[0].database_name,x.d1_databases[0].database_id],["ORDERS_DB","norx-orders-staging",IN.d1Id]);assert.equal(x.vars.MEDIA_ADMIN_EMAIL_HASH,sha256("owner@example.test"));assert.equal(x.vars.MEDIA_ACCESS_AUD,IN.accessAud)}
  assert.deepEqual(p.send_email,[{name:"EMAIL",destination_address:"owner@example.test"}]);assert.equal(p.vars.NOTIFY_FROM,"alerts@example.test");assert.equal(p.vars.STAGING_REQUIRE_ACCESS,"1");
  assert.equal(p.ratelimits[0].namespace_id,"30000001");assert.deepEqual(p.triggers.crons,["* * * * *"]);assert.ok(!("triggers" in a));
  assert.equal(p.vars.ORDERS_PUBLIC_ORIGINS,"https://"+STAGING_HOST);assert.equal(a.vars.ORDERS_ALLOWED_ORIGIN,"https://"+STAGING_HOST);
  assert.deepEqual(checkRendered(c,{d1Id:IN.d1Id,ownerEmail:IN.ownerEmail},prod),[]);
});
test("render refuses unsafe inputs: production ids, shared rate-limit namespace, malformed values",()=>{
  assert.deepEqual(validateInputs(IN,prod),[]);
  const bad=(o,re)=>assert.match(validateInputs({...IN,...o},prod).join("|"),re);
  bad({d1Id:"7c78c89c-533e-43f1-9267-f0521a7068d5"},/equals a production database id/);bad({d1Id:"not-a-uuid"},/UUID/);bad({rateLimitNs:"20261213"},/production rate-limit/);bad({rateLimitNs:"abc"},/numeric/);
  bad({accessAud:"short"},/64-hex/);bad({ownerEmail:"nope"},/owner address/);bad({notifyFrom:""},/sender address/);
  assert.throws(()=>renderStaging({...IN,d1Id:"7c78c89c-533e-43f1-9267-f0521a7068d5"},root),/invalid staging inputs/);
});
test("pre-flight catches every way a staging config could reach production or the public internet",()=>{
  const ex={d1Id:IN.d1Id,ownerEmail:IN.ownerEmail},mut=(f,fn)=>{const c=rendered();fn(c[f]);return checkRendered(c,ex,prod).join("|")};
  const A="wrangler.orders.jsonc",P="wrangler.orders-public.jsonc";
  assert.match(mut(A,c=>{c.workers_dev=true}),/workers_dev must be false/);assert.match(mut(P,c=>{c.preview_urls=true}),/preview_urls must be false/);
  assert.match(mut(A,c=>{c.d1_databases[0].database_id="7c78c89c-533e-43f1-9267-f0521a7068d5"}),/production identifier|D1 binding/);
  assert.match(mut(A,c=>{c.d1_databases.push({binding:"EVENTS_DB",database_name:"norx-events",database_id:"7c78c89c-533e-43f1-9267-f0521a7068d5"})}),/Events|production identifier/);
  assert.match(mut(P,c=>{c.r2_buckets=[{binding:"MEDIA_BUCKET",bucket_name:"norx-event-media"}]}),/Events\/Media\/R2/);
  assert.match(mut(P,c=>{c.vars.ORDERS_PUBLIC_ORIGINS="https://norxcraftingmovement.com"}),/only the staging host/);assert.match(mut(P,c=>{c.vars.STAGING_REQUIRE_ACCESS="0"}),/STAGING_REQUIRE_ACCESS/);
  assert.match(mut(P,c=>{c.ratelimits[0].namespace_id="20261213"}),/production identifier/);assert.match(mut(P,c=>{delete c.ratelimits}),/rate-limit/);
  assert.match(mut(P,c=>{c.send_email[0].destination_address="someone@example.test"}),/restricted to the single verified owner/);assert.match(mut(P,c=>{c.send_email[0].allowed_destination_addresses=["a@example.test","b@example.test"]}),/restricted/);assert.match(mut(P,c=>{c.send_email.push({name:"X",destination_address:IN.ownerEmail})}),/restricted/);
  assert.match(mut(A,c=>{c.routes=[{pattern:"staging.norxcraftingmovement.com/*"}]}),/routes must be configured by the owner/);assert.match(mut(A,c=>{c.vars.ENVIRONMENT="production"}),/'staging'/);
  assert.match(mut(A,c=>{c.vars.MEDIA_ADMIN_EMAIL_HASH="REPLACE_WITH_SHA256_OF_OWNER_EMAIL"}),/REPLACE_|not configured/);assert.match(mut(P,c=>{c.vars.X="https://script.google.com/macros/s/AKfyc/exec"}),/Apps Script/);
  assert.match(mut("wrangler.staging-storefront.jsonc",c=>{c.d1_databases=[]}),/assets-only/);
});
test("D1 identity check: exact name AND id, exactly one match; a production database or wrong id aborts",()=>{
  const ok=[{name:"norx-orders-staging",uuid:IN.d1Id},{name:"norx-orders",uuid:"99999999-2222-4333-8444-555555555555"},{name:"norx-events",uuid:"7c78c89c-533e-43f1-9267-f0521a7068d5"}];
  assert.deepEqual(verifyD1List(ok,{id:IN.d1Id}),{ok:true,id:IN.d1Id,name:"norx-orders-staging"});
  assert.equal(verifyD1List(ok,{id:"99999999-2222-4333-8444-555555555555"}).ok,false,"id of the production orders DB is refused");
  assert.equal(verifyD1List(ok,{id:"00000000-2222-4333-8444-555555555555"}).ok,false);assert.equal(verifyD1List([],{id:IN.d1Id}).ok,false);assert.equal(verifyD1List([...ok,{name:"norx-orders-staging",uuid:"x"}],{id:IN.d1Id}).ok,false,"duplicate names");
  assert.equal(verifyD1List({result:ok},{id:IN.d1Id}).ok,true);assert.equal(verifyD1List([{name:"norx-orders-staging",uuid:"aaaaaaaa-2222-4333-8444-555555555555"}],{id:IN.d1Id}).ok,false);
});
test("deployment sequence: every remote D1 operation is --remote with the staging-only config; identity verified before the first write; nothing targets production",()=>{
  const sh=deploymentCommands(),lines=sh.split("\n").filter(l=>l.startsWith("npx wrangler"));
  for(const l of lines.filter(l=>/d1 (execute|migrations)/.test(l)))assert.ok(l.includes("--remote")&&l.includes("-c .staging/wrangler.orders.jsonc")&&l.includes("norx-orders-staging"),l);
  for(const l of lines.filter(l=>/ deploy/.test(l)))assert.match(l,/-c \.staging\/wrangler\./);
  assert.ok(!/--env|norx-orders ["']|norx-events|production|workers\.dev/.test(sh.replace(/# .*\n/g,"")));
  assert.ok(sh.indexOf("staging-verify-d1")<sh.indexOf("migrations apply"));assert.ok(sh.indexOf("migrations apply")<sh.indexOf("seed.guarded.sql"));assert.ok(sh.indexOf("wrangler deploy --dry-run")<sh.indexOf("wrangler deploy -c"));
  assert.ok(sh.indexOf("d1 list --json")<sh.indexOf("d1 execute"));assert.match(sh,/set -euo pipefail/);assert.ok(!/@/.test(sh.replace(/\$\{?NORX_[A-Z_]+/g,"")),"no address in script");
});
test("environment guard SQL: runs only on a database marked with the expected environment; everything else aborts the whole file",()=>{
  const mk=(marker)=>{const d=new DatabaseSync(":memory:");d.exec("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;CREATE TABLE t(x)");if(marker)d.prepare("INSERT INTO meta VALUES ('environment',?)").run(marker);return d};
  const run=(d,sql)=>{d.exec("BEGIN");try{d.exec(sql);d.exec("COMMIT")}catch(e){d.exec("ROLLBACK");throw e}};
  const file=guardSql("staging")+"INSERT INTO t VALUES (1);";
  const ok=mk("staging");run(ok,file);assert.equal(ok.prepare("SELECT COUNT(*) n FROM t").get().n,1);
  for(const m of ["production",null,"staging2"]){const d=mk(m);assert.throws(()=>run(d,file),/malformed JSON/);assert.equal(d.prepare("SELECT COUNT(*) n FROM t").get().n,0,"nothing applied against marker "+m)}
  assert.throws(()=>guardSql("prod"),/unknown/);
  // the same guard in front of a V1 sync file
  const plan={at:"2026-12-01T00:00:00.000Z",rounds:[],orders:[],report:{}};assert.ok(imp.renderSql(plan,{guard:"staging"}).startsWith("-- environment guard"));assert.ok(!imp.renderSql(plan).includes("environment guard"));
});
test("the generated seed file for staging is guarded and synthetic",()=>{
  const seed=readFileSync(new URL("seeds/orders-staging-synthetic.sql",root),"utf8");assert.match(seed,/SYNTHETIC DATA ONLY/);assert.ok(!/@(?!example)|\d{3}-\d-\d{5}-\d/.test(seed));
  const d=new DatabaseSync(":memory:");d.exec(readFileSync(new URL("migrations/orders/0001_core.sql",root),"utf8"));
  assert.throws(()=>d.exec(guardSql("staging")+seed),/malformed JSON/,"fresh DB without the marker is refused");
  d.exec("INSERT INTO meta VALUES ('environment','staging')");d.exec(guardSql("staging")+seed.replace(/INSERT INTO meta\(key,value\) VALUES \('environment','staging'\),\('schema','1'\);/,"INSERT INTO meta(key,value) VALUES ('schema','1');"));
  assert.ok(d.prepare("SELECT COUNT(*) n FROM orders").get().n>0);
});

// ---------- deployment SQL sequence, executed exactly as the runbook script lists it ----------
import {seedSql} from "../scripts/staging-lib.mjs";
import {readdirSync} from "node:fs";
function wrangler(db){ // emulates `wrangler d1 migrations apply` (tracked, idempotent) and `d1 execute --command/--file` (one transaction)
  db.exec("CREATE TABLE IF NOT EXISTS d1_migrations(name TEXT PRIMARY KEY)");
  return {
    migrations(){for(const f of readdirSync(new URL("migrations/orders/",root)).sort()){if(db.prepare("SELECT 1 x FROM d1_migrations WHERE name=?").get(f))continue;db.exec("BEGIN");try{db.exec(readFileSync(new URL("migrations/orders/"+f,root),"utf8"));db.prepare("INSERT INTO d1_migrations VALUES (?)").run(f);db.exec("COMMIT")}catch(e){db.exec("ROLLBACK");throw e}}},
    exec(sql){db.exec("BEGIN");try{db.exec(sql);db.exec("COMMIT")}catch(e){db.exec("ROLLBACK");throw e}},
    query(sql){return db.prepare(sql).all()}};
}
const dumpDb=db=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='d1_migrations' ORDER BY name").all().map(t=>[t.name,db.prepare(`SELECT * FROM "${t.name}" ORDER BY 1`).all()]));
function runbookSteps(){ // parsed from the generated script itself, in order
  const out=[];for(const l of deploymentCommands().split("\n")){
    if(/migrations apply/.test(l))out.push({kind:"migrate"});
    const c=l.match(/d1 execute \S+ --remote -c \S+ --command "(.*?)"( --json)?( \|.*)?$/);if(c)out.push({kind:"command",sql:c[1],verify:/grep -q/.test(l)});
    if(/--file \.staging\/seed\.guarded\.sql/.test(l))out.push({kind:"file"});
  }return out;
}
test("RUNBOOK SQL SEQUENCE: migrate → marker → marker read-back → guarded seed, executed exactly as listed, TWICE: first run succeeds, second run is a no-op (identical database)",()=>{
  const steps=runbookSteps();assert.deepEqual(steps.map(s=>s.kind),["migrate","command","command","file"],"the script's D1 steps");
  const db=new DatabaseSync(":memory:");db.exec("PRAGMA foreign_keys=ON");const w=wrangler(db);
  const pass=()=>{for(const s of steps){if(s.kind==="migrate")w.migrations();else if(s.kind==="command"){const r=db.prepare(s.sql).all?w.query(s.sql):null;void r}else w.exec(seedSql(root))}};
  const run=()=>{for(const s of steps){
    if(s.kind==="migrate")w.migrations();
    else if(s.kind==="command"){ if(/^SELECT/i.test(s.sql)){const rows=w.query(s.sql);assert.deepEqual(rows.map(r=>r.value),["staging"],"marker reads back as 'staging'")} else w.exec(s.sql) }
    else w.exec(seedSql(root));}};
  run();const first=dumpDb(db);assert.ok(db.prepare("SELECT COUNT(*) n FROM orders").get().n>=5);assert.equal(db.prepare("SELECT value v FROM meta WHERE key='environment'").get().v,"staging");
  run();assert.equal(dumpDb(db),first,"second run changes nothing");
  run();assert.equal(dumpDb(db),first,"third run changes nothing");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM d1_migrations").get().n,readdirSync(new URL("migrations/orders/",root)).length,"migrations applied once");
  void pass;
  // the seed alone is repeatable too (e.g. re-run after a partial failure)
  w.exec(seedSql(root));w.exec(seedSql(root));assert.equal(dumpDb(db),first);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meta WHERE key='environment'").get().n,1,"exactly one environment marker row");
});
test("RUNBOOK SQL SEQUENCE safety: a database marked production (or unmarked) is refused by the seed and nothing is written; an interrupted first run can simply be repeated",()=>{
  const steps=runbookSteps(),marker=steps.find(s=>s.kind==="command"&&!/^SELECT/i.test(s.sql)).sql;
  for(const bad of ["production",null]){
    const db=new DatabaseSync(":memory:");const w=wrangler(db);w.migrations();if(bad)db.prepare("INSERT INTO meta VALUES ('environment',?)").run(bad);
    assert.throws(()=>w.exec(seedSql(root)),/malformed JSON/);assert.equal(db.prepare("SELECT COUNT(*) n FROM orders").get().n,0);assert.equal(db.prepare("SELECT COUNT(*) n FROM products").get().n,0);
    if(bad==="production")w.exec(marker),assert.equal(db.prepare("SELECT value v FROM meta WHERE key='environment'").get().v,"production","the marker command never overwrites an existing environment");
  }
  const db=new DatabaseSync(":memory:");const w=wrangler(db);w.migrations();w.exec(marker);
  const seed=seedSql(root);assert.throws(()=>w.exec(seed+"\nINSERT INTO nonexistent VALUES (1);"),/no such table/);assert.equal(db.prepare("SELECT COUNT(*) n FROM orders").get().n,0,"a failing file is rolled back as a whole");
  w.exec(seed);assert.ok(db.prepare("SELECT COUNT(*) n FROM orders").get().n>=5);
  assert.ok(!/INSERT INTO (?!OR IGNORE)/.test(readFileSync(new URL("seeds/orders-staging-synthetic.sql",root),"utf8").replace(/--.*\n/g,"")),"every seed INSERT is OR IGNORE");
});

import {cookieHeader} from "../scripts/staging-session.mjs";
test("owner session → Cookie header: honours domain, path, secure and expiry; the committed scripts/runbook use the owner session, not service tokens",()=>{
  const now=Date.parse("2026-12-01T00:00:00Z"),st={cookies:[
    {name:"CF_Authorization",value:"AAA",domain:"staging.norxcraftingmovement.com",path:"/",secure:true,expires:now/1000+3600},
    {name:"expired",value:"X",domain:"staging.norxcraftingmovement.com",path:"/",secure:true,expires:now/1000-10},
    {name:"session",value:"S",domain:".norxcraftingmovement.com",path:"/",secure:true,expires:-1},
    {name:"other",value:"O",domain:"example.test",path:"/",secure:false,expires:-1},
    {name:"admin-only",value:"P",domain:"staging.norxcraftingmovement.com",path:"/admin",secure:true,expires:-1}]};
  assert.equal(cookieHeader(st,"https://staging.norxcraftingmovement.com/api/orders",now),"CF_Authorization=AAA; session=S");
  assert.equal(cookieHeader(st,"https://staging.norxcraftingmovement.com/admin/orders/",now),"CF_Authorization=AAA; session=S; admin-only=P");
  assert.equal(cookieHeader(st,"http://staging.norxcraftingmovement.com/",now),"","secure cookies are never sent over http");assert.equal(cookieHeader({},"https://staging.norxcraftingmovement.com"),"");
  for(const f of ["scripts/staging-smoke.mjs","scripts/staging-ui-check.mjs","scripts/staging-lib.mjs"])assert.ok(!/CF-Access-Client-(Id|Secret)/i.test(readFileSync(new URL(f,root),"utf8").replace(/\/\/.*\n/g,"")),f+" must not use service-token headers");
  assert.ok(readFileSync(new URL(".gitignore",root),"utf8").includes("/.staging/"),"saved sessions live under the git-ignored .staging/");
});

import {judge,checkGate,PROBES} from "../scripts/staging-gate.mjs";
test("DEPLOYMENT ORDER: Access exists before anything is reachable; Workers deploy without routes; DNS/routes last; the gate precedes every test; nothing destructive anywhere",()=>{
  const sh=deploymentCommands(),i=(re)=>{const m=sh.search(re);assert.ok(m>=0,String(re));return m};
  const access=i(/# 6\. OWNER[^\n]*Access/),deploy=i(/npx wrangler deploy -c/),dns=i(/# 7\. OWNER[^\n]*reachable/),gate=i(/node scripts\/staging-gate\.mjs/),smoke=i(/staging-smoke\.mjs/);
  assert.ok(deploy<dns,"Workers are deployed before any route/DNS exists (so they are unreachable meanwhile)");assert.ok(access<dns,"Access is applied before DNS/routes make the host reachable");assert.ok(dns<gate&&gate<smoke,"gate between exposure and any test");
  assert.match(sh,/self-hosted application for[\s\S]*was created in the prerequisites/);assert.match(sh,/no service-token, bypass, everyone/);
  const code=sh.split("\n").filter(l=>!l.startsWith("#")).join("\n");
  assert.ok(!/\b(delete|rm -|drop table|d1 delete|--force|destroy|truncate|DELETE FROM)\b/i.test(code),"no destructive command");assert.ok(!/ route /i.test(code.replace(/node scripts.*/g,"")),"routes are not created by script");
  assert.ok(!/workers\.dev|--env production|norx-orders["' ]/.test(code.replace(/norx-orders-staging/g,"")));
  assert.match(sh,/add the DNS record for "staging" ONLY/);
});
test("ACCESS GATE: only an Access redirect / content-free 401|403 passes; any 200, application 404, application body or foreign redirect fails the whole gate",async()=>{
  assert.equal(judge(302,"https://norx.cloudflareaccess.com/cdn-cgi/access/login/staging?x=1","").ok,true);assert.equal(judge(403,"","Forbidden").ok,true);assert.equal(judge(401,"","").ok,true);
  for(const [st,loc,body] of [[200,"","ok"],[404,"","Not found"],[403,"",'{"ok":false,"error":"ACCESS_REQUIRED"}'],[403,"","<title>NORX</title>"],[302,"https://evil.test/login",""],[302,"https://cloudflareaccess.com.evil.test/",""],[500,"",""]])assert.equal(judge(st,loc,body).ok,false,st+" "+loc+" "+body);
  const mk=(f)=>async(u,o)=>f(new URL(u).pathname,o.method);
  const closed=mk(()=>new Response(null,{status:302,headers:{location:"https://norx.cloudflareaccess.com/cdn-cgi/access/login/x"}}));
  const ok=await checkGate({base:"https://staging.example.test",fetchImpl:closed});assert.equal(ok.ok,true);assert.equal(ok.results.length,PROBES.length);
  for(const leak of ["/","/api/orders","/admin/","/shop.js","/api/admin/dashboard"]){const r=await checkGate({base:"https://staging.example.test",fetchImpl:mk((p)=>p===leak?new Response("hello NORX",{status:200}):new Response(null,{status:302,headers:{location:"https://norx.cloudflareaccess.com/x"}}))});assert.equal(r.ok,false,leak);assert.ok(r.results.find(x=>x.path===leak).why)}
  assert.equal((await checkGate({base:"https://staging.example.test",fetchImpl:async()=>{throw new Error("ECONNREFUSED")}})).ok,false,"an unreachable host is not 'closed' evidence");
  // the local simulation: anonymous requests are blocked everywhere; if Access were missing the gate would flag it
  const {start}=await import("../scripts/dev-staging-local.mjs");const {mkdtempSync}=await import("node:fs");const {tmpdir}=await import("node:os");const {build}=await import("../scripts/build-staging-storefront.mjs");
  const d=mkdtempSync(join(tmpdir(),"g-"));build(d);const sim=await start(0,{staticDir:d});
  try{const blocked=await checkGate({base:sim.url,fetchImpl:(u,o)=>fetch(u,{...o,headers:{...o.headers,"x-dev-anon":"1"}})});assert.equal(blocked.ok,true,JSON.stringify(blocked.results.filter(r=>!r.ok)));
    const exposed=await checkGate({base:sim.url});assert.equal(exposed.ok,false,"without Access in front, the gate must fail");}finally{sim.server.close()}
});
