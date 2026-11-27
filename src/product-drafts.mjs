// Draft-only catalog preparation. No publish, active-price edit, deletion, or schema change.
import { UserError } from "./orders-core.mjs";
const rows = async stmt => (await stmt.all()).results;
const fail = message => { throw new UserError(message); };
const text = (value, max, required = false) => {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail("ตรวจข้อความสินค้าให้ถูกต้องและไม่ยาวเกินกำหนด");
  const result = value.trim(); if (required && !result) fail("กรอกชื่อสินค้าและข้อมูลทรงให้ครบ"); return result;
};
export async function draftBody(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) fail("รูปแบบคำขอไม่ถูกต้อง");
  const raw = await request.text(); if (raw.length > 16384) fail("ข้อมูลสินค้ายาวเกินกำหนด");
  try { return JSON.parse(raw); } catch { fail("รูปแบบคำขอไม่ถูกต้อง"); }
}
function normalize(raw) {
  const allowed = new Set(["slug", "name", "shortName", "fit", "fitName", "description", "collectionId", "prices", "sizes", "expectedRevision"]);
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(k => !allowed.has(k))) fail("บันทึกได้เฉพาะข้อมูลฉบับร่าง ยังเปิดขายจากหน้านี้ไม่ได้");
  const p = { slug: text(raw.slug, 60, true), name: text(raw.name, 140, true), shortName: text(raw.shortName ?? "", 60), fit: text(raw.fit, 40, true), fitName: text(raw.fitName, 80, true), description: text(raw.description ?? "", 3000), collectionId: raw.collectionId ?? null };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug) || p.slug.length < 3 || !/^[a-z][a-z0-9-]*$/.test(p.fit)) fail("รหัสสินค้าและรหัสทรงใช้ a-z, 0-9 และขีดกลางเท่านั้น");
  if (p.collectionId !== null && (!Number.isSafeInteger(p.collectionId) || p.collectionId <= 0)) fail("เลือก Collection จากรายการ");
  if (!raw.prices || typeof raw.prices !== "object" || Array.isArray(raw.prices) || !Object.keys(raw.prices).length || Object.keys(raw.prices).some(k => !["short", "long"].includes(k))) fail("ใส่ราคาแขนสั้นหรือแขนยาวอย่างน้อยหนึ่งแบบ");
  p.prices = {};
  for (const sleeve of ["short", "long"]) if (Object.hasOwn(raw.prices, sleeve)) {
    const price = raw.prices[sleeve]; if (!Number.isSafeInteger(price) || price < 1 || price > 1000000) fail("ราคาเป็นจำนวนเต็มตั้งแต่ 1 ถึง 1,000,000 บาท"); p.prices[sleeve] = price;
  }
  if (!Array.isArray(raw.sizes) || !raw.sizes.length || raw.sizes.length > 30) fail("ใส่ไซส์ 1–30 รายการ");
  p.sizes = raw.sizes.map(s => text(s, 16, true).toUpperCase());
  if (p.sizes.some(s => !/^[A-Z0-9][A-Z0-9 .+-]*$/.test(s)) || new Set(p.sizes).size !== p.sizes.length) fail("ตรวจไซส์ให้ไม่ซ้ำและใช้ตัวอักษรหรือตัวเลข เช่น S, M, L, 2XL");
  return p;
}
export async function listProducts(env) {
  const db = env.ORDERS_DB;
  const [products, variants, sizes, collections] = await Promise.all([
    rows(db.prepare("SELECT p.*,c.name collection_name,(SELECT COUNT(*) FROM order_items i WHERE i.product_id=p.id) order_uses,COALESCE((SELECT MAX(a.id) FROM audit_log a WHERE a.entity='products' AND a.entity_id=p.slug),0) revision FROM products p LEFT JOIN collections c ON c.id=p.collection_id ORDER BY CASE p.status WHEN 'draft' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,p.sort,p.id")),
    rows(db.prepare("SELECT product_id,sleeve,price_baht FROM product_variants WHERE active=1 ORDER BY id")),
    rows(db.prepare("SELECT product_id,size FROM product_sizes WHERE active=1 ORDER BY sort,id")),
    rows(db.prepare("SELECT id,name,status FROM collections ORDER BY name,id")),
  ]);
  return { products: products.map(p => ({ id: p.id, slug: p.slug, name: p.name, shortName: p.short_name || "", fit: p.fit, fitName: p.fit_name, description: p.description || "", collectionId: p.collection_id, collectionName: p.collection_name || "", status: p.status, revision: p.revision, editable: p.status === "draft" && p.order_uses === 0, prices: Object.fromEntries(variants.filter(v => v.product_id === p.id).map(v => [v.sleeve, v.price_baht])), sizes: sizes.filter(s => s.product_id === p.id).map(s => s.size) })), collections };
}
export async function saveDraft(env, actor, raw, id = null) {
  const p = normalize(raw), db = env.ORDERS_DB;
  const catalog = await listProducts(env), old = id === null ? null : catalog.products.find(v => v.id === id);
  if (id !== null && (!old || !old.editable)) fail("สินค้าที่เปิดขาย มีออเดอร์ หรือเก็บไว้แล้ว ดูข้อมูลได้อย่างเดียว");
  if (old && (p.slug !== old.slug || !Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision !== old.revision)) fail("ข้อมูลเปลี่ยนแล้ว กรุณาโหลดสินค้าใหม่ก่อนบันทึก");
  if (p.collectionId !== null && !catalog.collections.some(c => c.id === p.collectionId && c.status !== "archived")) fail("Collection นี้ไม่พร้อมใช้งาน");
  const token = crypto.randomUUID(), next = JSON.stringify({ ...p, status: "draft", operationToken: token });
  const guard = "EXISTS(SELECT 1 FROM audit_log a WHERE a.entity='products' AND a.entity_id=?1 AND json_extract(a.after,'$.operationToken')=?2)";
  const statements = [];
  if (!old) {
    statements.push(db.prepare("INSERT INTO products(slug,name,short_name,fit,fit_name,description,collection_id,status) VALUES (?1,?2,?3,?4,?5,?6,?7,'draft')").bind(p.slug, p.name, p.shortName, p.fit, p.fitName, p.description, p.collectionId));
    statements.push(db.prepare("INSERT INTO audit_log(actor_hash,action,entity,entity_id,after) VALUES (?1,'product.draft.create','products',?2,?3)").bind(actor, p.slug, next));
  } else {
    // The audit insertion is the compare-and-set lock; all following writes require THIS operation token.
    statements.push(db.prepare("INSERT INTO audit_log(actor_hash,action,entity,entity_id,before,after) SELECT ?1,'product.draft.update','products',?2,?3,?4 WHERE EXISTS(SELECT 1 FROM products p WHERE p.id=?5 AND p.status='draft' AND NOT EXISTS(SELECT 1 FROM order_items i WHERE i.product_id=p.id)) AND COALESCE((SELECT MAX(id) FROM audit_log WHERE entity='products' AND entity_id=?2),0)=?6").bind(actor, p.slug, JSON.stringify(old), next, id, raw.expectedRevision));
    statements.push(db.prepare("UPDATE products SET name=?3,short_name=?4,fit=?5,fit_name=?6,description=?7,collection_id=?8 WHERE slug=?1 AND status='draft' AND " + guard).bind(p.slug, token, p.name, p.shortName, p.fit, p.fitName, p.description, p.collectionId));
    statements.push(db.prepare("UPDATE product_variants SET active=0 WHERE product_id=(SELECT id FROM products WHERE slug=?1) AND " + guard).bind(p.slug, token));
    statements.push(db.prepare("UPDATE product_sizes SET active=0 WHERE product_id=(SELECT id FROM products WHERE slug=?1) AND " + guard).bind(p.slug, token));
  }
  for (const [sleeve, price] of Object.entries(p.prices)) statements.push(db.prepare("INSERT INTO product_variants(product_id,sleeve,price_baht,active) SELECT id,?3,?4,1 FROM products WHERE slug=?1 AND status='draft' AND " + guard + " ON CONFLICT(product_id,sleeve) DO UPDATE SET price_baht=excluded.price_baht,active=1").bind(p.slug, token, sleeve, price));
  for (const [sort, size] of p.sizes.entries()) statements.push(db.prepare("INSERT INTO product_sizes(product_id,size,sort,active) SELECT id,?3,?4,1 FROM products WHERE slug=?1 AND status='draft' AND " + guard + " ON CONFLICT(product_id,size) DO UPDATE SET sort=excluded.sort,active=1").bind(p.slug, token, size, sort));
  let result;
  try { result = await db.batch(statements); } catch (error) {
    if (/UNIQUE constraint failed: products.slug/.test(String(error.message))) fail("รหัสสินค้านี้มีอยู่แล้ว กรุณาใช้รหัสอื่น");
    throw error;
  }
  if (result[0].meta.changes !== 1) fail("ข้อมูลเปลี่ยนแล้ว กรุณาโหลดสินค้าใหม่ก่อนบันทึก");
  return (await listProducts(env)).products.find(v => v.slug === p.slug);
}
