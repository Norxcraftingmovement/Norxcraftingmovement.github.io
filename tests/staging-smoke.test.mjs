import test from "node:test";
import assert from "node:assert/strict";
import {start} from "../scripts/dev-staging-local.mjs";
import {runSmoke} from "../scripts/staging-smoke.mjs";
import {build} from "../scripts/build-staging-storefront.mjs";
import {mkdtempSync} from "node:fs";import {tmpdir} from "node:os";import {join} from "node:path";
const fresh=()=>{const d=mkdtempSync(join(tmpdir(),"norx-stg-"));build(d);return d}; // own build dir: test files run in parallel

test("staging smoke suite passes end-to-end against the local staging simulation (same routing, Access emulation, mock e-mail binding)",async()=>{
  const {server,url}=await start(0,{staticDir:fresh()});
  try{
    const rep=await runSmoke({base:url,anonHeaders:{"x-dev-anon":"1"},orders:6,cronPath:"/__dev/cron",withCutoff:true});
    assert.deepEqual(rep.results.filter(r=>!r.ok),[]);assert.equal(rep.summary.failed,0);assert.ok(rep.summary.passed>=11);
    assert.ok(rep.latency.orderCreation.client.p50>=0&&rep.latency.dashboardDataUpdate.n===6&&rep.latency.notification.count>0,"latency figures are reported separately for order creation, dashboard update and notification");
  }finally{server.close()}
});
test("the smoke suite actually detects problems: failing e-mail provider and missing Access emulation are reported, not hidden",async()=>{
  const {server,url}=await start(0,{emailFails:true,staticDir:fresh()});
  try{
    const rep=await runSmoke({base:url,anonHeaders:{"x-dev-anon":"1"},orders:2,cronPath:"/__dev/cron"});
    const failed=rep.results.filter(r=>!r.ok).map(r=>r.name);assert.ok(failed.some(n=>/notifications/.test(n)),"undelivered notifications must fail the suite: "+failed.join("|"));
  }finally{server.close()}
  const ok=await start(0,{staticDir:fresh()});
  try{ // an "anonymous" probe that is in fact authenticated (no Access in front) must be flagged
    const open=await runSmoke({base:ok.url,anonHeaders:{},orders:1,cronPath:"/__dev/cron"});
    assert.ok(open.results.some(r=>!r.ok&&/unauthorised/.test(r.name)),"an unprotected host is flagged");
  }finally{ok.server.close()}
});
test("smoke CLI refuses to run against the production host",async()=>{
  const {spawnSync}=await import("node:child_process");
  for(const base of ["https://norxcraftingmovement.com","https://norxcraftingmovement.com/","https://www.norxcraftingmovement.com","https://example.test"]){
    const r=spawnSync(process.execPath,["scripts/staging-smoke.mjs","--base",base],{cwd:new URL("../",import.meta.url)});assert.equal(r.status,2,base);assert.match(String(r.stderr),/refusing/);
  }
});
