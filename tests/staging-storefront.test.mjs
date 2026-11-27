import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync,statSync,existsSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {build,transformHtml,STAGING_ORIGIN} from "../scripts/build-staging-storefront.mjs";
const root=fileURLToPath(new URL("../",import.meta.url)),out=join(root,"dist-staging"); // fileURLToPath: URL.pathname gives C:\C:\… on Windows
const walk=d=>readdirSync(d).flatMap(f=>statSync(join(d,f)).isDirectory()?walk(join(d,f)):[join(d,f)]);
const cfg=JSON.parse(readFileSync(join(root,"wrangler.staging-storefront.jsonc"),"utf8"));

test("D18: standalone staging storefront has NO production reachability (no Apps Script, events, admin, production origin)",()=>{
  const r=build();assert.equal(r.rewrites,5,"all five NORX_API declarations rewritten");
  const files=walk(out);
  assert.ok(files.some(f=>f.replaceAll("\\","/").endsWith("/cart/index.html")));
  for(const bad of ["events","admin"])assert.ok(!existsSync(join(out,bad)),bad+" must not be published to staging");
  for(const f of files.filter(f=>/\.(html|js|css|txt)$/.test(f))){const t=readFileSync(f,"utf8");assert.ok(!/script\.google\.com|\/api\/events|\/admin\//.test(t),f);assert.ok(!t.includes("https://norxcraftingmovement.com"),f+" production origin")}
  for(const p of ["index.html","cart/index.html","home-terrain/index.html","woven-stride/index.html","community/index.html"]){
    const t=readFileSync(join(out,p),"utf8");assert.match(t,/window\.NORX_API="\/api\/orders"/,p);assert.match(t,/noindex,nofollow/);assert.match(t,/STAGING/);
  }
  assert.equal(readFileSync(join(out,"robots.txt"),"utf8"),"User-agent: *\nDisallow: /\n");assert.match(readFileSync(join(out,"_headers"),"utf8"),/noindex, nofollow[\s\S]*no-store/);
});
test("D18: the storefront code posts only to the same-origin API it is given (shop.js unchanged)",()=>{
  assert.equal(readFileSync(join(out,"shop.js"),"utf8"),readFileSync(join(root,"shop.js"),"utf8"),"identical shop.js: staging tests the real storefront code");
  assert.match(readFileSync(join(root,"shop.js"),"utf8"),/fetch\(API\b/);assert.ok(!/fetch\(["'`]https?:/.test(readFileSync(join(out,"shop.js"),"utf8")));
});
test("D18: the build fails closed if a production reference slips in",()=>{
  const {html,apiRewrites}=transformHtml('<head></head><body><script>window.NORX_API="https://script.google.com/macros/s/AKfyc123/exec"</script></body>');
  assert.equal(apiRewrites,1);assert.ok(!html.includes("script.google.com"));
});
test("D18: staging worker config is assets-only: no D1, R2, rate limits, vars, routes or production bindings; nothing deploys it by default",()=>{
  assert.deepEqual(Object.keys(cfg).sort(),["assets","compatibility_date","name","preview_urls","workers_dev"]);assert.ok(!("binding" in cfg.assets),"assets-only Workers cannot declare an assets binding (rejected by wrangler)");
  assert.equal(cfg.workers_dev,false);assert.equal(cfg.name,"norx-staging-storefront");assert.ok(!/d1|r2|EVENTS|MEDIA|route|ratelimit/i.test(JSON.stringify(cfg)));
  assert.equal(cfg.assets.directory,"./dist-staging");
  const prodBuild=readFileSync(join(root,"scripts/build-cloudflare.mjs"),"utf8");assert.ok(!prodBuild.includes("dist-staging"),"production build never includes staging output");
  assert.ok(readFileSync(join(root,".gitignore"),"utf8").includes("/dist-staging/"));
  assert.equal(STAGING_ORIGIN,"https://staging.norxcraftingmovement.com");
});
