const origin = "https://norxcraftingmovement.com";
const demoOrigin = "https://feature-media-manager-norx-crafting-movement.norx-craftingmovement.workers.dev";
const admin = "/admin/media/";
const upload = admin + "poster";
const poster = "/media/events/move-kids-2026/poster";
const key = "events/move-kids-2026/poster";
const maxBytes = 4 * 1024 * 1024;
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
const noStore = {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const json = (body,status=200) => Response.json(body,{status,headers:noStore});
const base = s => {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw Error("invalid");
  return Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(s.length/4)*4,"=")),c=>c.charCodeAt(0));
};
const parse = s => JSON.parse(new TextDecoder().decode(base(s)));
let jwksCache;
// Validate the signed Access token; static-asset routing does not propagate ctx.access.
export async function authorized(request,env,fetchKeys=fetch) {
  try {
    const issuer = env.MEDIA_ACCESS_ISSUER;
    if (env.MEDIA_ADMIN_ENABLED !== "1" || !env.MEDIA_ACCESS_AUD || !/^([a-f0-9]{64})$/.test(env.MEDIA_ADMIN_EMAIL_HASH??"") ||
        !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer??"")) return false;
    const token = request.headers.get("CF-Access-Jwt-Assertion");
    if (!token || token.length>8192) return false;
    const parts=token.split("."); if(parts.length!==3)return false;
    const [h,p,s]=parts, header=parse(h), claims=parse(p), now=Math.floor(Date.now()/1000);
    if(header.alg!=="RS256" || typeof header.kid!=="string" || claims.iss!==issuer ||
       !(Array.isArray(claims.aud)?claims.aud:[claims.aud]).includes(env.MEDIA_ACCESS_AUD) ||
       !Number.isFinite(claims.exp) || claims.exp<=now ||
       (claims.nbf!==undefined && (!Number.isFinite(claims.nbf)||claims.nbf>now)) ||
       typeof claims.email!=="string") return false;
    const emailDigest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(claims.email.toLowerCase()));
    const emailHash=Array.from(new Uint8Array(emailDigest),b=>b.toString(16).padStart(2,"0")).join("");
    if(emailHash!==env.MEDIA_ADMIN_EMAIL_HASH)return false;
    if(!jwksCache || jwksCache.issuer!==issuer || jwksCache.until<Date.now() || !jwksCache.keys.some(k=>k.kid===header.kid)){
      const response=await fetchKeys(issuer+"/cdn-cgi/access/certs",{redirect:"error"});
      if(!response.ok)return false;
      const data=await response.json(); if(!Array.isArray(data.keys))return false;
      jwksCache={issuer,keys:data.keys,until:Date.now()+300000};
    }
    const jwk=jwksCache.keys.find(k=>k.kid===header.kid&&k.kty==="RSA");
    if(!jwk)return false;
    const publicKey=await crypto.subtle.importKey("jwk",jwk,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5",publicKey,base(s),new TextEncoder().encode(h+"."+p));
  }catch{return false;}
}
function signature(bytes,type) {
  const a=bytes;
  if(type==="image/jpeg") return a.length>4&&a[0]===255&&a[1]===216&&a[2]===255&&a.at(-2)===255&&a.at(-1)===217;
  if(type==="image/png") return a.length>24&&[137,80,78,71,13,10,26,10].every((v,i)=>a[i]===v);
  if(type==="image/webp") return a.length>12&&String.fromCharCode(...a.slice(0,4))==="RIFF"&&String.fromCharCode(...a.slice(8,12))==="WEBP";
  return false;
}
async function readImage(request) {
  const type=(request.headers.get("Content-Type")??"").split(";")[0].toLowerCase();
  if(!allowed.has(type)||!request.body)return {error:"FORMAT",status:415};
  const declared=Number(request.headers.get("Content-Length"));
  if(declared>maxBytes)return {error:"SIZE",status:413};
  const reader=request.body.getReader(),chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>maxBytes){await reader.cancel();return {error:"SIZE",status:413};}chunks.push(value);
  }
  const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.byteLength;}
  if(!signature(bytes,type))return {error:"FORMAT",status:415};
  return {type,bytes};
}
function page(demo) {
  const nonce=crypto.randomUUID().replace(/-/g,"");
  return new Response(`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>NORX | Media Manager</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f2f0e9;color:#171815;font:16px/1.6 system-ui,sans-serif}header{background:#171815;color:#fff;padding:20px 5vw;font-weight:800;letter-spacing:.08em}main{max-width:900px;margin:auto;padding:32px 20px 64px}h1{font-size:clamp(32px,7vw,56px);line-height:1;margin:16px 0 10px}small,.muted{color:#555950}section{border:1px solid #c7c7bd;background:#fff;padding:24px;margin-top:24px;border-radius:3px}label{display:block;font-weight:bold;margin-bottom:8px}input{display:block;width:100%;border:1px solid #c7c7bd;padding:16px}img{max-width:100%;max-height:520px;object-fit:contain;display:block;margin:20px auto;background:#f2f0e9}img[hidden]{display:none}button{padding:14px 20px;min-height:48px;border:0;background:#171815;color:#fff;font-weight:700;cursor:pointer}button:disabled{background:#aaa;color:#222;cursor:not-allowed}a{color:inherit}p{overflow-wrap:anywhere}.notice{border-left:4px solid #9d4b2d;padding:12px;background:#f8e9dd}.row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center}</style>
<header>NORX / ADMIN</header><main><small>EVENTS / MEDIA MANAGER</small><h1>POSTER.</h1><p>MOVE KIDS — 14K · 13 ธันวาคม 2569</p>
${demo?'<p class="notice">โหมดตัวอย่าง — เลือกไฟล์และดูภาพได้ แต่ไม่อัปโหลดหรือเผยแพร่จริง</p>':''}
<section><div class="row"><strong>โปสเตอร์ปัจจุบัน</strong><a href="/events/move-kids-2026/">ดูหน้ากิจกรรม ↗</a></div><p id="currentMessage" class="muted">ยังไม่มีโปสเตอร์</p><img id="current" hidden alt="โปสเตอร์ปัจจุบัน"></section>
<section><label for="file">เลือกโปสเตอร์ใหม่</label><input id="file" type="file" accept="image/jpeg,image/png,image/webp"><p class="muted">JPG, PNG หรือ WebP · ไม่เกิน 4 MB · แสดงเต็มภาพโดยไม่ตัดขอบ</p><img id="next" hidden alt="ตัวอย่างโปสเตอร์ใหม่"><p id="details"></p><button type="button" id="publish" disabled>${demo?'ทดลองเผยแพร่ (ไม่บันทึกจริง)':'เผยแพร่โปสเตอร์'}</button><p id="status" role="status" aria-live="polite"></p></section></main>
<script nonce="${nonce}">const demo=${demo},f=document.querySelector('#file'),p=document.querySelector('#publish'),n=document.querySelector('#next'),c=document.querySelector('#current'),s=document.querySelector('#status'),d=document.querySelector('#details'),m=document.querySelector('#currentMessage');let selected,url;
function refresh(){c.onload=()=>{c.hidden=false;m.hidden=true};c.onerror=()=>{c.hidden=true;m.hidden=false};c.src='${poster}?v='+Date.now()}
refresh();f.onchange=()=>{p.disabled=true;n.hidden=true;d.textContent='';s.textContent='';selected=null;if(url)URL.revokeObjectURL(url);const file=f.files[0];if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>4194304){s.textContent='กรุณาเลือกไฟล์รูปภาพไม่เกิน 4 MB';return}url=URL.createObjectURL(file);n.onload=()=>{selected=file;n.hidden=false;d.textContent=file.name+' · '+n.naturalWidth+' × '+n.naturalHeight+' px';p.disabled=false};n.onerror=()=>{s.textContent='ไม่สามารถเปิดไฟล์รูปนี้ได้';p.disabled=true};n.src=url};
p.onclick=async()=>{if(!selected)return;p.disabled=true;f.disabled=true;try{if(demo){s.textContent='ตัวอย่างพร้อมเผยแพร่ — ไม่มีการบันทึกจริง';return}if(!confirm('เผยแพร่โปสเตอร์นี้และแทนที่รูปเดิมหรือไม่?'))return;s.textContent='กำลังอัปโหลด…';const res=await fetch('${upload}',{method:'PUT',headers:{'Content-Type':selected.type},body:selected});if(!res.ok)throw Error();s.textContent='เผยแพร่สำเร็จ';refresh()}catch{s.textContent='อัปโหลดไม่สำเร็จ กรุณาลองอีกครั้ง'}finally{p.disabled=false;f.disabled=false}};</script></html>`,
  {headers:{...noStore,"Content-Type":"text/html; charset=utf-8","X-Robots-Tag":"noindex, nofollow","Content-Security-Policy":`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`}});
}
export async function mediaFetch(request,env,verify=authorized) {
  const u=new URL(request.url);
  if(u.pathname!==poster && u.pathname!==admin && u.pathname!==admin.slice(0,-1) && u.pathname!==upload)return null;
  if(u.pathname===poster){
    if(!["GET","HEAD"].includes(request.method))return json({error:"METHOD"},405);
    if(!env.MEDIA_BUCKET)return json({error:"NOT_FOUND"},404);
    try{
      const object=await env.MEDIA_BUCKET.get(key);
      if(!object || !allowed.has(object.httpMetadata?.contentType))return json({error:"NOT_FOUND"},404);
      return new Response(request.method==="HEAD"?null:object.body,{headers:{...noStore,"Content-Type":object.httpMetadata.contentType,"Content-Length":String(object.size)}});
    }catch{return json({error:"UNAVAILABLE"},503);}
  }
  const demo=u.origin===demoOrigin&&env.MEDIA_DEMO==="1";
  if(demo){if(u.pathname===admin&&request.method==="GET")return page(true);return json({error:"NOT_FOUND"},404);}
  if(u.origin!==origin || !(await verify(request,env)))return json({error:"ACCESS_REQUIRED"},403);
  if(u.pathname===admin.slice(0,-1)&&request.method==="GET")return Response.redirect(origin+admin,302);
  if(u.pathname===admin&&request.method==="GET")return page(false);
  if(u.pathname!==upload||request.method!=="PUT")return json({error:"METHOD"},405);
  if(request.headers.get("Origin")!==u.origin)return json({error:"ORIGIN"},403);
  if(!env.MEDIA_BUCKET)return json({error:"UNAVAILABLE"},503);
  try{
    const file=await readImage(request);if(file.error)return json({error:file.error},file.status);
    await env.MEDIA_BUCKET.put(key,file.bytes,{httpMetadata:{contentType:file.type}});
    return json({ok:true});
  }catch{return json({error:"UNAVAILABLE"},503);}
}
