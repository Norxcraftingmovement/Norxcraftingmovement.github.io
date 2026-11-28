// Create / edit an order round: pure helpers (no DOM) so they can be unit-tested. The API (POST /api/admin/rounds) reads
// "YYYY-MM-DDTHH:mm" as Bangkok time and stores UTC, so the form works in Bangkok wall-clock time throughout.
const BANGKOK_MS = 7 * 3600e3, DAY = 86400e3;
export const DELIVERY_OPTIONS = [["city", "นัดรับในเมืองเชียงราย"], ["event", "รับที่งานกิจกรรม"], ["ship", "จัดส่ง"]];

/** UTC ISO string (or ms) -> "YYYY-MM-DDTHH:mm" in Bangkok time, the value of an <input type=datetime-local>. */
export const toLocalInput = (v) => (v === null || v === undefined || v === "" ? "" : new Date((typeof v === "number" ? v : Date.parse(v)) + BANGKOK_MS).toISOString().slice(0, 16));

/**
 * Starting values for a NEW round: opens now, closes in 7 days at 23:59, pay by the next day 10:00 (Bangkok time).
 * Delivery options, fees and the "ready" text are copied from the previous round when there is one; money fields stay
 * empty otherwise so nobody saves a fee they never typed.
 */
export function defaultRound(nowMs, rounds = []) {
  const last = rounds.at(-1), day = (n) => toLocalInput(nowMs + n * DAY).slice(0, 10);
  return {
    name: "รอบ " + (rounds.length + 1), opensAt: toLocalInput(nowMs), closesAt: day(7) + "T23:59", paymentDue: day(8) + "T10:00",
    deliveries: last?.deliveries?.length ? [...last.deliveries] : ["city", "ship"], shipping: last ? String(last.shipping) : "", supplierShipping: last ? String(last.supplierShipping ?? "") : "", readyText: last?.readyText ?? "",
    eventName: "", // never copied: an old event name left on a new round would send customers to the wrong event
  };
}
/** Values of an existing round for the edit form. */
export const roundToForm = (r) => ({ name: r.name, opensAt: toLocalInput(r.opensAt), closesAt: toLocalInput(r.closesAt), paymentDue: toLocalInput(r.paymentDue), deliveries: [...r.deliveries], shipping: String(r.shipping), supplierShipping: String(r.supplierShipping ?? 0), readyText: r.readyText ?? "", eventName: r.eventName ?? "" });

/** Form values -> request body. Returns { error } for what the server would reject anyway, so the message appears before the round trip. */
export function roundBody(f, id = null) {
  const name = String(f.name ?? "").trim(), dates = [f.opensAt, f.closesAt, f.paymentDue], re = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;
  if (name.length < 2 || name.length > 60) return { error: "กรุณาตั้งชื่อรอบ (2–60 ตัวอักษร)" };
  if (!dates.every((d) => re.test(String(d ?? "")))) return { error: "กรุณากรอกวันเปิดรับ วันปิดรับ และกำหนดโอนให้ครบ" };
  if (!(f.opensAt < f.closesAt)) return { error: "วันปิดรับต้องหลังวันเปิดรับ" };
  if (f.paymentDue < f.closesAt) return { error: "กำหนดโอนต้องไม่ก่อนวันปิดรับ" };
  const deliveries = DELIVERY_OPTIONS.map(([k]) => k).filter((k) => (f.deliveries ?? []).includes(k));
  if (!deliveries.length) return { error: "เลือกวิธีรับสินค้าอย่างน้อย 1 แบบ" };
  const eventName = deliveries.includes("event") ? String(f.eventName ?? "").trim().replace(/\s+/g, " ") : "";
  if (deliveries.includes("event") && (eventName.length < 1 || eventName.length > 120)) return { error: "กรุณาใส่ชื่อกิจกรรมสำหรับตัวเลือก \"รับที่งาน\" (ไม่เกิน 120 ตัวอักษร)" };
  const ship = Number(f.shipping), sup = Number(f.supplierShipping);
  if (String(f.shipping ?? "").trim() === "" || !Number.isSafeInteger(ship) || ship < 0 || ship > 1000) return { error: "ค่าส่งลูกค้าต้องเป็นเลขจำนวนเต็ม 0–1,000 บาท" };
  if (String(f.supplierShipping ?? "").trim() === "" || !Number.isSafeInteger(sup) || sup < 0 || sup > 5000) return { error: "ค่าส่งร้านต้องเป็นเลขจำนวนเต็ม 0–5,000 บาท" };
  return { body: { ...(id ? { id } : {}), name, opensAt: f.opensAt, closesAt: f.closesAt, paymentDue: f.paymentDue, deliveries, eventName, shipping: ship, supplierShipping: sup, readyText: String(f.readyText ?? "").trim().slice(0, 120) } };
}
