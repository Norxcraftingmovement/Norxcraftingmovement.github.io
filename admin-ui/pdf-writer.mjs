// Minimal PDF writer: real-size pages, each carrying one 8-bit grayscale image (Flate-compressed).
// Label text is rasterised at 300 PPI (no font embedding needed for Thai); page size is exact.
const MM = 72 / 25.4;
const enc = new TextEncoder();
async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const num = (n) => (Math.round(n * 1000) / 1000).toString();

/** pages: [{wMm,hMm, image:{gray:Uint8Array,wPx,hPx}}] */
export async function buildPdf(pages, { title = "NORX labels" } = {}) {
  const chunks = [], offsets = [];
  let size = 0;
  const put = (d) => { const b = typeof d === "string" ? enc.encode(d) : d; chunks.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; put(`${n} 0 obj\n`); put(body); put("\nendobj\n"); };
  put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  // objects: 1 catalog, 2 pages, 3 info, then per page: page, content, image
  const kids = pages.map((_, i) => `${4 + i * 3} 0 R`).join(" ");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>`);
  obj(3, `<< /Title (${title.replace(/[()\\]/g, "")}) /Producer (NORX Orders) >>`);
  for (const [i, p] of pages.entries()) {
    const pg = 4 + i * 3, wPt = p.wMm * MM, hPt = p.hMm * MM, z = await deflate(p.image.gray);
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(wPt)} ${num(hPt)}] /Resources << /XObject << /Im0 ${pg + 2} 0 R >> >> /Contents ${pg + 1} 0 R >>`);
    const content = `q ${num(wPt)} 0 0 ${num(hPt)} 0 0 cm /Im0 Do Q`;
    obj(pg + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offsets[pg + 2] = size;
    put(`${pg + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.image.wPx} /Height ${p.image.hPx} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${z.length} >>\nstream\n`);
    put(z); put("\nendstream\nendobj\n");
  }
  const count = 4 + pages.length * 3, xref = size;
  put(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) put(String(offsets[n]).padStart(10, "0") + " 00000 n \n");
  put(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
