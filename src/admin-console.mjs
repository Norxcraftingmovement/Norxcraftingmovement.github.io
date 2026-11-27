import { registrationState } from "./event-registration-control.mjs";
export const consolePath = "/admin/events/console";
const origin = "https://norxcraftingmovement.com";
const baseHeaders={"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Cross-Origin-Resource-Policy":"same-origin"};

// The public entry is only a redirect, with no private data. The destination
// is covered by the existing Access-protected /admin/events* route.
export function adminEntry(request) {
  const url=new URL(request.url);
  if(!["/admin","/admin/"].includes(url.pathname))return null;
  if(url.origin!==origin)return Response.json({error:"NOT_FOUND"},{status:404,headers:baseHeaders});
  if(!["GET","HEAD"].includes(request.method))return Response.json({error:"METHOD"},{status:405,headers:baseHeaders});
  return new Response(null,{status:302,headers:{...baseHeaders,Location:origin+consolePath}});
}

// Called only after the private Worker verifies trusted Access identity.
export async function adminConsole(env,method) {
  if(!["GET","HEAD"].includes(method))return Response.json({error:"METHOD"},{status:405,headers:baseHeaders});
  let state="ตรวจสอบไม่ได้",total="—",checked="—";
  try{
    const r=await registrationState(env);
    if(r.canChange||env.EVENTS_REGISTRATION_OPEN==="0"||env.EVENTS_REGISTRATION_OPEN==="1")state=r.open?"เปิดรับสมัคร":"ปิดรับสมัคร";
  }catch{}
  try{
    const counts=await env.EVENTS_DB.prepare("SELECT COUNT(*) AS total, COUNT(c.checked_in_at) AS checked FROM move_kids_roster r LEFT JOIN move_kids_checkins c ON c.reference=r.reference").first();
    if(Number.isSafeInteger(counts?.total)&&counts.total>=0&&Number.isSafeInteger(counts?.checked)&&counts.checked>=0&&counts.checked<=counts.total){total=String(counts.total);checked=String(counts.checked);}
  }catch{}
  const nonce=crypto.randomUUID().replace(/-/g,"");
  const html=`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>NORX | Admin Console</title>
<style nonce="${nonce}">
*{box-sizing:border-box}body{margin:0;background:#f2efe7;color:#1a1a18;font:16px/1.55 system-ui,-apple-system,sans-serif}header{background:#1a1a18;color:#f2efe7;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px max(20px,5vw);flex-wrap:wrap}header strong{letter-spacing:.09em}header a{color:inherit}main{max-width:1100px;margin:auto;padding:40px 20px 64px}h1{font-size:clamp(36px,7vw,68px);line-height:1.1;letter-spacing:-.04em;margin:10px 0 8px}h2{font-size:22px;margin:0 0 12px}h3{font-size:20px;margin:0 0 8px}p{margin:6px 0 16px}.eyebrow{font:700 13px/1.4 system-ui,sans-serif;letter-spacing:.09em;color:#5b5b52}.muted{color:#5b5b52}.event{margin:30px 0 24px;background:#e8e4d9;border:1px solid #cbc7bb;padding:24px}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:18px 0}.metric{background:#fff;padding:15px;min-width:0}.metric small{display:block;color:#515149;font-size:13px}.value{font-size:clamp(20px,4vw,34px);font-weight:800;line-height:1.3;overflow-wrap:anywhere}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.card{background:#fff;border:1px solid #cbc7bb;padding:24px;display:flex;flex-direction:column;align-items:flex-start}.card p{flex:1}.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:12px 18px;text-decoration:none;font-weight:700;background:#b04922;color:#fff;border:1px solid #b04922}.secondary{background:transparent;color:#1a1a18;border-color:#1a1a18}.btn:focus-visible,a:focus-visible{outline:3px solid #b04922;outline-offset:4px}.small{font-size:14px}.note{margin-top:24px;border-top:1px solid #cbc7bb;padding-top:14px}.skip{position:absolute;left:12px;top:-100px;background:#fff;color:#1a1a18;padding:12px}.skip:focus{top:12px}@media(max-width:600px){main{padding:24px 14px 40px}.event,.card{padding:16px}.cards{grid-template-columns:1fr}.metrics{grid-template-columns:1fr 1fr;gap:8px}.metric:first-child{grid-column:1/-1}.btn{width:100%}header{padding:14px;gap:10px}.metric{padding:12px}}
</style></head><body><a class="skip" href="#main">ข้ามไปเนื้อหา</a><header><strong>NORX / ADMIN</strong><a href="/">ดูเว็บไซต์จริง ↗</a></header><main id="main"><p class="eyebrow">NORX : CRAFTING MOVEMENT</p><h1>ADMIN CONSOLE.</h1><p>จัดการกิจกรรมและสื่อของ NORX จากที่เดียว</p><section class="event" aria-labelledby="current"><p class="eyebrow">CURRENT EVENT</p><h2 id="current">MOVE KIDS — 14K</h2><p class="muted">13 ธ.ค. 2569 · Community Trail</p><div class="metrics"><div class="metric"><small>สถานะการรับสมัคร</small><div class="value">${state}</div></div><div class="metric"><small>ผู้สมัครทั้งหมด</small><div class="value">${total}</div></div><div class="metric"><small>เช็กอินแล้ว</small><div class="value">${checked}</div></div></div><a class="btn" href="/admin/events/">จัดการกิจกรรม ↗</a></section><section aria-labelledby="tools"><h2 id="tools">เครื่องมือจัดการ</h2><div class="cards"><article class="card"><p class="eyebrow">01 / EVENTS</p><h3>กิจกรรมและผู้สมัคร</h3><p>เปิด–ปิดรับสมัคร ดูรายชื่อ เช็กอิน ส่งออก CSV และดาวน์โหลด QR Code</p><a class="btn secondary" href="/admin/events/">เปิด Events Manager ↗</a></article><article class="card"><p class="eyebrow">02 / MEDIA</p><h3>โปสเตอร์กิจกรรม</h3><p>อัปโหลด ดูตัวอย่าง และเผยแพร่โปสเตอร์บนหน้ากิจกรรม</p><a class="btn secondary" href="/admin/media/">เปิด Media Manager ↗</a></article></div></section><div class="note muted small">ระบบสั่งเสื้อยังใช้ระบบเดิมแยกต่างหาก · หน้านี้สำหรับเจ้าของ NORX เท่านั้น</div></main></body></html>`;
  return new Response(method==="HEAD"?null:html,{headers:{...baseHeaders,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":`default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`}});
}
