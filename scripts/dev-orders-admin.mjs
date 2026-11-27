// LOCAL DEV ONLY: runs the orders admin Worker on 127.0.0.1 over an in-memory SQLite DB with SYNTHETIC data.
// The "owner" is faked locally; this never touches Cloudflare, production data or any real credentials.
import http from "node:http";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "../src/orders-admin-worker.mjs";
import * as svc from "../src/orders-service.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
export async function start(port=0){
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(read("migrations/orders/0001_core.sql"));sqlite.exec(read("seeds/orders-staging-synthetic.sql"));
  const stmt=(sql,args=[])=>({bind:(...a)=>stmt(sql,a),first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),
    run:async()=>({success:true,meta:{changes:sqlite.prepare(sql).run(...args).changes}}),_run:()=>({success:true,meta:{changes:sqlite.prepare(sql).run(...args).changes}})});
  // D1 semantics: batch = one transaction returning per-statement results (meta.changes)
  const db={prepare:s=>stmt(s),batch:async l=>{sqlite.exec("BEGIN");try{const out=l.map(s=>s._run());sqlite.exec("COMMIT");return out}catch(e){sqlite.exec("ROLLBACK");throw e}}};
  // SYNTHETIC demo: public catalog (490/590), a round open around "now", fake bank, a few fake orders.
  sqlite.exec(`INSERT INTO products(id,slug,name,short_name,fit,fit_name,status,sort) VALUES (2,'drop03','HOME TERRAIN EDITION','DROP 03','boxy','ทรง Boxy','active',1),(3,'drop02','WOVEN STRIDE EDITION','DROP 02','regular','ทรงปกติ','active',2);
    INSERT INTO product_variants(product_id,sleeve,price_baht) VALUES (2,'short',490),(2,'long',590),(3,'short',490),(3,'long',590);
    INSERT INTO product_sizes(product_id,size,sort) VALUES (2,'M',1),(2,'L',2),(3,'M',1),(3,'L',2);`);
  const t=ms=>new Date(ms).toISOString(),n0=Date.now();
  sqlite.exec(`UPDATE rounds SET code='ROUND-000',status='closed' WHERE id=1`);
  sqlite.prepare("INSERT INTO rounds(code,name,opens_at,closes_at,payment_due_at,shipping_baht,supplier_shipping_baht,deliveries,status) VALUES ('ROUND-001','รอบทดสอบ 1',?,?,?,50,80,'[\"city\",\"event\",\"ship\"]','open')").run(t(n0-864e5),t(n0+5*864e5),t(n0+6*864e5));
  sqlite.prepare("INSERT INTO settings(key,value) VALUES ('storefront',?)").run(JSON.stringify({bank:{name:"TEST BANK",account:"000-0-00000-0",holder:"TEST HOLDER"},chatUrl:"https://example.test/c",pageUrl:"https://example.test/p",eventName:"TEST",liveEnabled:true,rolling:false,notifyTo:""}));
  const devEnv={ENVIRONMENT:"staging",ORDERS_DB_LABEL:"staging",ORDERS_DB:db};
  for(const [name,d,items,total] of [["สมชาย ทดสอบ","city",[{product:"drop03",fit:"boxy",sleeve:"short",size:"M",qty:2}],980],["สมหญิง ทดสอบ","ship",[{product:"drop02",fit:"regular",sleeve:"long",size:"L",qty:1}],640],["TEST Event","event",[{product:"drop03",fit:"boxy",sleeve:"long",size:"L",qty:1}],590]])
    await svc.submitOrder(devEnv,{requestId:"dev-"+name.length+"-abcdefghijklmnop"+d,roundId:"ROUND-001",name,phone:"0800000000",delivery:d,address:d==="ship"?"99/9 ถนนทดสอบ ตำบลสมมติ จังหวัดสมมติ 50000":"",items,preorder:true,sizing:true,privacy:true,expectedTotal:total});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode("owner@example.test"))),b=>b.toString(16).padStart(2,"0")).join("");
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const origin="http://127.0.0.1:"+server.address().port;
    const env={ENVIRONMENT:"staging",ORDERS_DB_LABEL:"staging",ORDERS_ALLOWED_ORIGIN:origin,ORDERS_DB:db,MEDIA_ADMIN_ENABLED:"1",MEDIA_ACCESS_AUD:"dev",MEDIA_ADMIN_EMAIL_HASH:hash};
    const ctx={access:{aud:"dev",getIdentity:async()=>({email:"owner@example.test"})}};
    const r=await worker.fetch(new Request(origin+req.url,{method:req.method,headers:req.headers,body:["GET","HEAD"].includes(req.method)?undefined:Buffer.concat(chunks)}),env,ctx);
    res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(r=>server.listen(port,"127.0.0.1",r));
  return {server,sqlite,url:"http://127.0.0.1:"+server.address().port};
}
if(process.argv[1]===new URL(import.meta.url).pathname){const {url}=await start(+process.env.PORT||8788);console.log("Synthetic dev admin:",url+"/admin/settings/  |  "+url+"/admin/shipping/");}
