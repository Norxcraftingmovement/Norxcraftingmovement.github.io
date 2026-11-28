import { UserError } from "./orders-core.mjs";
import { imageType, imageReferenced } from "./product-images.mjs";
import { contentRequest, contentImageSources, getProductContent, normalizeContent, saveProductContent } from "./product-content.mjs";
const LIMIT=12*1024*1024+65536, bad=message=>{throw new UserError(message);};
async function bounded(request,max) {
  if(!request.body||Number(request.headers.get('content-length'))>max)bad("รูปและข้อมูลรวมกันใหญ่เกินกำหนด");const reader=request.body.getReader(),chunks=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();bad("รูปและข้อมูลรวมกันใหญ่เกินกำหนด");}chunks.push(value);}
  const out=new Uint8Array(length);let offset=0;for(const b of chunks){out.set(b,offset);offset+=b.length;}return out;
}
export async function saveContentRequest(request,env,actor,id) {
  const type=(request.headers.get('content-type')||'').toLowerCase();
  if(type.startsWith('application/json')){const bytes=await bounded(request,65536);let data;try{data=JSON.parse(new TextDecoder().decode(bytes));}catch{bad("รูปแบบข้อมูลไม่ถูกต้อง");}return saveProductContent(env,actor,id,data);}
  if(!type.startsWith('multipart/form-data;'))bad("รูปแบบข้อมูลไม่ถูกต้อง");if(!env.PRODUCT_MEDIA)bad("ยังไม่ได้เชื่อมพื้นที่เก็บรูปสินค้า บันทึกข้อความและรูปเดิมได้");
  const bytes=await bounded(request,LIMIT);let form;try{form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')}}).formData();}catch{bad("อ่านรูปไม่ได้ กรุณาเลือกใหม่");}
  const data=form.get('data');if(typeof data!=='string'||data.length>65536||form.getAll('data').length!==1)bad("ข้อมูลเนื้อหาไม่ถูกต้อง");let raw;try{raw=JSON.parse(data);}catch{bad("ข้อมูลเนื้อหาไม่ถูกต้อง");}contentRequest(raw);
  const state=await getProductContent(env,id);if(!state.editable||state.revision!==raw.expectedRevision)bad("ข้อมูลเปลี่ยนแล้วหรือแก้ไขไม่ได้ กรุณาโหลดฉบับร่างล่าสุด");
  const files=[...form.entries()].filter(([key])=>key!=='data');if(!files.length||files.length>8)bad("เพิ่มรูปใหม่ได้ครั้งละ 1–8 รูป รวมไม่เกิน 12 MB");const prepared=[],refs=new Set(contentImageSources(raw.content));
  for(const [key,file]of files){if(!/^file:[0-9a-f-]{36}$/.test(key)||form.getAll(key).length!==1||!refs.has('upload:'+key.slice(5))||!file||typeof file.arrayBuffer!=='function')bad("รายการรูปไม่ถูกต้อง");const content=new Uint8Array(await file.arrayBuffer()),ext=imageType(content,file.type);prepared.push({ref:'upload:'+key.slice(5),content,type:file.type,key:'products/'+crypto.randomUUID()+'.'+ext});}
  normalizeContent(raw.content,new Set([...contentImageSources(state.defaults),...contentImageSources(state.content),...prepared.map(p=>p.ref)]));
  const uploaded=[];
  try{
    for(const p of prepared){await env.PRODUCT_MEDIA.put(p.key,p.content,{httpMetadata:{contentType:p.type},customMetadata:{purpose:'product-content-draft',productId:String(id)}});uploaded.push(p.key);}
    const mapping=new Map(prepared.map(p=>[p.ref,'/api/admin/product-images/'+p.key.slice(9)])), content=structuredClone(raw.content);
    for(const image of [content.hero,...content.gallery.flatMap(g=>g.images),...content.lookbook])if(mapping.has(image.src))image.src=mapping.get(image.src);
    return await saveProductContent(env,actor,id,{...raw,content},new Set(mapping.values()));
  }catch(error){for(const key of uploaded)try{if(!(await imageReferenced(env,key)))await env.PRODUCT_MEDIA.delete(key);}catch{/* Keep accepted or uncertain objects for recovery. */}throw error;}
}
