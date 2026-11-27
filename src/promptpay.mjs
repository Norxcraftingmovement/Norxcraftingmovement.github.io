// Thai QR Payment / PromptPay credit-transfer payload (EMVCo merchant-presented, tag 29 = PromptPay).
// IMPORTANT: PromptPay identifies a payee by MOBILE NUMBER, NATIONAL ID, TAX ID or E-WALLET ID registered with PromptPay.
// An ordinary bank ACCOUNT NUMBER cannot be encoded into a PromptPay QR and is rejected here. This QR type carries payee +
// amount only; it does NOT carry an order reference and the bank sends us no callback. Payment is verified manually.
const AID_PROMPTPAY = "A000000677010111";
export const ID_TYPES = { mobile: { sub: "01", label: "เบอร์มือถือ" }, national_id: { sub: "02", label: "เลขบัตรประชาชน" }, tax_id: { sub: "02", label: "เลขประจำตัวผู้เสียภาษี" }, ewallet: { sub: "03", label: "e-Wallet ID" } };

export function crc16(str) { // CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF, no reflection, no xorout (bitwise implementation)
  let crc = 0xffff;
  for (const b of new TextEncoder().encode(str)) { crc ^= b << 8; for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
const tlv = (tag, value) => { if (value.length > 99) throw new Error("TLV value too long"); return tag + String(value.length).padStart(2, "0") + value; };
export function parseTlv(s) { const out = []; for (let i = 0; i < s.length;) { const tag = s.slice(i, i + 2), len = Number(s.slice(i + 2, i + 4)); if (!/^\d{2}$/.test(tag) || !Number.isInteger(len) || i + 4 + len > s.length) throw new Error("bad TLV at " + i); out.push([tag, s.slice(i + 4, i + 4 + len)]); i += 4 + len; } return out; }
export function verifyCrc(payload) { return payload.length > 8 && payload.slice(-8, -4) === "6304" && crc16(payload.slice(0, -4)) === payload.slice(-4); }

const nationalIdOk = (d) => { let sum = 0; for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i); return (11 - (sum % 11)) % 10 === Number(d[12]); };
/** Validate and normalise a PromptPay ID. Throws Error with a Thai message for anything that is not a valid PromptPay identifier. */
export function normalizePromptPayId(type, raw) {
  if (!ID_TYPES[type]) throw new Error("ประเภท PromptPay ไม่ถูกต้อง");
  const d = String(raw ?? "").replace(/[\s-]/g, "");
  if (!/^\d+$/.test(d)) throw new Error("PromptPay ID ต้องเป็นตัวเลข");
  if (type === "mobile") { if (!/^0[6-9]\d{8}$/.test(d)) throw new Error("เบอร์มือถือต้องเป็น 10 หลักขึ้นต้น 06–09 (เลขบัญชีธนาคารใช้สร้าง PromptPay QR ไม่ได้)"); return { type, value: "0066" + d.slice(1), display: d }; }
  if (type === "ewallet") { if (!/^\d{15}$/.test(d)) throw new Error("e-Wallet ID ต้องเป็น 15 หลัก"); return { type, value: d, display: d }; }
  if (!/^\d{13}$/.test(d)) throw new Error("เลขบัตรประชาชน/ผู้เสียภาษีต้องเป็น 13 หลัก (เลขบัญชีธนาคารใช้สร้าง PromptPay QR ไม่ได้)");
  if (type === "national_id" && !nationalIdOk(d)) throw new Error("เลขบัตรประชาชนไม่ผ่านการตรวจเลขหลักสุดท้าย");
  return { type, value: d, display: d };
}
export const maskPromptPayId = (type, display) => (type === "mobile" ? display.slice(0, 3) + "-xxx-" + display.slice(-4) : "xxxxxxxxx" + display.slice(-4));

/** @param amountBaht integer baht, 1 … 9,999,999. Returns the QR text. Amount is formatted with two decimals (satang). */
export function buildPromptPayPayload({ type, id, amountBaht }) {
  const p = normalizePromptPayId(type, id);
  if (!Number.isSafeInteger(amountBaht) || amountBaht < 1 || amountBaht > 9_999_999) throw new Error("ยอดเงินไม่ถูกต้องสำหรับ QR");
  const merchant = tlv("00", AID_PROMPTPAY) + tlv(ID_TYPES[type].sub, p.value);
  const body = tlv("00", "01") + tlv("01", "12") /* 12 = dynamic (one-time, amount fixed) */ + tlv("29", merchant) + tlv("53", "764") + tlv("54", amountBaht.toFixed(2)) + tlv("58", "TH") + "6304";
  return body + crc16(body);
}
