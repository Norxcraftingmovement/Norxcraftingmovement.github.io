// Homepage authoring and publication rehearsal. All publication routes fail closed outside enabled staging.
import { listProducts } from "./product-drafts.mjs";
import { UserError } from "./orders-core.mjs";
import { websiteSource } from "./generated/website-home-assets.mjs";
import { renderHome } from "./website-home-template.mjs";
const bad=m=>{throw new UserError(m);}, key='website-home:draft',headKey='website-published:home';
export const homepageEnabled=env=>env.ENVIRONMENT==='staging'&&env.WEBSITE_MANAGEMENT_ENABLED==='1';
const get=async(env,k)=>{const r=await env.ORDERS_DB.prepare('SELECT value FROM settings WHERE key=?').bind(k).first();return r?JSON.parse(r.value):null;};
const only=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))bad('รูปแบบข้อมูลหน้าแรกไม่ถูกต้อง');};
const text=(v,max,required=true)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))bad('ตรวจข้อความและความยาวให้ถูกต้อง');const t=v.trim();if(required&&!t)bad('กรอกข้อมูลหน้าแรกให้ครบ');return t;};
export async function homePriceLabels(env){const {products}=await listProducts(env);return Object.fromEntries(products.filter(p=>["drop03","drop02"].includes(p.slug)).map(p=>[p.slug,["short","long"].filter(s=>p.prices[s]).map(s=>(s==="short"?"แขนสั้น":"แขนยาว")+" "+Number(p.prices[s]).toLocaleString("th-TH")+" บาท").join(" · ")]));}
export async function getHome(env){
  const defaults=websiteSource.defaults,stored=await get(env,key),published=await get(env,headKey);
  if(stored&&stored.version!==1)throw Error('Unsupported homepage version');
  const revision=(await env.ORDERS_DB.prepare("SELECT COALESCE(MAX(id),0) revision FROM audit_log WHERE entity='website-home' AND entity_id='home'").first()).revision;
  const rows=(await env.ORDERS_DB.prepare("SELECT value FROM settings WHERE key LIKE 'website-snapshot:%' ORDER BY rowid DESC LIMIT 20").all()).results;
  return {content:stored?.content||defaults,defaults,priceLabels:await homePriceLabels(env),revision,hasDraft:!!stored,mediaReady:!!env.PRODUCT_MEDIA,publishEnabled:homepageEnabled(env),published:published?{id:published.id,at:published.at}:null,history:rows.map(r=>{const s=JSON.parse(r.value);return {id:s.id,at:s.at,title:s.content.pageTitle,action:s.action};})};
}
export function normalizeHome(raw,allowed){
  only(raw,['hero','eyebrow','heading','brandLine','lead','heroMeta','primaryLabel','secondaryLabel','collectionHeading','collectionIntro','pageTitle','pageDescription','cards']);only(raw.hero,['src','alt','position']);
  const src=text(raw.hero.src,180);if(!allowed.has(src))bad('รูปนี้ไม่ได้อยู่ในหน้าแรก กรุณาเลือกรูปใหม่');if(!['original','center','top','bottom'].includes(raw.hero.position))bad('เลือกตำแหน่งภาพที่รองรับ');
  const out={hero:{src,alt:text(raw.hero.alt,300),position:raw.hero.position}};
  for(const [k,max,required]of [['eyebrow',100,false],['heading',60,true],['brandLine',100,true],['lead',500,false],['heroMeta',100,false],['primaryLabel',60,true],['secondaryLabel',60,true],['collectionHeading',120,true],['collectionIntro',1000,false],['pageTitle',160,true],['pageDescription',300,true]])out[k]=text(raw[k],max,required);
  if(!Array.isArray(raw.cards)||raw.cards.length!==2||new Set(raw.cards.map(c=>c?.slug)).size!==2)bad('เก็บการ์ดสินค้าสองรุ่นเดิมไว้และจัดลำดับได้');
  out.cards=raw.cards.map(c=>{only(c,['slug','title','subtitle','visible']);if(!['drop03','drop02'].includes(c.slug)||typeof c.visible!=='boolean')bad('เลือกสินค้าที่รองรับ');return {slug:c.slug,title:text(c.title,140),subtitle:text(c.subtitle,300,false),visible:c.visible};});return out;
}
export async function saveHome(env,actor,raw,uploadSrc=null){
  only(raw,['expectedRevision','content']);if(!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0)bad('โหลดข้อมูลล่าสุดก่อนบันทึก');const state=await getHome(env);if(state.revision!==raw.expectedRevision)bad('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดฉบับล่าสุด');
  const content=normalizeHome(raw.content,new Set([state.defaults.hero.src,state.content.hero.src,...(uploadSrc?[uploadSrc]:[])])),token=crypto.randomUUID(),next=JSON.stringify({content,operationToken:token});
  const r=await env.ORDERS_DB.batch([
    env.ORDERS_DB.prepare("INSERT INTO audit_log(actor_hash,action,entity,entity_id,before,after) SELECT ?1,'website.home.draft','website-home','home',?2,?3 WHERE COALESCE((SELECT MAX(id) FROM audit_log WHERE entity='website-home' AND entity_id='home'),0)=?4").bind(actor,JSON.stringify(state.content),next,raw.expectedRevision),
    env.ORDERS_DB.prepare("INSERT INTO settings(key,value) SELECT ?1,?2 WHERE EXISTS(SELECT 1 FROM audit_log WHERE entity='website-home' AND entity_id='home' AND json_extract(after,'$.operationToken')=?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,JSON.stringify({version:1,content}),token),
  ]);if(r[0].meta.changes!==1)bad('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดฉบับล่าสุด');return getHome(env);
}
const digest=async content=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(content)))),b=>b.toString(16).padStart(2,'0')).join('');
export async function reviewHome(env,actor,raw,now=Date.now()){
  if(!homepageEnabled(env))bad('การเผยแพร่ยังไม่เปิดใช้งานในระบบนี้');only(raw,['expectedRevision','expectedPublishedId','targetId']);const state=await getHome(env);if(raw.expectedRevision!==state.revision||(raw.expectedPublishedId||'')!==(state.published?.id||''))bad('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดฉบับล่าสุด');
  let content=state.content;if(raw.targetId){const snapshot=await get(env,'website-snapshot:'+text(raw.targetId,36));if(!snapshot||snapshot.version!==1)bad('ไม่พบฉบับสำหรับย้อนคืน');if(snapshot.rendererVersion!==websiteSource.version)bad('ฉบับนี้ใช้แม่แบบคนละรุ่น ต้องตรวจความเข้ากันได้ก่อนย้อนคืน');content=snapshot.content;}else if(!state.hasDraft)bad('บันทึกร่างก่อนดูฉบับที่จะเผยแพร่');
  const proof=crypto.randomUUID(),ticket={actor,renderer:websiteSource.version,revision:state.revision,head:state.published?.id||'',target:raw.targetId||'',digest:await digest({content,prices:state.priceLabels}),expires:now+600000};
  await env.ORDERS_DB.prepare("DELETE FROM settings WHERE key LIKE 'website-review:%' AND json_extract(value,'$.expires')<=?").bind(now).run();
  await env.ORDERS_DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)').bind('website-review:'+proof,JSON.stringify(ticket)).run();
  return {proof,html:renderHome(content,{preview:true,prices:state.priceLabels}),expires:ticket.expires,targetId:ticket.target};
}
export async function publishHome(env,actor,raw,now=Date.now()){
  if(!homepageEnabled(env))bad('การเผยแพร่ยังไม่เปิดใช้งานในระบบนี้');only(raw,['proof']);if(typeof raw.proof!=='string'||!/^[0-9a-f-]{36}$/.test(raw.proof))bad('ดูพรีวิวฉบับล่าสุดก่อนยืนยัน');
  const ticket=await get(env,'website-review:'+raw.proof),state=await getHome(env);if(!ticket||ticket.renderer!==websiteSource.version||ticket.actor!==actor||ticket.expires<=now||ticket.revision!==state.revision||ticket.head!==(state.published?.id||''))bad('พรีวิวหมดอายุหรือข้อมูลเปลี่ยนแล้ว กรุณาดูใหม่');
  const old=ticket.target?await get(env,'website-snapshot:'+ticket.target):null,content=ticket.target?old?.content:state.content;if(old&&old.rendererVersion!==ticket.renderer)bad('ฉบับนี้ใช้แม่แบบคนละรุ่น ต้องตรวจความเข้ากันได้ก่อนย้อนคืน');if(!content||ticket.digest!==await digest({content,prices:state.priceLabels}))bad('เนื้อหาเปลี่ยนแล้ว กรุณาดูพรีวิวใหม่');
  const snapshot={version:1,rendererVersion:ticket.renderer,id:crypto.randomUUID(),at:new Date(now).toISOString(),action:ticket.target?'rollback':'publish',sourceSnapshotId:ticket.target||null,sourceRevision:state.revision,content},token=crypto.randomUUID(),db=env.ORDERS_DB,statements=[];
  statements.push(db.prepare("INSERT INTO audit_log(actor_hash,action,entity,entity_id,before,after) SELECT ?1,?2,'website-publication','home',?3,?4 WHERE COALESCE((SELECT MAX(id) FROM audit_log WHERE entity='website-home' AND entity_id='home'),0)=?5 AND COALESCE((SELECT json_extract(value,'$.id') FROM settings WHERE key='website-published:home'),'')=?6 AND EXISTS(SELECT 1 FROM settings WHERE key=?7 AND json_extract(value,'$.expires')>?8 AND json_extract(value,'$.actor')=?1)").bind(actor,'website.home.'+snapshot.action,JSON.stringify(state.published),JSON.stringify({snapshotId:snapshot.id,operationToken:token}),ticket.revision,ticket.head,'website-review:'+raw.proof,now));
  const guard="EXISTS(SELECT 1 FROM audit_log WHERE entity='website-publication' AND entity_id='home' AND json_extract(after,'$.operationToken')=?3)";
  if(!state.published){const baseline={version:1,rendererVersion:ticket.renderer,id:crypto.randomUUID(),at:new Date(now-1).toISOString(),action:'baseline',sourceRevision:0,content:state.defaults};statements.push(db.prepare('INSERT INTO settings(key,value) SELECT ?1,?2 WHERE '+guard).bind('website-snapshot:'+baseline.id,JSON.stringify(baseline),token));}
  for(const name of ['website-snapshot:'+snapshot.id,headKey])statements.push(db.prepare('INSERT INTO settings(key,value) SELECT ?1,?2 WHERE '+guard+' ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(name,JSON.stringify(snapshot),token));
  statements.push(db.prepare('DELETE FROM settings WHERE key=?1 AND '+guard.replaceAll('?3','?2')).bind('website-review:'+raw.proof,token));
  const result=await db.batch(statements);if(result[0].meta.changes!==1)bad('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดแล้วดูพรีวิวใหม่');return getHome(env);
}
export async function publishedHome(env){return get(env,headKey);}
