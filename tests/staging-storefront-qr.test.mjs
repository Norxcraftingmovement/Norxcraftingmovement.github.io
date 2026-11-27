import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync,statSync,mkdtempSync,rmSync,existsSync} from "node:fs";
import {join,basename} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {build,transformHtml,STAGING_QR_NOTICE} from "../scripts/build-staging-storefront.mjs";
// Staging must never show or ship the static QR of the REAL receiving account (assets/qr.jpg).
// Builds into its own temp dir (not dist-staging) so it cannot race staging-storefront.test.mjs; Windows-safe paths.
const root=fileURLToPath(new URL("../",import.meta.url));
const walk=d=>readdirSync(d).flatMap(f=>statSync(join(d,f)).isDirectory()?walk(join(d,f)):[join(d,f)]);

test("staging build ships no real payment QR: no qr.jpg file, no reference, staging notice in its place",()=>{
  const out=mkdtempSync(join(tmpdir(),"norx-staging-qr-"));
  try{
    const r=build(out);
    assert.equal(r.rewrites,5);assert.ok(r.qrRemoved>=1,"static QR block replaced");
    const files=walk(out);
    assert.ok(!files.some(f=>basename(f).toLowerCase()==="qr.jpg"),"assets/qr.jpg must not be uploaded to staging");
    assert.ok(existsSync(join(out,"assets","pay-panel.js")),"per-order PromptPay panel still shipped");
    for(const f of files.filter(f=>/\.(html|js|css|txt)$/.test(f))){const t=readFileSync(f,"utf8");assert.ok(!/\bqr\.jpg\b/i.test(t),f);assert.ok(!/<img\b[^>]*\bclass="qr"/.test(t),f)}
    const cart=readFileSync(join(out,"cart","index.html"),"utf8");
    assert.ok(cart.includes(STAGING_QR_NOTICE),"cart explains there is no real QR on staging");
    assert.ok(!/class="[^"]*\bqr-hint\b/.test(cart),"no 'save the QR image' hint element without an image (CSS rule may stay)");
  }finally{rmSync(out,{recursive:true,force:true})}
});
test("the fix is staging-only: production cart source keeps its QR untouched",()=>{
  const src=readFileSync(join(root,"cart","index.html"),"utf8");
  assert.match(src,/<img\b[^>]*\bclass="qr"[^>]*\bsrc="\.\.\/assets\/qr\.jpg"/);
  assert.ok(existsSync(join(root,"assets","qr.jpg")));
});
test("transformHtml replaces the static QR block and drops any other real-QR image",()=>{
  const block='<p class="qr-label">หรือสแกน QR</p><img class="qr" src="../assets/qr.jpg" alt="x" width="282" height="382"><p class="small qr-hint">a<br>b</p>';
  const a=transformHtml('<head></head><body><div>'+block+'</div></body>');
  assert.equal(a.qrRemoved,1);assert.ok(a.html.includes(STAGING_QR_NOTICE));assert.ok(!/qr\.jpg|qr-hint/.test(a.html));
  const b=transformHtml('<head></head><body><img src="/assets/qr.jpg"></body>');
  assert.equal(b.qrRemoved,1);assert.ok(!b.html.includes("qr.jpg"));
  const c=transformHtml('<head></head><body><img src="../assets/logo.png"></body>');
  assert.equal(c.qrRemoved,0);assert.ok(c.html.includes("logo.png"),"other images untouched");
});
