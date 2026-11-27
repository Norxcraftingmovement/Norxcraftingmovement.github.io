import test from "node:test";
import assert from "node:assert/strict";
import {verifiedOwner as mine} from "../src/orders-access.mjs";
import {verifiedOwner as original} from "../src/admin-access-worker.mjs";
import pub from "../src/orders-public-worker.mjs";
import {setupV1,orderInput,NOW} from "./helpers/orders-env.mjs";
const hash=async e=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(e))),b=>b.toString(16).padStart(2,"0")).join("");
test("Orders owner check behaves exactly like the existing Access Worker's (differential), without bundling Events/Media code",async()=>{
  const H=await hash("owner@example.test"),good={MEDIA_ADMIN_ENABLED:"1",MEDIA_ACCESS_AUD:"aud",MEDIA_ADMIN_EMAIL_HASH:H},id=e=>({access:{aud:"aud",getIdentity:async()=>({email:e})}});
  const cases=[[id("owner@example.test"),good],[id("OWNER@example.test"),good],[id("other@example.test"),good],[{access:{aud:"x",getIdentity:async()=>({email:"owner@example.test"})}},good],[{},good],[undefined,good],[id("owner@example.test"),{...good,MEDIA_ADMIN_ENABLED:"0"}],[id("owner@example.test"),{...good,MEDIA_ACCESS_AUD:""}],
    [id("owner@example.test"),{...good,MEDIA_ADMIN_EMAIL_HASH:"REPLACE_WITH_SHA256_OF_OWNER_EMAIL"}],[{access:{aud:"aud",getIdentity:async()=>({})}},good],[{access:{aud:"aud",getIdentity:async()=>{throw new Error("x")}}},good],[id(5),good]];
  for(const [ctx,env] of cases)assert.equal(await mine(ctx,env),await original(ctx,env));
  assert.equal(await mine(id("owner@example.test"),good),true);
  const src=await (await import("node:fs/promises")).readFile(new URL("../src/orders-access.mjs",import.meta.url),"utf8");assert.ok(!/event|media-worker/i.test(src.replace(/Events\/Media/g,"")));
});
test("staging public Worker with STAGING_REQUIRE_ACCESS=1 refuses everyone but the owner on every path; without the flag it is public (production behaviour)",async()=>{
  const c=await setupV1();const {env}=c;const H=await hash("owner@example.test");
  Object.assign(env,{STAGING_REQUIRE_ACCESS:"1",MEDIA_ADMIN_ENABLED:"1",MEDIA_ACCESS_AUD:"aud",MEDIA_ADMIN_EMAIL_HASH:H});
  const owner={access:{aud:"aud",getIdentity:async()=>({email:"owner@example.test"})}};
  for(const p of ["/api/orders","/api/orders/pay?o=NORX-AAAAAAAA&t="+"A".repeat(22),"/api/orders/pay.svg?o=NORX-AAAAAAAA&t="+"A".repeat(22),"/nothing"])for(const ctx of [{},{access:{aud:"aud",getIdentity:async()=>({email:"x@example.test"})}}]){
    const r=await pub.fetch(new Request("https://orders.test"+p),env,ctx);assert.equal(r.status,403,p);assert.equal((await r.json()).error,"ACCESS_REQUIRED")}
  const post=await pub.fetch(new Request("https://orders.test/api/orders",{method:"POST",body:JSON.stringify({action:"submit",order:orderInput()})}),env,{});assert.equal(post.status,403);
  assert.equal((await pub.fetch(new Request("https://orders.test/api/orders"),env,owner)).status,200);
  const open=await setupV1();assert.equal((await pub.fetch(new Request("https://orders.test/api/orders"),open.env,{})).status,200);
});

import worker from "../src/orders-admin-worker.mjs";
import {readFileSync} from "node:fs";
test("AUTH: identities without a verified owner e-mail (e.g. service tokens) are never accepted, even with the right audience; no staging-only back door exists in the code",async()=>{
  const H=await hash("owner@example.test"),good={MEDIA_ADMIN_ENABLED:"1",MEDIA_ACCESS_AUD:"aud",MEDIA_ADMIN_EMAIL_HASH:H};
  const identities=[{common_name:"0123456789abcdef.access",type:"app"},{type:"app",service_token_id:"t-1"},{email:""},{email:null},{email:"owner@example.test.evil.test"},{sub:"owner@example.test"},{email:["owner@example.test"]},{}];
  for(const identity of identities){const ctx={access:{aud:"aud",getIdentity:async()=>identity}};assert.equal(await mine(ctx,good),false,JSON.stringify(identity));assert.equal(await original(ctx,good),false)}
  // through the real Workers (admin always; public when the staging flag is on)
  const c=await setupV1();Object.assign(c.env,{...good,STAGING_REQUIRE_ACCESS:"1"});
  for(const identity of identities){const ctx={access:{aud:"aud",getIdentity:async()=>identity}};
    assert.equal((await worker.fetch(new Request("https://orders.test/api/admin/dashboard"),c.env,ctx)).status,403);assert.equal((await pub.fetch(new Request("https://orders.test/api/orders"),c.env,ctx)).status,403)}
  // identity headers are request data, not trust
  const forged={"Cf-Access-Authenticated-User-Email":"owner@example.test","Cf-Access-Jwt-Assertion":"a.b.c","X-Auth-Request-Email":"owner@example.test","X-Forwarded-Email":"owner@example.test","X-Forwarded-User":"owner@example.test","Cf-Access-Client-Id":"x.access","Cf-Access-Client-Secret":"y"};
  for(const ctx of [{},{access:undefined}]){
    assert.equal((await worker.fetch(new Request("https://orders.test/api/admin/dashboard",{headers:forged}),c.env,ctx)).status,403);
    assert.equal((await worker.fetch(new Request("https://orders.test/admin/",{headers:forged}),c.env,ctx)).status,403);
    assert.equal((await pub.fetch(new Request("https://orders.test/api/orders",{headers:forged}),c.env,ctx)).status,403);
    const w=await worker.fetch(new Request("https://orders.test/api/admin/settings/payment",{method:"PUT",headers:{...forged,"Content-Type":"application/json",Origin:"https://orders.test"},body:"{}"}),c.env,ctx);assert.equal(w.status,403);
  }
  // production authentication is not weakened: no environment-dependent branch, no allow-list, no header reads
  for(const f of ["../src/orders-access.mjs","../src/orders-admin-worker.mjs"]){const t=readFileSync(new URL(f,import.meta.url),"utf8");assert.ok(!/headers\.get\(["'`](cf-access|x-auth|x-forwarded)/i.test(t),f+" must not read identity headers");assert.ok(!/SERVICE_(TOKEN|IDENTIT)|ALLOW_SERVICE|common_name/i.test(t),f+" has no service-identity allow-list")}
  assert.ok(!/ENVIRONMENT/.test(readFileSync(new URL("../src/orders-access.mjs",import.meta.url),"utf8")),"the owner check does not depend on the environment");
});
