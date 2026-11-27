// Pure, environment-independent label layout (browser + Node tests).
// All geometry is in millimetres; font sizes in points. A `measure(text,sizePt,weight)` callback
// returns the rendered width in mm, so the same layout works with real fonts (canvas) or a test stub.
export const PT = 25.4 / 72;
export const SIZES = { A6: { w: 105, h: 148 }, A4: { w: 210, h: 297 } };
export const MARGIN = 7; // keeps content ≥7mm from any paper edge (printer non-printable area is typically ≤5mm)
export const LOGO_RATIO = 160 / 176; // official logo.png 176×160
const FONT = "Sarabun";

const seg = (locale, granularity) => new Intl.Segmenter(locale, { granularity });
const words = (s) => Array.from(seg("th", "word").segment(s), (x) => x.segment);
const graphemes = (s) => Array.from(seg("th", "grapheme").segment(s), (x) => x.segment);

// Greedy wrap that respects Thai word boundaries; breaks inside a word only if it cannot fit alone.
export function wrapText(text, maxW, size, weight, measure) {
  const out = [];
  for (const para of String(text ?? "").replace(/\r/g, "").split("\n")) {
    let line = "";
    const push = () => { out.push(line.replace(/\s+$/, "")); line = ""; };
    for (const tok of words(para)) {
      if (measure(line + tok, size, weight) <= maxW) { line += tok; continue; }
      if (line.trim()) push();
      const t = tok.replace(/^\s+/, "");
      if (measure(t, size, weight) <= maxW) { line = t; continue; }
      for (const g of graphemes(t)) { // very long unbroken token (e.g. long number/URL)
        if (measure(line + g, size, weight) > maxW && line) push();
        line += g;
      }
    }
    if (line.trim() || !out.length || para === "") push();
  }
  return out.length ? out : [""];
}

export function postalCode(address) {
  const m = [...String(address ?? "").matchAll(/(?<!\d)\d{5}(?!\d)/g)];
  return m.length ? m[m.length - 1][0] : "";
}

const clip = (lines, max, maxW, size, weight, measure) => {
  if (lines.length <= max) return { lines, clipped: false };
  const kept = lines.slice(0, max);
  let last = kept[max - 1];
  while (last && measure(last + "…", size, weight) > maxW) last = graphemes(last).slice(0, -1).join("");
  kept[max - 1] = last + "…";
  return { lines: kept, clipped: true };
};

// Fit paragraph text into maxH by shrinking from maxSize to minSize; never silently drops text.
function fit(text, maxW, maxH, maxSize, minSize, weight, measure, lead = 1.32) {
  for (let s = maxSize; s >= minSize - 1e-9; s -= 0.5) {
    const lines = wrapText(text, maxW, s, weight, measure);
    if (lines.length * s * PT * lead <= maxH) return { lines, size: s, lead, overflow: false };
  }
  const lines = wrapText(text, maxW, minSize, weight, measure);
  const max = Math.max(1, Math.floor(maxH / (minSize * PT * lead)));
  const c = clip(lines, max, maxW, minSize, weight, measure);
  return { lines: c.lines, size: minSize, lead, overflow: true };
}

/**
 * @param label {orderNo,recipient,phone,address,postalCode?,provider?,trackingNo?,itemCount?}
 * @param sender {brandName,senderName,address,phone} | null
 * @returns {w,h,ops,warnings}
 */
export function layoutLabel(label, sender, measure) {
  const { w, h } = SIZES.A6, L = MARGIN, R = w - MARGIN, W = R - L;
  const ops = [], warnings = [];
  const text = (x, y, t, size, weight = 400, align = "left") => ops.push({ t: "text", x, y, text: t, size, weight, align, font: FONT });
  const line = (y, lw = 0.3) => ops.push({ t: "line", x1: L, y1: y, x2: R, y2: y, w: lw });

  // Header: official logo (left) + order number (right)
  const logoW = 15;
  ops.push({ t: "logo", x: L, y: L, w: logoW, h: logoW * LOGO_RATIO });
  text(R, L + 4, "ORDER", 7, 400, "right");
  text(R, L + 12, label.orderNo || "—", measure(label.orderNo || "", 18, 700) > W - logoW - 4 ? 13 : 18, 700, "right");
  line(26);

  // Recipient zone (dominant)
  let y = 31;
  text(L, y, "ผู้รับ / TO", 8, 700);
  y += 3;
  const zipTxt = label.postalCode || postalCode(label.address);
  const name = fit(label.recipient, W, 17, 22, 14, 700, measure, 1.25);
  if (name.overflow) warnings.push("RECIPIENT_NAME_CLIPPED");
  y += name.size * PT;
  for (const l of name.lines) { text(L, y, l, name.size, 700); y += name.size * PT * name.lead; }
  y -= name.size * PT * (name.lead - 1);
  y += 1.5; text(L, y + 6.2 * PT, label.phone || "", 17, 700); y += 8.5;
  const zipH = zipTxt ? 11 : 0;
  const addrBottom = 108 - zipH;
  const addr = fit(label.address, W, addrBottom - y, 14, 9, 400, measure);
  if (addr.overflow) warnings.push("ADDRESS_OVERFLOW");
  y += addr.size * PT;
  for (const l of addr.lines) { text(L, y, l, addr.size, 400); y += addr.size * PT * addr.lead; }
  if (zipTxt) { text(L, 106, "รหัสไปรษณีย์", 8, 400); text(R, 107, zipTxt, 22, 700, "right"); }
  line(110);

  // Sender zone (secondary)
  if (!sender) warnings.push("SENDER_MISSING");
  const s = sender ?? { brandName: "", senderName: "", address: "", phone: "" };
  y = 114.5;
  text(L, y, "ผู้ส่ง / FROM", 7, 700);
  y += 4;
  text(L, y, [s.brandName, s.senderName].filter(Boolean).join(" · "), 9, 700); y += 3.8;
  const sa = clip(wrapText(s.address, W, 8, 400, measure), 3, W, 8, 400, measure);
  if (sa.clipped) warnings.push("SENDER_ADDRESS_CLIPPED");
  for (const l of sa.lines) { text(L, y, l, 8, 400); y += 3.5; }
  if (s.phone) text(L, y, "โทร " + s.phone, 8, 400);

  // Footer
  line(136);
  const ship = [label.provider, label.trackingNo].filter(Boolean).join("  ");
  if (ship) text(L, 141, ship, 8, 400);
  if (label.itemCount) text(R, 141, label.itemCount + " ชิ้น", 8, 400, "right");
  return { w, h, ops, warnings };
}

// 4-up A4 placement: exact quarter pages so A6 stays true size (no scaling).
export function a4Slots() {
  const { w, h } = SIZES.A6, ph = SIZES.A4.h / 2;
  return [[0, 0], [w, 0], [0, ph], [w, ph]].map(([x, y]) => ({ x, y: y + (ph - h) / 2, w, h }));
}
