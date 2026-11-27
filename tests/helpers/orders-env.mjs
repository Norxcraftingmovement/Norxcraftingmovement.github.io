import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../../"+p,import.meta.url),"utf8");
export const origin="https://orders.test";
// Minimal D1 emulation (prepare/bind/first/all/run/batch) over node:sqlite.
export function d1(sqlite){
  const stmt=(sql,args=[])=>({
    bind:(...a)=>stmt(sql,a),
    first:async()=>sqlite.prepare(sql).get(...args)??null,
    all:async()=>({results:sqlite.prepare(sql).all(...args)}),
    run:async()=>{sqlite.prepare(sql).run(...args);return {success:true}},
    _run:()=>sqlite.prepare(sql).run(...args)});
  return {prepare:sql=>stmt(sql),batch:async list=>{sqlite.exec("BEGIN");try{for(const s of list)s._run();sqlite.exec("COMMIT")}catch(e){sqlite.exec("ROLLBACK");throw e}return list.map(()=>({success:true}))}};
}
export async function setup({seed=true}={}){
  const sqlite=new DatabaseSync(":memory:");sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(read("migrations/orders/0001_core.sql"));
  if(seed)sqlite.exec(read("seeds/orders-staging-synthetic.sql"));
  const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("owner@example.test"));
  const env={ENVIRONMENT:"staging",ORDERS_DB_LABEL:"staging",ORDERS_ALLOWED_ORIGIN:origin,ORDERS_DB:d1(sqlite),MEDIA_ADMIN_ENABLED:"1",MEDIA_ACCESS_AUD:"aud",
    MEDIA_ADMIN_EMAIL_HASH:Array.from(new Uint8Array(h),b=>b.toString(16).padStart(2,"0")).join("")};
  const ctx={access:{aud:"aud",getIdentity:async()=>({email:"owner@example.test"})}};
  return {sqlite,env,ctx};
}
export const call=(worker,env,ctx,path,{method="GET",body,headers={}}={})=>worker.fetch(new Request(origin+path,{method,headers:{...(body?{"Content-Type":"application/json",Origin:origin}:{}),...headers},body:body?JSON.stringify(body):undefined}),env,ctx);
