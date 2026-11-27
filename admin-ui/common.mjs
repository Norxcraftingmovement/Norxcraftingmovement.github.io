export const $ = (id) => document.getElementById(id);
export async function api(path, { method = "GET", body } = {}) {
  const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, credentials: "same-origin" });
  let data = null; try { data = await r.json(); } catch {}
  if (!r.ok || data?.ok === false) { const e = new Error(data?.error || "HTTP_" + r.status); e.code = data?.error; e.userMessage = data?.message; throw e; }
  return data;
}
export function notice(el, text, isErr = false) { el.hidden = !text; el.textContent = text || ""; el.classList.toggle("err", isErr); }
export const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
export const ERR = {
  INVALID_SENDER: "ข้อมูลผู้ส่งไม่ถูกต้อง ตรวจชื่อแบรนด์ ชื่อผู้ส่ง ที่อยู่ (อย่างน้อย 10 ตัวอักษร) และเบอร์โทร",
  INVALID_ADDRESS: "ที่อยู่ไม่ถูกต้อง ต้องมีชื่อ เบอร์ 9–10 หลักขึ้นต้น 0 และที่อยู่พร้อมรหัสไปรษณีย์ 5 หลัก",
  INVALID_SHIPMENT: "ข้อมูลการจัดส่งไม่ถูกต้อง (เลขพัสดุใช้ A-Z 0-9 และ - เท่านั้น, วันที่รูปแบบ YYYY-MM-DD)",
  ACCESS_REQUIRED: "ไม่มีสิทธิ์เข้าถึง กรุณาเข้าสู่ระบบผ่าน Cloudflare Access",
};
export const errText = (e) => ERR[e.code] ?? "เกิดข้อผิดพลาด (" + (e.code || e.message) + ")";
