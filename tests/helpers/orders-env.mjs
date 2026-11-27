import {DatabaseSync} from "node:sqlite";
import {readFileSync,readdirSync} from "node:fs";
const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
// All Orders migrations in order (0001_core, 0002_partial_receipts, ...), exactly as D1 applies them.
export const migrate=sqlite=>{for(const f of readdirSync(new URL("../../migrations/orders/",import.meta.url)).filter(f=>f.endsWith(".sql")).sort())sqlite.exec(read("migrations/orders/"+f));};
export const origin="https://orders.test";
// Minimal D1 emulation (prepare/bind/first/all/run/batch) over node:sqlite.
export function d1(sqlite,hooks={}){
  const stmt=(sql,args=[])=>({
    bind:(...a)=>stmt(sql,a),
    first:async()=>sqlite.prepare(sql).get(...args)??null,
    all:async()=>({results:sqlite.prepare(sql).all(...args)}),
    run:async()=>({success:true,meta:{changes:sqlite.prepare(sql).run(...args).changes}}),
    _run:()=>{hooks.onStatement?.(sql);return {success:true,meta:{changes:sqlite.prepare(sql).run(...args).changes}}}});
  // batch = one transaction, all-or-nothing (D1 semantics)
  return {prepare:sql=>stmt(sql),batch:async list=>{sqlite.exec("BEGIN");try{const out=list.map(s=>s._run());sqlite.exec("COMMIT");return out}catch(e){sqlite.exec("ROLLBACK");throw e}}};
}
export async function setup({seed=true}={}){
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
  migrate(sqlite);
  if(seed)sqlite.exec(read("seeds/orders-staging-synthetic.sql"));
  const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("owner@example.test"));
  const env={ENVIRONMENT:"staging",ORDERS_DB_LABEL:"staging",ORDERS_ALLOWED_ORIGIN:origin,ORDERS_DB:d1(sqlite),MEDIA_ADMIN_ENABLED:"1",MEDIA_ACCESS_AUD:"aud",
    MEDIA_ADMIN_EMAIL_HASH:Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,"0")).join("")};
  const ctx={access:{aud:"aud",getIdentity:async()=>({email:"owner@example.test"})}};
  return {sqlite,env,ctx};
}
export const call=(worker,env,ctx,path,{method="GET",body,headers={}}={})=>worker.fetch(new Request(origin+path,{method,headers:{...(body?{"Content-Type":"application/json",Origin:origin}:{}),...headers},body:body?JSON.stringify(body):undefined}),env,ctx);

// ---- V1-like fixture: public catalog (drop03/drop02, 490/590), fake bank, rounds around T0 (all SYNTHETIC) ----
export const T0=Date.parse("2026-12-01T00:00:00+07:00"),DAY=864e5;
export const NOW=T0+2*DAY; // inside ROUND-001
export async function setupV1({live=true,rolling=false,rounds=true}={}){
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
  migrate(sqlite);
  sqlite.exec("INSERT INTO meta(key,value) VALUES ('environment','staging')");
  sqlite.exec(`INSERT INTO products(id,slug,name,short_name,fit,fit_name,status,sort) VALUES
    (1,'drop03','HOME TERRAIN EDITION','DROP 03','boxy','ทรง Boxy','active',0),(2,'drop02','WOVEN STRIDE EDITION','DROP 02','regular','ทรงปกติ','active',1);
   INSERT INTO product_variants(product_id,sleeve,price_baht) VALUES (1,'short',490),(1,'long',590),(2,'short',490),(2,'long',590);`);
  const sz=(id,l)=>l.forEach((s,i)=>sqlite.prepare("INSERT INTO product_sizes(product_id,size,sort) VALUES (?,?,?)").run(id,s,i));
  sz(1,["XS","S","M","L","XL","2XL"]);sz(2,["XXS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL"]);
  if(rounds){
    const t=ms=>new Date(ms).toISOString();
    sqlite.prepare("INSERT INTO rounds(code,name,opens_at,closes_at,payment_due_at,shipping_baht,supplier_shipping_baht,deliveries,ready_text,status) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("ROUND-001","รอบ 1",t(T0),t(T0+6*DAY+86340e3),t(T0+7*DAY+10*3600e3),50,80,'["city","event","ship"]',"สินค้าพร้อมประมาณ 20 ธ.ค. – 28 ธ.ค.","open");
    sqlite.prepare("INSERT INTO rounds(code,name,opens_at,closes_at,payment_due_at,shipping_baht,supplier_shipping_baht,deliveries,ready_text,status) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("ROUND-002","รอบ 2",t(T0+7*DAY),t(T0+13*DAY+86340e3),t(T0+14*DAY),60,80,'["city","ship"]',"","open");
  }
  const store={bank:{name:"TEST BANK",account:"000-0-00000-0",holder:"TEST HOLDER"},chatUrl:"https://example.test/chat",pageUrl:"https://example.test/page",eventName:"TEST EVENT",liveEnabled:live,rolling,notifyTo:"owner@example.test"};
  if(!live)store.testKeyHash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode("test-key-12345"))),b=>b.toString(16).padStart(2,"0")).join("");
  sqlite.prepare("INSERT INTO settings(key,value) VALUES ('storefront',?)").run(JSON.stringify(store));
  const hooks={};const env={ENVIRONMENT:"staging",ORDERS_DB_LABEL:"staging",ORDERS_ALLOWED_ORIGIN:origin,ORDERS_PUBLIC_ORIGINS:"https://norxcraftingmovement.com",ORDERS_DB:d1(sqlite,hooks)};
  const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("owner@example.test"));
  Object.assign(env,{MEDIA_ADMIN_ENABLED:"1",MEDIA_ACCESS_AUD:"aud",MEDIA_ADMIN_EMAIL_HASH:Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,"0")).join("")});
  return {sqlite,env,hooks,ctx:{access:{aud:"aud",getIdentity:async()=>({email:"owner@example.test"})}}};
}
let n=0;
export const orderInput=(o={})=>({requestId:"req-"+String(++n).padStart(6,"0")+"-abcdefghij",roundId:"ROUND-001",name:"ทดสอบ นามสมมติ",phone:"080-000-0000",delivery:"city",address:"",
  items:[{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:2}],preorder:true,sizing:true,privacy:true,website:"",expectedTotal:980,...o});
