// Carrier names and tracking-number checks, shared by the admin UI and the Worker (pure functions).
// Checks only WARN — carriers change formats without notice, so a person can always confirm and save.
// Add a carrier by adding one row to CARRIERS; unknown carriers are never format-checked ("อื่น ๆ").

// UPU S10 (used by Thai Post): 2 letters + 8 digits + check digit + 2-letter country code.
const S10_WEIGHTS = [8, 6, 4, 2, 3, 5, 9, 7];
export function s10CheckDigit(eightDigits) {
  const sum = [...eightDigits].reduce((s, d, i) => s + Number(d) * S10_WEIGHTS[i], 0);
  const c = 11 - (sum % 11);
  return c === 10 ? 0 : c === 11 ? 5 : c;
}
function checkThaiPost(t) {
  const m = /^([A-Z]{2})(\d{8})(\d)(TH)$/.exec(t);
  if (!m) return "เลขไปรษณีย์ไทยควรเป็นตัวอักษร 2 ตัว + ตัวเลข 9 หลัก + TH (เช่น EE123456785TH)";
  if (s10CheckDigit(m[2]) !== Number(m[3])) return "ตัวเลขหลักสุดท้ายไม่ผ่านการตรวจ น่าจะพิมพ์ผิดหรือสลับหลัก";
  return null;
}
// Flash Express: observed as TH + 12 upper-case letters/digits (14 characters) in 3 real samples.
function checkFlash(t) {
  return /^TH[A-Z0-9]{12}$/.test(t) ? null : "เลข Flash ปกติขึ้นต้น TH ตามด้วยตัวอักษร/ตัวเลข 12 ตัว (รวม 14 ตัว)";
}

export const CARRIERS = [
  { name: "Flash Express", aliases: ["flash", "flash express", "แฟลช", "แฟลชเอ็กซ์เพรส"], check: checkFlash },
  { name: "ไปรษณีย์ไทย", aliases: ["ไปรษณีย์ไทย", "ไปรษณีย์", "thai post", "thailand post", "thaipost", "ems"], check: checkThaiPost },
];
export const OTHER = "อื่น ๆ";

const fold = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export function canonicalCarrier(input) {
  const f = fold(input);
  const hit = CARRIERS.find((c) => c.aliases.includes(f) || fold(c.name) === f);
  return hit ? hit.name : String(input ?? "").trim();
}
export function checkTracking(carrier, tracking) {
  const t = String(tracking ?? "").trim().toUpperCase();
  if (!t) return { ok: true, warnings: [] };
  const hit = CARRIERS.find((c) => c.name === canonicalCarrier(carrier));
  const msg = hit ? hit.check(t) : null;
  return { ok: !msg, warnings: msg ? [msg] : [] };
}
