import test from "node:test";
import assert from "node:assert/strict";
import {readdirSync,readFileSync,writeFileSync,mkdtempSync,rmSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {assets} from "../src/generated/orders-admin-assets.mjs";
// Added after an R5 edit put a // comment in the middle of a one-line statement: the Admin shipping page shipped to staging with a
// SyntaxError and no test noticed, because the browser modules were only ever loaded by a browser. Every Admin script is syntax-checked here.
const dir=fileURLToPath(new URL("../admin-ui/",import.meta.url));
const check=(file)=>spawnSync(process.execPath,["--check",file],{encoding:"utf8"});

test("every Admin browser module parses (node --check), source files",()=>{
  const files=readdirSync(dir).filter(f=>f.endsWith(".mjs"));
  assert.ok(files.length>=10,"found the Admin modules");
  for(const f of files){const r=check(join(dir,f));assert.equal(r.status,0,f+": "+r.stderr.split("\n").slice(0,4).join(" | "))}
});

test("the GENERATED assets that the Worker actually serves parse too",()=>{
  const tmp=mkdtempSync(join(tmpdir(),"norx-admin-assets-"));
  try{
    const names=Object.entries(assets).filter(([n,a])=>n.endsWith(".mjs")&&a.text!==undefined).map(([n])=>n);
    assert.ok(names.length>=10);
    for(const n of names){const f=join(tmp,n);writeFileSync(f,assets[n].text);const r=check(f);assert.equal(r.status,0,"served "+n+": "+r.stderr.split("\n").slice(0,4).join(" | "))}
  }finally{rmSync(tmp,{recursive:true,force:true})}
});

test("the generated module is in step with admin-ui (nobody edited a page and forgot to regenerate)",()=>{
  for(const [n,a] of Object.entries(assets)){
    if(a.text===undefined||!n.endsWith(".mjs"))continue;
    const src=readFileSync(join(dir,n),"utf8").replace(/\r\n/g,"\n");assert.equal(a.text.replace(/\r\n/g,"\n"),src,n+" differs from admin-ui/"+n);
  }
});
