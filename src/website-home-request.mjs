import { UserError } from "./orders-core.mjs";
import { imageType, imageReferenced, boundedBody } from "./product-images.mjs";
import { getHome, normalizeHome, saveHome } from "./website-home.mjs";
const bad=m=>{throw new UserError(m);};
export async function websiteJson(request){
  if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json')||!request.body)bad('รูปแบบข้อมูลไม่ถูกต้อง');const reader=request.body.getReader(),chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();bad('ข้อมูลหน้าแรกยาวเกินกำหนด');}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{bad('รูปแบบข้อมูลไม่ถูกต้อง');}
}
export async function saveHomeRequest(request,env,actor){
  if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('multipart/form-data;'))return saveHome(env,actor,await websiteJson(request));
  if(!env.PRODUCT_MEDIA)bad('ยังไม่ได้เชื่อมพื้นที่รูป บันทึกข้อความและเรียงสินค้าได้');const bytes=await boundedBody(request);let form;try{form=await new Response(bytes,{headers:{'Content-Type':request.headers.get('content-type')}}).formData();}catch{bad('อ่านรูปไม่ได้ กรุณาเลือกใหม่');}
  if([...form.keys()].length!==2||form.getAll('data').length!==1||form.getAll('cover').length!==1)bad('ข้อมูลรูปไม่ถูกต้อง');const data=form.get('data'),file=form.get('cover');if(typeof data!=='string'||data.length>32768||typeof file?.arrayBuffer!=='function')bad('ข้อมูลรูปไม่ถูกต้อง');let raw;try{raw=JSON.parse(data);}catch{bad('ข้อมูลหน้าแรกไม่ถูกต้อง');}
  if(!raw||Object.keys(raw).some(k=>!['expectedRevision','content'].includes(k)))bad('ข้อมูลหน้าแรกไม่ถูกต้อง');const state=await getHome(env);if(raw.expectedRevision!==state.revision)bad('ข้อมูลเปลี่ยนแล้ว กรุณาโหลดฉบับล่าสุด');normalizeHome(raw.content,new Set([state.defaults.hero.src,state.content.hero.src,'upload:hero']));if(raw.content.hero.src!=='upload:hero')bad('เลือกรูปที่ใช้กับภาพหลักก่อนบันทึก');
  const content=new Uint8Array(await file.arrayBuffer()),ext=imageType(content,file.type),key='products/'+crypto.randomUUID()+'.'+ext,src='/api/admin/product-images/'+key.slice(9);
  await env.PRODUCT_MEDIA.put(key,content,{httpMetadata:{contentType:file.type},customMetadata:{purpose:'homepage-draft'}});
  try{return await saveHome(env,actor,{...raw,content:{...raw.content,hero:{...raw.content.hero,src}}},src);}catch(e){try{if(!(await imageReferenced(env,key)))await env.PRODUCT_MEDIA.delete(key);}catch{}throw e;}
}
