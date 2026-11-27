// canvas.toBlob() writes no resolution metadata; add a pHYs chunk so viewers/printers see 300 PPI.
const table = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function setPngPpi(png, ppi = 300) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || sig.some((v, i) => png[i] !== v)) throw new Error("NOT_PNG");
  const dv = (a) => new DataView(a.buffer, a.byteOffset, a.byteLength);
  const ppm = Math.round(ppi / 0.0254);
  const chunk = new Uint8Array(21); // len(4) "pHYs"(4) data(9) crc(4)
  const c = dv(chunk); c.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  c.setUint32(8, ppm); c.setUint32(12, ppm); chunk[16] = 1;
  c.setUint32(17, crc32(chunk.subarray(4, 17)));
  // drop any existing pHYs, insert right after IHDR (8 sig + 25 IHDR)
  const parts = [png.subarray(0, 33), chunk]; let o = 33;
  while (o < png.length) {
    const len = dv(png).getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8)), end = o + 12 + len;
    if (type !== "pHYs") parts.push(png.subarray(o, end));
    o = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

export function readPngInfo(png) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const info = { width: v.getUint32(16), height: v.getUint32(20), ppi: null };
  for (let o = 33; o < png.length;) {
    const len = v.getUint32(o), type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === "pHYs") info.ppi = Math.round(v.getUint32(o + 8) * 0.0254);
    o += 12 + len;
  }
  return info;
}
