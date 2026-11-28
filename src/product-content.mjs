// Presentation drafts only. Never updates products, variants, sizes, rounds, or orders.
import { UserError } from "./orders-core.mjs";
import { listProducts } from "./product-drafts.mjs";
import { validProductTheme } from "../admin-ui/product-theme-options.mjs";
import { productSource } from "./generated/product-publication-assets.mjs";
const bad = message => { throw new UserError(message); };
const only = (value, keys) => { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k))) bad("ข้อมูลเนื้อหาไม่ถูกต้อง หน้านี้ไม่แก้ราคา ไซส์ขาย หรือสถานะสินค้า"); };
const text = (value, max, required=false) => { if(typeof value!=="string" || value.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))bad("ตรวจข้อความและความยาวให้ถูกต้อง");const out=value.trim();if(required&&!out)bad("กรอกข้อมูลที่จำเป็นให้ครบ");return out; };
const array = (value,max) => { if(!Array.isArray(value)||value.length>max)bad("มีรายการมากเกินกำหนด");return value; };
export const contentImageSources = content => [content?.hero,...(Array.isArray(content?.gallery)?content.gallery.flatMap(g=>Array.isArray(g?.images)?g.images:[]):[]),...(Array.isArray(content?.lookbook)?content.lookbook:[])].map(i=>i?.src).filter(s=>typeof s === "string" && s);
export async function getProductContent(env,id) {
  const product=(await listProducts(env)).products.find(p=>p.id===id);if(!product)bad("ไม่พบสินค้า");
  const db=env.ORDERS_DB, row=await db.prepare("SELECT value FROM settings WHERE key=?").bind("product-content:"+id).first();
  const revision=(await db.prepare("SELECT COALESCE(MAX(id),0) revision FROM audit_log WHERE entity='product-content' AND entity_id=?").bind(String(id)).first()).revision;
  const fixture=productSource.fixtures[product.slug];
  const defaults={themeId:product.themeId,heading:fixture?.heading||product.name,lead:fixture?.lead||product.fitName,description:product.description,highlights:[],hero:fixture?.hero||{src:product.coverUrl,alt:product.name,caption:""},gallery:fixture?.gallery||[],lookbook:fixture?.lookbook||[],sizing:fixture ? {...fixture.sizing,unit:"in"} : {unit:"in",headers:["ไซส์","อก","ยาว"],rows:product.sizes.map(s=>[s,"—","—"]),notes:["ยังไม่ระบุขนาดจริง"]}};
  let content=defaults;if(row){const stored=JSON.parse(row.value);if(stored.version!==1||!stored.content)throw Error("Unsupported content draft");content=stored.content;}
  return {product,content,defaults,revision,hasDraft:!!row,editable:product.status!=="archived",mediaReady:!!env.PRODUCT_MEDIA};
}
export function normalizeContent(raw,allowedSources) {
  only(raw,["themeId","heading","lead","description","highlights","hero","gallery","lookbook","sizing"]);
  if(!validProductTheme(raw.themeId))bad("เลือกธีมจากรายการที่รองรับ");let photoCount=0;
  const photo=(p,empty=false)=>{only(p,["src","alt","caption"]);const src=text(p.src,180);if(src&&!allowedSources.has(src))bad("รูปนี้ไม่ได้อยู่ในเนื้อหาสินค้า กรุณาเลือกรูปใหม่");if(!src&&!empty)bad("เพิ่มรูปให้ครบหรือลบรายการรูปว่าง");if(src&&++photoCount>40)bad("เก็บรูปได้ไม่เกิน 40 รูปต่อสินค้า");return {src,alt:text(p.alt,300,!!src),caption:text(p.caption,300)};};
  const content={themeId:raw.themeId,heading:text(raw.heading,140,true),lead:text(raw.lead,1000),description:text(raw.description,3000),highlights:array(raw.highlights,8).map(h=>{only(h,["title","body"]);return {title:text(h.title,80,true),body:text(h.body,1000)};}),hero:photo(raw.hero,true),gallery:array(raw.gallery,8).map(g=>{only(g,["heading","images"]);return {heading:text(g.heading,80),images:array(g.images,24).map(p=>photo(p))};}),lookbook:array(raw.lookbook,24).map(p=>photo(p))};
  only(raw.sizing,["unit","headers","rows","notes"]);if(!["in","cm"].includes(raw.sizing.unit))bad("เลือกหน่วยตารางไซส์");const headers=array(raw.sizing.headers,6).map(h=>text(h,40,true));
  if(headers.length<2||headers[0]!=="ไซส์"||new Set(headers).size!==headers.length)bad("ตารางต้องเริ่มด้วยไซส์ มี 2–6 คอลัมน์และชื่อไม่ซ้ำ");
  const rows=array(raw.sizing.rows,30).map(row=>{if(!Array.isArray(row)||row.length!==headers.length)bad("จำนวนช่องตารางไซส์ไม่ตรงกับคอลัมน์");return row.map((v,i)=>{const out=text(v,i?20:16,true);if(i?!(out==="—"||(/^\d{1,4}(?:\.\d{1,2})?$/.test(out)&&Number(out)>0)):! /^[A-Z0-9][A-Z0-9 .+-]*$/.test(out))bad("ไซส์ใช้ตัวอักษร/ตัวเลข ขนาดใช้ตัวเลขบวกหรือ — เมื่อยังไม่ทราบ");return out;});});
  if(!rows.length||new Set(rows.map(r=>r[0])).size!==rows.length)bad("ใส่ไซส์อย่างน้อยหนึ่งแถวและไม่ซ้ำกัน");
  content.sizing={unit:raw.sizing.unit,headers,rows,notes:array(raw.sizing.notes,5).map(n=>text(n,1000))};return content;
}
export function contentRequest(raw) { only(raw,["expectedRevision","content"]);if(!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0)bad("โหลดข้อมูลล่าสุดก่อนบันทึก");return raw; }
export async function saveProductContent(env,actor,id,raw,uploads=new Set()) {
  contentRequest(raw);const state=await getProductContent(env,id);if(!state.editable)bad("สินค้าที่เก็บไว้ดูได้อย่างเดียว");if(raw.expectedRevision!==state.revision)bad("ข้อมูลเปลี่ยนแล้ว กรุณาโหลดฉบับร่างล่าสุดก่อนบันทึก");
  const content=normalizeContent(raw.content,new Set([...contentImageSources(state.defaults),...contentImageSources(state.content),...uploads]));
  const db=env.ORDERS_DB, token=crypto.randomUUID(), next=JSON.stringify({version:1,content,operationToken:token});
  const result=await db.batch([
    db.prepare("INSERT INTO audit_log(actor_hash,action,entity,entity_id,before,after) SELECT ?1,'product.content.draft','product-content',?2,?3,?4 WHERE EXISTS(SELECT 1 FROM products WHERE id=?5 AND status IN ('draft','active')) AND COALESCE((SELECT MAX(id) FROM audit_log WHERE entity='product-content' AND entity_id=?2),0)=?6").bind(actor,String(id),JSON.stringify({content:state.content,revision:state.revision}),next,id,raw.expectedRevision),
    db.prepare("INSERT INTO settings(key,value) SELECT ?1,?2 WHERE EXISTS(SELECT 1 FROM audit_log WHERE entity='product-content' AND entity_id=?3 AND json_extract(after,'$.operationToken')=?4) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind("product-content:"+id,JSON.stringify({version:1,content}),String(id),token),
  ]);
  if(result[0].meta.changes!==1)bad("ข้อมูลเปลี่ยนแล้ว กรุณาโหลดฉบับร่างล่าสุดก่อนบันทึก");return getProductContent(env,id);
}
