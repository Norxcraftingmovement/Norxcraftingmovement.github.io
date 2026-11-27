import test from "node:test";
import assert from "node:assert/strict";
import {start} from "../scripts/dev-staging-local.mjs";
import {runSmoke} from "../scripts/staging-smoke.mjs";
import {build} from "../scripts/build-staging-storefront.mjs";
import {mkdtempSync} from "node:fs";import {tmpdir} from "node:os";import {join} from "node:path";
const fresh=()=>{const d=mkdtempSync(join(tmpdir(),"norx-stg-"));build(d);return d}; // own build dir: test files run in parallel

const RL={limit:10,periodMs:1500}; // same shape as production (10 per window), a shorter window only so the test runs fast
test("staging smoke suite passes end-to-end against the local staging simulation (same routing, Access emulation, mock e-mail binding, rate limiter)",async()=>{
  const {server,url}=await start(0,{staticDir:fresh(),rateLimit:RL});
  try{
    const rep=await runSmoke({base:url,anonHeaders:{"x-dev-anon":"1"},orders:25,cronPath:"/__dev/cron",withCutoff:true,rateLimit:RL,rateLimitTest:true});
    assert.deepEqual(rep.results.filter(r=>!r.ok),[]);assert.equal(rep.summary.failed,0);assert.ok(rep.summary.passed>=12);
    assert.ok(rep.latency.orderCreation.client.p50>=0&&rep.latency.dashboardDataUpdate.n===25&&rep.latency.notification.count>0,"latency figures are reported separately for order creation, dashboard update and notification");
    assert.equal(rep.latency.orderCreation.client.n,25,"a 25-order run stays inside a 10-per-window limit through client pacing");assert.ok(rep.latency.pacing.waitedMs>0,"pacing happened and is reported separately");
    assert.ok(rep.latency.orderCreation.client.max<RL.periodMs,"waiting for the limiter never leaks into the order-creation latency");
    assert.deepEqual([rep.rateLimit.recovered,rep.rateLimit.limit],[true,10]);assert.ok(rep.rateLimit.submitsRefused>=1&&rep.rateLimit.paymentRefused>=1,"the limiter is exercised in its own phase");
  }finally{server.close()}
});
test("defence in depth: with NO edge Access in front, the Workers themselves still refuse anonymous callers (and the smoke suite reports that as protected)",async()=>{
  const {server,url}=await start(0,{staticDir:fresh(),edgeAccess:false});
  try{
    for(const p of ["/api/orders","/api/orders/pay?o=NORX-AAAAAAAA&t="+"A".repeat(22),"/admin/","/api/admin/dashboard"]){const r=await fetch(url+p,{headers:{"x-dev-anon":"1"},redirect:"manual"});assert.equal(r.status,403,p)}
    const rep=await runSmoke({base:url,anonHeaders:{"x-dev-anon":"1"},orders:1,cronPath:"/__dev/cron",rateLimit:RL});assert.ok(rep.results.find(r=>/unauthorised/.test(r.name)).ok);
  }finally{server.close()}
});
test("rate limiting is checked separately: a suite that does NOT pace itself fails loudly (never hidden inside latency); a missing limiter is flagged",async()=>{
  const {server,url}=await start(0,{staticDir:fresh(),rateLimit:RL});
  try{
    const rep=await runSmoke({base:url,anonHeaders:{"x-dev-anon":"1"},orders:3,cronPath:"/__dev/cron",rateLimit:{limit:100,periodMs:1500}}); // thinks the limit is 100, server enforces 10
    const failed=rep.results.filter(r=>!r.ok);assert.ok(failed.some(r=>/rate limited/.test(r.detail)),"over-limit traffic is reported as a rate-limit problem: "+failed.map(r=>r.detail).join("|"));
  }finally{server.close()}
  const none=await start(0,{staticDir:fresh()});  // no limiter at all
  try{const rep=await runSmoke({base:none.url,anonHeaders:{"x-dev-anon":"1"},orders:2,cronPath:"/__dev/cron",rateLimit:RL,rateLimitTest:true});
    assert.ok(rep.results.some(r=>!r.ok&&/rate limit:/.test(r.name)),"missing limiter is flagged");}finally{none.server.close()}
});
test("the smoke suite actually detects problems: failing e-mail provider and missing Access emulation are reported, not hidden",async()=>{
  const {server,url}=await start(0,{emailFails:true,staticDir:fresh()});
  try{
    const rep=await runSmoke({base:url,anonHeaders:{"x-dev-anon":"1"},orders:2,cronPath:"/__dev/cron",rateLimit:RL});
    const failed=rep.results.filter(r=>!r.ok).map(r=>r.name);assert.ok(failed.some(n=>/notifications/.test(n)),"undelivered notifications must fail the suite: "+failed.join("|"));
  }finally{server.close()}
  const ok=await start(0,{staticDir:fresh()});
  try{ // an "anonymous" probe that is in fact authenticated (no Access in front) must be flagged
    const open=await runSmoke({base:ok.url,anonHeaders:{},orders:1,cronPath:"/__dev/cron",rateLimit:RL});
    assert.ok(open.results.some(r=>!r.ok&&/unauthorised/.test(r.name)),"an unprotected host is flagged");
  }finally{ok.server.close()}
});
test("smoke CLI refuses to run against the production host",async()=>{
  const {spawnSync}=await import("node:child_process");
  for(const base of ["https://norxcraftingmovement.com","https://norxcraftingmovement.com/","https://www.norxcraftingmovement.com","https://example.test"]){
    const r=spawnSync(process.execPath,["scripts/staging-smoke.mjs","--base",base],{cwd:new URL("../",import.meta.url)});assert.equal(r.status,2,base);assert.match(String(r.stderr),/refusing/);
  }
});
