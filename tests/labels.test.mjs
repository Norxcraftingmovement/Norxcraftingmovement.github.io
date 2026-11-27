import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {layoutLabel,wrapText,postalCode,a4Slots,SIZES,MARGIN,PT} from "../admin-ui/label-layout.mjs";
import {setPngPpi,readPngInfo,crc32} from "../admin-ui/png-meta.mjs";
import {buildPdf} from "../admin-ui/pdf-writer.mjs";
import {generate} from "../scripts/build-orders-admin-assets.mjs";

// Stub font metrics: Thai combining marks/vowels above/below have zero width, others ~0.5em (Thai ≈0.55em).
const zero=/[ัิ-ฺ็-๎]/;
const measure=(t,size,wt)=>[...t].reduce((w,c)=>w+(zero.test(c)?0:(/[฀-๿]/.test(c)?0.55:0.5)*size*PT*(wt>=700?1.05:1)),0);
const sender={brandName:"NORX TEST",senderName:"ผู้ส่ง ทดสอบ",address:"1 ถนนทดสอบ ตำบลสมมติ อำเภอสมมติ จังหวัดสมมติ 00000",phone:"0800000000"};
const longAddr="เลขที่ 123/45 อาคารสมมติเรสซิเดนซ์ ชั้น 12 ห้อง 1208 หมู่บ้านทดสอบวิลล์ ซอยทดสอบ 7 แยก 3 (ตรงข้ามร้านสมมติ ติดกับโรงเรียนทดสอบวิทยา) ถนนสมมติเหนือ แขวงทดสอบใต้ เขตสมมติ กรุงเทพมหานคร 10110 โทรก่อนส่งทุกครั้ง ฝากไว้กับ รปภ. ได้";
const base={orderNo:"TEST-0001",recipient:"ทดสอบ นามสมมติ",phone:"0800000001",address:"99/9 หมู่ 9 ถนนทดสอบ ตำบลทดสอบ อำเภอเมืองสมมติ จังหวัดเชียงราย 57000",itemCount:2};
const textOps=l=>l.ops.filter(o=>o.t==="text");

test("Thai wrapping breaks at word boundaries and never exceeds the width",()=>{
  const W=91,lines=wrapText(longAddr,W,11,400,measure);
  assert.ok(lines.length>3);
  for(const l of lines)assert.ok(measure(l,11,400)<=W+1e-6,l);
  assert.equal(lines.join("").replace(/\s/g,""),longAddr.replace(/\s/g,"")); // nothing lost
  // unbroken very long token is split by grapheme, still lossless
  const tok="9".repeat(120);assert.equal(wrapText(tok,W,11,400,measure).join(""),tok);
  assert.ok(!lines.some(l=>/^[ัิ-ฺ็-๎]/.test(l)),"line must not start with a combining mark");
});
test("postal code = last standalone 5-digit group, ignores phone numbers",()=>{
  assert.equal(postalCode("โทร 0800000001 ที่อยู่ 10110 ถนน 57000"),"57000");
  assert.equal(postalCode("ไม่มีรหัส 0800000001"),"");
});
test("A6 label: fixed size, content inside safe margin, recipient dominates sender",()=>{
  const l=layoutLabel(base,sender,measure);
  assert.deepEqual([l.w,l.h],[105,148]);assert.deepEqual(l.warnings,[]);
  for(const o of textOps(l)){assert.ok(o.y<=SIZES.A6.h-MARGIN+0.01,"below margin: "+o.text);assert.ok(o.y>=MARGIN-0.01);
    const w=measure(o.text,o.size,o.weight),x0=o.align==="right"?o.x-w:o.x;assert.ok(x0>=MARGIN-0.01&&x0+w<=SIZES.A6.w-MARGIN+0.01,"horizontal: "+o.text)}
  const rec=textOps(l).find(o=>o.text===base.recipient),from=textOps(l).find(o=>o.text.startsWith("NORX TEST"));
  assert.ok(rec.size>=2*from.size,"recipient must be much larger than sender");
  assert.equal(l.ops.filter(o=>o.t==="logo").length,1);
  assert.ok(textOps(l).some(o=>o.text==="57000"&&o.size>=20),"postal code is prominent");
});
test("long Thai name + long address stay inside the label, shrink but keep all text",()=>{
  const l=layoutLabel({...base,recipient:"ทดสอบ ชื่อยาวมากสำหรับตรวจการตัดบรรทัด สมมติ นามสกุลยาวเช่นกัน",address:longAddr},sender,measure);
  assert.ok(!l.warnings.includes("ADDRESS_OVERFLOW"),l.warnings.join());
  const addr=textOps(l).filter(o=>o.weight===400&&o.size<=14&&o.size>=9&&o.y>40&&o.y<106);
  assert.equal(addr.map(o=>o.text).join("").replace(/\s/g,""),longAddr.replace(/\s/g,""));
  for(const o of textOps(l))assert.ok(o.y<=141.01);
  // address block must not run into the divider at y=110 / postal row
  assert.ok(Math.max(...addr.map(o=>o.y))<=106-1);
});
test("absurdly long address is flagged, never silently cut",()=>{
  const l=layoutLabel({...base,address:longAddr.repeat(4)},sender,measure);
  assert.ok(l.warnings.includes("ADDRESS_OVERFLOW"));
});
test("missing sender is flagged so UI can block printing",()=>{
  assert.ok(layoutLabel(base,null,measure).warnings.includes("SENDER_MISSING"));
});
test("A4 4-up: four true-size A6 slots, no overlap, inside page",()=>{
  const s=a4Slots();assert.equal(s.length,4);
  for(const a of s){assert.deepEqual([a.w,a.h],[105,148]);assert.ok(a.x>=0&&a.x+a.w<=210&&a.y>=0&&a.y+a.h<=297)}
  for(const [i,a] of s.entries())for(const b of s.slice(i+1))assert.ok(a.x+a.w<=b.x||b.x+b.w<=a.x||a.y+a.h<=b.y||b.y+b.h<=a.y,"overlap");
  // label content (≥7mm inside each slot) is ≥7mm from every paper edge
  for(const a of s)assert.ok(a.x+MARGIN>=7&&a.y+MARGIN>=7&&210-(a.x+a.w-MARGIN)>=7&&297-(a.y+a.h-MARGIN)>=7);
});
test("pixel sizes at 300 PPI: A6 1240×1748, A4 2480×3508",()=>{
  const px=mm=>Math.round(mm/25.4*300);
  assert.deepEqual([px(105),px(148)],[1240,1748]);assert.deepEqual([px(210),px(297)],[2480,3508]);
});

// minimal valid 1x1 PNG
const png1=Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64"));
test("PNG gets pHYs = 300 PPI, stays valid, replaces existing pHYs, CRC correct",()=>{
  const out=setPngPpi(png1,300);assert.deepEqual(readPngInfo(out),{width:1,height:1,ppi:300});
  assert.equal(readPngInfo(setPngPpi(out,150)).ppi,150);
  const again=setPngPpi(out,300);assert.equal(again.length,out.length); // no duplicate chunk
  assert.equal(crc32(new TextEncoder().encode("123456789")),0xcbf43926);
  assert.throws(()=>setPngPpi(Uint8Array.of(1,2,3),300),/NOT_PNG/);
});
test("PDF: exact A6/A4 media boxes, one page per image, valid xref offsets",async()=>{
  const img=(w,h)=>({gray:new Uint8Array(w*h).fill(255),wPx:w,hPx:h});
  for(const [w,h,pts] of [[105,148,[297.638,419.528]],[210,297,[595.276,841.89]]]){
    const pdf=await buildPdf([{wMm:w,hMm:h,image:img(4,4)},{wMm:w,hMm:h,image:img(4,4)}]),s=Buffer.from(pdf).toString("latin1");
    assert.ok(s.startsWith("%PDF-1.4"));assert.ok(s.trimEnd().endsWith("%%EOF"));
    assert.equal((s.match(/\/Type \/Page /g)||[]).length,2);
    const box=[...s.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)];assert.equal(box.length,2);
    assert.ok(Math.abs(+box[0][1]-pts[0])<0.01&&Math.abs(+box[0][2]-pts[1])<0.01,box[0].join());
    const xs=+s.match(/startxref\n(\d+)/)[1];assert.ok(s.slice(xs).startsWith("xref"));
    const entries=[...s.slice(xs).matchAll(/(\d{10}) 00000 n /g)].map(m=>+m[1]);
    for(const [i,off] of entries.entries())assert.ok(s.slice(off).startsWith(`${i+1} 0 obj`),`obj ${i+1}`);
  }
});
test("generated admin assets are up to date, include Sarabun, logo and OFL licence",()=>{
  assert.equal(readFileSync(new URL("../src/generated/orders-admin-assets.mjs",import.meta.url),"utf8"),generate());
  const a=generate();for(const n of ["sarabun-thai-400-normal.woff2","sarabun-thai-700-normal.woff2","norx-logo.png","OFL-Sarabun.txt","shipping.html","settings.html"])assert.ok(a.includes(`"${n}"`),n);
});
test("official logo asset is byte-identical to assets/logo.png",()=>{
  assert.deepEqual(readFileSync(new URL("../admin-ui/norx-logo.png",import.meta.url)),readFileSync(new URL("../assets/logo.png",import.meta.url)));
});
