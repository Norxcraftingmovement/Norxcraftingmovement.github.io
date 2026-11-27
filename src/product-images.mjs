// Private draft covers. Deliberately separate from the live Events poster bucket/binding.
import { UserError } from "./orders-core.mjs";
import { draftBody, saveDraft } from "./product-drafts.mjs";
const MAX = 4 * 1024 * 1024;
const types = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const bad = message => { throw new UserError(message); };
export function imageType(bytes, type) {
  if (!types[type] || !bytes.length || bytes.length > MAX) bad("ใช้ JPG, PNG หรือ WebP ขนาดไม่เกิน 4 MB");
  const ascii = (a, b) => String.fromCharCode(...bytes.slice(a, b));
  const valid = type === "image/jpeg" ? bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217
    : type === "image/png" ? bytes.length > 24 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
    : bytes.length > 12 && ascii(0,4) === "RIFF" && ascii(8,12) === "WEBP" && new DataView(bytes.buffer, bytes.byteOffset).getUint32(4,true) + 8 === bytes.length;
  if (!valid) bad("ไฟล์ไม่ตรงกับชนิดรูป กรุณาเลือกรูปใหม่");
  return types[type];
}
async function boundedBody(request) {
  if (!request.body || Number(request.headers.get("content-length")) > MAX + 32768) bad("ไฟล์รูปใหญ่เกิน 4 MB");
  const reader = request.body.getReader(), chunks = []; let size = 0;
  for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > MAX + 32768) { await reader.cancel(); bad("ไฟล์รูปใหญ่เกิน 4 MB"); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; } return bytes;
}
export async function saveProductRequest(request, env, actor, id = null) {
  if (!(request.headers.get("content-type") || "").startsWith("multipart/form-data;")) return saveDraft(env, actor, await draftBody(request), id);
  if (!env.PRODUCT_MEDIA) bad("ยังไม่ได้เชื่อมพื้นที่รูปสินค้า บันทึกข้อมูลร่างโดยไม่เพิ่มรูปได้");
  const bytes = await boundedBody(request); let form;
  try { form = await new Response(bytes,{headers:{"Content-Type":request.headers.get("content-type")}}).formData(); } catch { bad("อ่านรูปไม่ได้ กรุณาเลือกรูปใหม่"); }
  if ([...form.keys()].length !== 2 || form.getAll("data").length !== 1 || form.getAll("cover").length !== 1) bad("ข้อมูลรูปไม่ถูกต้อง");
  const data = form.get("data"), cover = form.get("cover"); let raw;
  if (typeof data !== "string" || data.length > 16384 || !cover || typeof cover.arrayBuffer !== "function") bad("ข้อมูลรูปไม่ถูกต้อง");
  try { raw = JSON.parse(data); } catch { bad("ข้อมูลสินค้าไม่ถูกต้อง"); }
  const content = new Uint8Array(await cover.arrayBuffer()), ext = imageType(content, cover.type);
  const key = "products/" + crypto.randomUUID() + "." + ext;
  await env.PRODUCT_MEDIA.put(key, content, {httpMetadata:{contentType:cover.type},customMetadata:{purpose:"product-draft"}});
  try { return await saveDraft(env, actor, raw, id, key); }
  catch (error) {
    // A response/read failure can occur AFTER the transaction committed. Never delete a referenced cover.
    try { if (!(await env.ORDERS_DB.prepare("SELECT id FROM products WHERE image_key=?").bind(key).first())) await env.PRODUCT_MEDIA.delete(key); } catch { /* Retain rather than risk deleting an accepted cover. */ }
    throw error;
  }
}
export async function productImage(env, file) {
  const headers = {"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow","Content-Security-Policy":"default-src 'none'; sandbox"};
  if (!env.PRODUCT_MEDIA || !(await env.ORDERS_DB.prepare("SELECT id FROM products WHERE image_key=?").bind("products/"+file).first())) return new Response(null,{status:404,headers});
  const object = await env.PRODUCT_MEDIA.get("products/"+file);
  if (!object) return new Response(null,{status:404,headers});
  return new Response(object.body,{headers:{...headers,"Content-Type":Object.entries(types).find(([,ext]) => file.endsWith("."+ext))[0]}});
}
