import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
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
