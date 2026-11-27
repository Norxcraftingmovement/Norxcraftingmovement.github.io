// LOCAL DEV ONLY: runs the orders admin Worker on 127.0.0.1 over an in-memory SQLite DB with SYNTHETIC data.
// The "owner" is faked locally; this never touches Cloudflare, production data or any real credentials.
import http from "node:http";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import worker from "../src/orders-admin-worker.mjs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
export async function start(port=0){
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(read("migrations/orders/0001_core.sql"));sqlite.exec(read("seeds/orders-staging-synthetic.sql"));
  const stmt=(sql,args=[])=>({bind:(...a)=>stmt(sql,a),first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>{sqlite.prepare(sql).run(...args);return{}},_run:()=>sqlite.prepare(sql).run(...args)});
  const db={prepare:s=>stmt(s),batch:async l=>{sqlite.exec("BEGIN");try{l.forEach(s=>s._run());sqlite.exec("COMMIT")}catch(e){sqlite.exec("ROLLBACK");throw e}}};
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
