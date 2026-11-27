// Browser-only rendering of layoutLabel() output to canvas at any PPI, plus PNG/PDF/print helpers.
import { layoutLabel, SIZES, PT, a4Slots } from "./label-layout.mjs";
import { setPngPpi } from "./png-meta.mjs";
import { buildPdf } from "./pdf-writer.mjs";

const mmToPx = (mm, ppi) => Math.round((mm / 25.4) * ppi);
let probe, logoImg, logoInk;

export async function loadAssets(logoUrl = "/admin/assets/norx-logo.png") {
  await Promise.all(["400", "700"].map((wt) => document.fonts.load(`${wt} 16px Sarabun`, "กขค ABC 0123")));
  if (!logoImg) {
    logoImg = new Image(); logoImg.src = logoUrl; await logoImg.decode();
    // Official logo is white-on-transparent; recolour to solid black to save ink on white labels.
    logoInk = document.createElement("canvas"); logoInk.width = logoImg.naturalWidth; logoInk.height = logoImg.naturalHeight;
    const c = logoInk.getContext("2d"); c.drawImage(logoImg, 0, 0); c.globalCompositeOperation = "source-in"; c.fillStyle = "#000"; c.fillRect(0, 0, logoInk.width, logoInk.height);
  }
}

export function measure(text, sizePt, weight) {
  probe ??= document.createElement("canvas").getContext("2d");
  probe.font = `${weight} 100px Sarabun`;
  return (probe.measureText(text).width / 100) * sizePt * PT;
}

export const buildLabel = (label, sender) => layoutLabel(label, sender, measure);

export function drawLabel(ctx, lay, ox, oy, ppi) {
  const X = (mm) => ox + (mm / 25.4) * ppi, Y = (mm) => oy + (mm / 25.4) * ppi;
  ctx.fillStyle = "#000"; ctx.strokeStyle = "#000";
  for (const op of lay.ops) {
    if (op.t === "line") { ctx.lineWidth = (op.w / 25.4) * ppi; ctx.beginPath(); ctx.moveTo(X(op.x1), Y(op.y1)); ctx.lineTo(X(op.x2), Y(op.y2)); ctx.stroke(); }
    else if (op.t === "logo") ctx.drawImage(logoInk, X(op.x), Y(op.y), (op.w / 25.4) * ppi, (op.h / 25.4) * ppi);
    else if (op.t === "text") {
      ctx.font = `${op.weight} ${(op.size * ppi) / 72}px ${op.font}`; ctx.textAlign = op.align; ctx.textBaseline = "alphabetic";
      ctx.fillText(op.text, X(op.x), Y(op.y));
    }
  }
}

const newCanvas = (wMm, hMm, ppi) => {
  const c = document.createElement("canvas"); c.width = mmToPx(wMm, ppi); c.height = mmToPx(hMm, ppi);
  const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  return { c, ctx };
};

export function renderA6(lay, ppi = 300) {
  const { c, ctx } = newCanvas(SIZES.A6.w, SIZES.A6.h, ppi);
  drawLabel(ctx, lay, 0, 0, ppi); return c;
}

/** A4 sheets with up to 4 true-size A6 labels each. startSlot (0-3) lets a partly used sheet be reused. */
export function renderA4Sheets(lays, ppi = 300, { startSlot = 0, guides = true } = {}) {
  const slots = a4Slots(), sheets = []; let i = 0, slot = startSlot;
  do {
    const { c, ctx } = newCanvas(SIZES.A4.w, SIZES.A4.h, ppi);
    if (guides) { // light centre guides for cutting, in the gutter between labels
      ctx.strokeStyle = "#bbb"; ctx.lineWidth = Math.max(1, ppi / 150); ctx.setLineDash([ppi / 12, ppi / 12]);
      ctx.beginPath(); ctx.moveTo(c.width / 2, 0); ctx.lineTo(c.width / 2, c.height); ctx.moveTo(0, c.height / 2); ctx.lineTo(c.width, c.height / 2); ctx.stroke(); ctx.setLineDash([]);
    }
    for (; slot < 4 && i < lays.length; slot++, i++) {
      const s = slots[slot]; drawLabel(ctx, lays[i], mmToPx(s.x, ppi), mmToPx(s.y, ppi), ppi);
    }
    sheets.push(c); slot = 0;
  } while (i < lays.length);
  return sheets;
}

export async function canvasToPng(canvas, ppi = 300) {
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  return setPngPpi(new Uint8Array(await blob.arrayBuffer()), ppi);
}

function gray(canvas) {
  const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data, g = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4];
  return { gray: g, wPx: canvas.width, hPx: canvas.height };
}

export const canvasesToPdf = (canvases, wMm, hMm) =>
  buildPdf(canvases.map((c) => ({ wMm, hMm, image: gray(c) })));

export function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type })), a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Print true-size pages. Printing never changes order status; "printed" is a separate explicit call. */
export async function printCanvases(canvases, wMm, hMm) {
  const area = document.getElementById("printArea"); area.replaceChildren();
  const urls = [];
  for (const c of canvases) {
    const url = URL.createObjectURL(await new Promise((r) => c.toBlob(r, "image/png"))); urls.push(url);
    const img = new Image(); img.src = url; img.alt = ""; img.className = "print-page " + (wMm > 150 ? "a4" : "a6"); area.append(img); // sizes and named @page come from static CSS (CSP forbids inline styles)
    await img.decode();
  }
  window.print();
  setTimeout(() => { area.replaceChildren(); urls.forEach((u) => URL.revokeObjectURL(u)); }, 1000);
}
