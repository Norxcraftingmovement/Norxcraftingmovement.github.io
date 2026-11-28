// Presentation snapshots only. Commercial data is always read from the current catalog.
import { UserError } from './orders-core.mjs';
import { getProductContent } from './product-content.mjs';
import { productSource } from './generated/product-publication-assets.mjs';
import { productTemplate } from '../admin-ui/product-template.mjs';
const bad=m=>{throw new UserError(m);};
const get=async(env,key)=>{const row=await env.ORDERS_DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();return row?JSON.parse(row.value):null;};
const head=id=>'product-published:'+id, snapshots=id=>'product-snapshot:'+id+':';
const enabled=env=>env.ENVIRONMENT==='staging'&&env.WEBSITE_MANAGEMENT_ENABLED==='1';
const version=content=>productSource.themes[content.themeId]?.version;
const eligible=state=>state.product.status==='active'&&!!productSource.fixtures[state.product.slug];
const only=(raw,keys)=>{if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!keys.includes(k)))bad('รูปแบบข้อมูลไม่ถูกต้อง');};
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const observed=(content,state)=>({content,product:state.product});
export async function productPublicationState(env,id,state=null){
  state ||= await getProductContent(env,id);
  const published=await get(env,head(id)),rows=(await env.ORDERS_DB.prepare('SELECT value FROM settings WHERE key LIKE ? ORDER BY rowid DESC LIMIT 20').bind(snapshots(id)+'%').all()).results;
  return {...state,publishEnabled:enabled(env)&&eligible(state),published:published?{id:published.id,at:published.at}:null,history:rows.map(r=>{const s=JSON.parse(r.value);return {id:s.id,at:s.at,title:s.content.heading,action:s.action};})};
}
export function renderProduct(content,state,{preview=true}={}){
  const fixture=productSource.fixtures[state.product.slug];
  return productTemplate({...state.product,description:content.description,themeId:content.themeId},content.hero.src,{...fixture,...content,slug:state.product.slug,isContentDraft:preview,isPublished:!preview},{published:!preview});
}
export async function reviewProduct(env,actor,id,raw,now=Date.now()){
  only(raw,['expectedRevision','expectedPublishedId','targetId']);const state=await productPublicationState(env,id);
  if(!state.publishEnabled)bad('เผยแพร่ได้เฉพาะสินค้าที่เปิดใช้และมีหน้าเดิม ในระบบทดสอบที่เปิดสิทธิ์แล้ว');
  if(raw.expectedRevision!==state.revision||(raw.expectedPublishedId||'')!==(state.published?.id||''))bad('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดฉบับล่าสุด');
  let content=state.content;
  if(raw.targetId){if(!uuid(raw.targetId))bad('ไม่พบฉบับสำหรับย้อนคืน');const old=await get(env,snapshots(id)+raw.targetId);if(!old||old.version!==1||old.productId!==id||old.rendererVersion!==version(old.content))bad('ฉบับเดิมไม่ตรงกับแม่แบบปัจจุบัน ต้องตรวจความเข้ากันได้ก่อน');content=old.content;}
  else if(!state.hasDraft)bad('บันทึกร่างก่อนดูฉบับที่จะเผยแพร่');
  const proof=crypto.randomUUID(),ticket={actor,productId:id,revision:state.revision,head:state.published?.id||'',target:raw.targetId||'',renderer:version(content),digest:await digest(observed(content,state)),expires:now+600000};
  await env.ORDERS_DB.prepare("DELETE FROM settings WHERE key LIKE 'product-review:%' AND json_extract(value,'$.expires')<=?").bind(now).run();
  await env.ORDERS_DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)').bind('product-review:'+proof,JSON.stringify(ticket)).run();
  return {proof,html:renderProduct(content,state),expires:ticket.expires,targetId:ticket.target};
}
export async function publishProduct(env,actor,id,raw,now=Date.now()){
  only(raw,['proof']);if(!uuid(raw.proof))bad('ดูพรีวิวฉบับล่าสุดก่อนยืนยัน');
  const state=await productPublicationState(env,id),ticket=await get(env,'product-review:'+raw.proof);
  if(!state.publishEnabled)bad('ระบบนี้ยังเผยแพร่สินค้านี้ไม่ได้');
  if(!ticket||ticket.actor!==actor||ticket.productId!==id||ticket.expires<=now||ticket.revision!==state.revision||ticket.head!==(state.published?.id||''))bad('พรีวิวหมดอายุหรือข้อมูลเปลี่ยนแล้ว กรุณาดูใหม่');
  const old=ticket.target?await get(env,snapshots(id)+ticket.target):null,content=ticket.target?old?.content:state.content;
  if(!content||version(content)!==ticket.renderer||ticket.digest!==await digest(observed(content,state)))bad('เนื้อหาหรือข้อมูลสินค้าเปลี่ยนแล้ว กรุณาดูพรีวิวใหม่');
  const snapshot={version:1,productId:id,rendererVersion:ticket.renderer,id:crypto.randomUUID(),at:new Date(now).toISOString(),action:ticket.target?'rollback':'publish',sourceSnapshotId:ticket.target||null,sourceRevision:state.revision,content},token=crypto.randomUUID(),db=env.ORDERS_DB;
  // Compare the entire observed catalog inside the same transaction as the head update.
  // A concurrent archive, price/size edit or other catalog write invalidates the preview.
  const catalog=JSON.stringify(state.product);
  const commercialSql=parameter=>`SELECT json_object(
    'product',json_array(id,slug,name,short_name,fit,fit_name,status,sort,description,image_key,collection_id),
    'theme',(SELECT value FROM settings WHERE key='product-theme:'||products.slug),
    'collection',(SELECT name FROM collections WHERE id=products.collection_id),
    'revision',(SELECT COALESCE(MAX(id),0) FROM audit_log WHERE entity='products' AND entity_id=products.slug),
    'variants',(SELECT json_group_array(json_array(sleeve,price_baht)) FROM (SELECT sleeve,price_baht FROM product_variants WHERE product_id=${parameter} ORDER BY sleeve)),
    'sizes',(SELECT json_group_array(json_array(size,sort)) FROM (SELECT size,sort FROM product_sizes WHERE product_id=${parameter} ORDER BY sort,size))) value
    FROM products WHERE id=${parameter} AND status='active'`;
  const commercial=await db.prepare(commercialSql('?1')).bind(id).first();
  // Recheck after collecting the SQL guard so a change between those reads cannot be accepted.
  if(catalog!==JSON.stringify((await getProductContent(env,id)).product))bad('ข้อมูลสินค้าเปลี่ยนแล้ว กรุณาดูพรีวิวใหม่');
  const statements=[db.prepare("INSERT INTO audit_log(actor_hash,action,entity,entity_id,before,after) SELECT ?1,?2,'product-publication',?9,?3,?4 WHERE COALESCE((SELECT MAX(id) FROM audit_log WHERE entity='product-content' AND entity_id=?9),0)=?5 AND COALESCE((SELECT json_extract(value,'$.id') FROM settings WHERE key=?10),'')=?6 AND EXISTS(SELECT 1 FROM settings WHERE key=?7 AND json_extract(value,'$.expires')>?8 AND json_extract(value,'$.actor')=?1) AND ("+commercialSql('?9')+")=?11").bind(actor,'product.content.'+snapshot.action,JSON.stringify(state.published),JSON.stringify({snapshotId:snapshot.id,operationToken:token}),ticket.revision,ticket.head,'product-review:'+raw.proof,now,String(id),head(id),commercial?.value||'')];
  const guard="EXISTS(SELECT 1 FROM audit_log WHERE entity='product-publication' AND entity_id=?4 AND json_extract(after,'$.operationToken')=?3)";
  if(!state.published){const baseline={...snapshot,rendererVersion:version(state.defaults),id:crypto.randomUUID(),at:new Date(now-1).toISOString(),action:'baseline',sourceSnapshotId:null,sourceRevision:0,content:state.defaults};statements.push(db.prepare('INSERT INTO settings(key,value) SELECT ?1,?2 WHERE '+guard).bind(snapshots(id)+baseline.id,JSON.stringify(baseline),token,String(id)));}
  for(const key of [snapshots(id)+snapshot.id,head(id)])statements.push(db.prepare('INSERT INTO settings(key,value) SELECT ?1,?2 WHERE '+guard+' ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(snapshot),token,String(id)));
  statements.push(db.prepare('DELETE FROM settings WHERE key=?1 AND '+guard.replaceAll('?4','?3').replace("operationToken')=?3","operationToken')=?2")).bind('product-review:'+raw.proof,token,String(id)));
  const result=await db.batch(statements);if(result[0].meta.changes!==1)bad('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดแล้วดูพรีวิวใหม่');return productPublicationState(env,id);
}
export async function publishedProduct(env,slug){
  if(!productSource.fixtures[slug])return null;
  const row=await env.ORDERS_DB.prepare("SELECT id FROM products WHERE slug=? AND status='active'").bind(slug).first();if(!row)return null;
  const snapshot=await get(env,head(row.id));if(!snapshot)return null;
  if(snapshot.version!==1||snapshot.productId!==row.id||snapshot.rendererVersion!==version(snapshot.content))throw Error('Unsupported product publication');
  return {snapshot,state:await getProductContent(env,row.id)};
}
