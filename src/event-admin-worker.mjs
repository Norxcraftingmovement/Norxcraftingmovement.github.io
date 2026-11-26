import { registrationState,setRegistrationState,publicEventURL } from "./event-registration-control.mjs";
import { qrPNG,qrSize,qrTarget } from "./move-kids-qr.mjs";
import {authorized} from "./media-worker.mjs";
const origin="https://norxcraftingmovement.com";
const preview="https://feature-event-manager-norx-crafting-movement.norx-craftingmovement.workers.dev";
const root="/admin/events/";
const routes=new Set([root.slice(0,-1), root, root+"roster", root+"checkin", root+"export", root+"registration", root+"qr"]);
const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","X-Robots-Tag":"noindex, nofollow","Referrer-Policy":"no-referrer","Cross-Origin-Resource-Policy":"same-origin"};
const reply=(data,status=200)=>Response.json(data,{status,headers});
const columns=["reference","created_at","full_name","nickname","age","phone","emergency_name","emergency_phone","emergency_relationship","experience","media_consent","checked_in_at"];
const select="SELECT "+columns.slice(0,-1).map(x=>"r."+x).join(", ")+", c.checked_in_at FROM move_kids_roster r LEFT JOIN move_kids_checkins c ON c.reference=r.reference";
const order=" ORDER BY r.created_at DESC, r.reference DESC";
const escapeLike=s=>s.replace(/[\\%_]/g,c=>"\\"+c);
const csvCell=value=>{
  let s=String(value??"");
  // Guard against spreadsheet formula injection, including leading whitespace.
  if(/^[\s\u0000-\u001f]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
};
function qrResponse(url){
  if(qrTarget!==publicEventURL)return reply({error:"QR_TARGET"},503);
  const bytes=Uint8Array.from(atob(qrPNG),c=>c.charCodeAt(0));
  return new Response(bytes,{headers:{...headers,"Content-Type":"image/png","Content-Disposition":(url.searchParams.get("download")==="1"?"attachment":"inline")+'; filename="NORX-MOVE-KIDS-2026-QR.png"'}});
}
function dashboard(demo=false) {
  const nonce=crypto.randomUUID().replace(/-/g,"");
  return new Response(`<!doctype html><html lang="th"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>NORX | Events Manager</title>
<style nonce="${nonce}">*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f2f0e9;color:#171815}header{background:#171815;color:#fff;padding:18px max(20px,5vw);display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;letter-spacing:.06em;font-weight:800}header a{color:#fff;font-size:14px}main{max-width:1100px;margin:auto;padding:30px 20px 60px}h1{font-size:clamp(36px,7vw,64px);line-height:1;letter-spacing:-.04em;margin:12px 0}h2{font-size:22px;margin:0 0 10px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.14em;color:#65665e}.muted{color:#5a5c54;font-size:14px}.notice{border-left:4px solid #ad592d;background:#fae9dc;padding:12px}.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}.metric{padding:16px;background:white;border:1px solid #ccccc4;min-width:0}.number{font-size:clamp(25px,5vw,42px);font-weight:800;line-height:1.1;overflow-wrap:anywhere}.panel{background:#fff;border:1px solid #ccccc4;padding:20px;margin:18px 0}.row{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap}.btn,button{display:inline-block;min-height:44px;padding:11px 15px;border:1px solid #252820;background:#252820;color:#fff;text-decoration:none;font:inherit;font-weight:700;cursor:pointer}.secondary{background:#fff;color:#252820}button:disabled{opacity:.5;cursor:not-allowed}input{min-height:46px;padding:12px;border:1px solid #aaa;background:#fff;font:inherit;min-width:0;flex:1}a{color:inherit}form{display:flex;gap:8px;flex-wrap:wrap}ul{padding:0;margin:16px 0;list-style:none}.participant{border-top:1px solid #ddded5;padding:14px 0;overflow-wrap:anywhere}.tag{background:#e5eadb;color:#354126;padding:4px 8px;font-size:12px;font-weight:700;display:inline-block}.tag.pending{background:#eeeae1;color:#59574e}.name{font-weight:800;font-size:18px;margin:2px 0}details{margin:9px 0}summary{cursor:pointer;font-weight:700}dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 12px;font-size:14px;margin:10px 0}dd{margin:0;min-width:0}.pager{padding-top:12px;border-top:1px solid #ddd}.error{color:#9c3324}button:focus-visible,a:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #ad592d;outline-offset:3px}@media(max-width:550px){main{padding:20px 14px 45px}.summary{gap:7px}.metric{padding:11px 8px}.panel{padding:14px}.metric .muted{font-size:12px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:8px}form input{width:100%;flex-basis:100%}}.control{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.btn.open{background:#3e5b2c;border-color:#3e5b2c}.btn.close{background:#8c3427;border-color:#8c3427}.share-layout{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:20px;align-items:start}.share-url{width:100%;display:block;overflow-wrap:anywhere;margin:9px 0;padding:12px;border:1px solid #aaa;background:#f6f5f0;word-break:break-all}.qr{width:180px;max-width:100%;height:auto;display:block;border:1px solid #ccc;margin:auto}.share-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}@media(max-width:550px){.share-layout{grid-template-columns:1fr}.qr{margin:0 auto}}</style>
<header><span>NORX / ADMIN</span><a href="/admin/media/">MEDIA MANAGER ↗</a></header>
<main><p class="eyebrow">EVENTS / OPERATIONS</p><h1>EVENTS.</h1><p>จัดการกิจกรรมและผู้เข้าร่วม</p>
${demo?'<p class="notice">โหมดทดสอบ — ข้อมูลสมมติเท่านั้น การเช็กอินเปลี่ยนเฉพาะในหน้าจอนี้ ไม่บันทึกข้อมูลจริง</p>':''}
<section class="panel"><div class="row"><div><p class="eyebrow">CURRENT EVENT</p><h2>MOVE KIDS — 14K</h2><span class="muted">13 ธ.ค. 2569 · Community Trail</span></div><div class="row"><a class="btn secondary" href="/events/move-kids-2026/">ดูหน้างาน ↗</a><a class="btn secondary" href="/admin/media/">จัดการโปสเตอร์</a></div></div>
<div class="summary"><div class="metric"><p class="muted">รับสมัคร</p><div class="number" id="registration">—</div></div><div class="metric"><p class="muted">ผู้สมัครทั้งหมด</p><div class="number" id="total">—</div></div><div class="metric"><p class="muted">เช็กอินแล้ว</p><div class="number" id="checked">—</div></div></div><div class="control"><button type="button" id="toggle-registration" class="btn" disabled>กำลังตรวจสอบสถานะ…</button><span class="muted" id="registration-hint">เปิดหรือปิดรับสมัครโดยตรงจากหลังบ้าน</span></div><p id="registration-feedback" role="status" class="muted"></p></section>
<section class="panel"><h2>แชร์กิจกรรม</h2><div class="share-layout"><div><p class="muted">ลิงก์เดียวสำหรับ Facebook, แชท และ QR — เปิดดูรายละเอียดได้แม้ปิดรับสมัคร</p><input class="share-url" id="share-url" aria-label="ลิงก์กิจกรรม" readonly value="${publicEventURL}"><div class="share-actions"><button class="btn" type="button" id="copy-link">คัดลอกลิงก์</button><button class="btn secondary" type="button" id="share-link">แชร์ลิงก์</button><a class="btn secondary" href="${root}qr?download=1" download="NORX-MOVE-KIDS-2026-QR.png">ดาวน์โหลด QR PNG</a></div><p id="share-feedback" role="status" class="muted"></p></div><div><img class="qr" src="${root}qr" width="${qrSize}" height="${qrSize}" alt="QR code สำหรับเปิดหน้ากิจกรรม MOVE KIDS"><p class="muted">ไฟล์ PNG 984 × 984 px</p></div></div></section>
<section class="panel"><div class="row"><h2>รายชื่อผู้สมัคร</h2><button id="export" class="secondary" ${demo?'disabled':''}>ดาวน์โหลด CSV</button></div><form id="searchform"><input id="search" type="search" maxlength="100" aria-label="ค้นหาผู้สมัคร" placeholder="ค้นหาชื่อ / ชื่อเล่น / เลขอ้างอิง / เบอร์โทร"><button type="submit">ค้นหา</button><button type="button" class="secondary" id="clear">ล้าง</button></form>
<p id="status" role="status" aria-live="polite" class="muted">กำลังโหลด...</p><ul id="list"></ul><div class="row pager"><button class="secondary" id="prev" disabled>ก่อนหน้า</button><span id="page" class="muted"></span><button class="secondary" id="next" disabled>ถัดไป</button></div></section><p class="muted">ข้อมูลผู้สมัครเป็นข้อมูลส่วนบุคคล — ใช้เพื่อจัดกิจกรรมเท่านั้น ห้ามเผยแพร่ต่อ</p></main>
<script nonce="${nonce}">
const demo=${demo}, root='${root}', $=id=>document.getElementById(id);
let cursor=0,query='',busy=false,registrationOpen=false,canChange=false;
const mock=[{reference:'MK-TEST000001',full_name:'ตัวอย่าง ผู้สมัคร A',nickname:'QA A',age:30,phone:'0000000000',emergency_name:'ผู้ติดต่อสมมติ',emergency_phone:'0000000001',emergency_relationship:'เพื่อน',experience:'new',media_consent:0,created_at:'2026-11-26 12:00:00',checked_in_at:null},{reference:'MK-TEST000002',full_name:'ตัวอย่าง ผู้สมัคร B',nickname:'QA B',age:35,phone:'0000000002',emergency_name:'ผู้ติดต่อสมมติ',emergency_phone:'0000000003',emergency_relationship:'ครอบครัว',experience:'regular',media_consent:1,created_at:'2026-11-26 12:05:00',checked_in_at:'2026-11-26 12:06:00'}];
function element(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
function displayDate(value){if(!value)return '—';const d=new Date(value.replace(' ','T')+'Z');return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat('th-TH',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}).format(d)}
function item(row){const li=element('li',undefined,'participant'), line=element('div',undefined,'row'), left=element('div');left.append(element('div',row.reference,'eyebrow'),element('p',row.full_name+' · '+row.nickname,'name'),element('span',row.checked_in_at?'เช็กอินแล้ว':'ยังไม่เช็กอิน',row.checked_in_at?'tag':'tag pending')); const btn=element('button',row.checked_in_at?'ยกเลิกเช็กอิน':'เช็กอิน',row.checked_in_at?'secondary':'');btn.type='button';btn.onclick=()=>change(row);line.append(left,btn);const detail=element('details'), dl=element('dl');detail.append(element('summary','ข้อมูลติดต่อ / ความยินยอม')); const exp={new:'มือใหม่',some:'เคยวิ่งเทรล',regular:'วิ่งเทรลเป็นประจำ'};for(const [label,value] of [['อายุ',row.age],['โทรศัพท์',row.phone],['ผู้ติดต่อฉุกเฉิน',row.emergency_name],['เบอร์ฉุกเฉิน',row.emergency_phone],['ความสัมพันธ์',row.emergency_relationship],['ประสบการณ์',exp[row.experience]||row.experience],['ยินยอมถ่ายภาพ',row.media_consent===1?'ยินยอม':'ไม่ยินยอม'],['สมัครเมื่อ',displayDate(row.created_at)],['เช็กอินเมื่อ',displayDate(row.checked_in_at)]])dl.append(element('dt',label),element('dd',String(value??'—')));detail.append(dl);li.append(line,detail);return li}
async function load(){if(busy)return;busy=true;$('status').textContent='กำลังโหลด…';$('prev').disabled=$('next').disabled=true;try{let data;if(demo){const filtered=mock.filter(x=>!query||[x.full_name,x.nickname,x.reference,x.phone].join(' ').toLowerCase().includes(query.toLowerCase()));data={open:registrationOpen,canChange:true,total:mock.length,checked:mock.filter(x=>x.checked_in_at).length,matched:filtered.length,rows:filtered,offset:0}}else{const r=await fetch(root+'roster',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({q:query,offset:cursor}),cache:'no-store'});if(!r.ok)throw Error('load');data=await r.json()}registrationOpen=data.open;canChange=data.canChange===true;$('registration').textContent=data.open?'เปิด':'ปิด';updateToggle();$('total').textContent=data.total;$('checked').textContent=data.checked;$('list').replaceChildren(...data.rows.map(item));$('status').textContent=data.matched===0?(query?'ไม่พบรายชื่อที่ค้นหา':'ยังไม่มีผู้สมัคร'):('พบ '+data.matched+' รายชื่อ');$('page').textContent=data.matched?((data.offset+1)+'–'+(data.offset+data.rows.length)+' จาก '+data.matched):'0 รายชื่อ';$('prev').disabled=data.offset===0;$('next').disabled=data.offset+data.rows.length>=data.matched}catch{canChange=false;updateToggle();$('list').replaceChildren();$('status').textContent='โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่ หรือล็อกอินอีกครั้ง'}finally{busy=false}}
async function change(row){if(busy||!confirm((row.checked_in_at?'ยกเลิกเช็กอิน ':'ยืนยันเช็กอิน ')+row.reference+' ?'))return;busy=true;try{if(demo){row.checked_in_at=row.checked_in_at?null:new Date().toISOString().slice(0,19).replace('T',' ')}else{const r=await fetch(root+'checkin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:row.reference,checked:!row.checked_in_at})});if(!r.ok)throw Error('update')}}catch{$('status').textContent='บันทึกไม่สำเร็จ — ลองกดค้นหาอีกครั้ง';busy=false;return}busy=false;await load()}
function updateToggle(){
 const b=$('toggle-registration');b.disabled=!canChange;
 b.textContent=canChange?(registrationOpen?'ปิดรับสมัคร':'เปิดรับสมัคร'):'ยังไม่พร้อมเปลี่ยนสถานะ';
 b.className='btn '+(registrationOpen?'close':'open');
 $('registration-hint').textContent=demo?'ทดลองเปิด–ปิดในหน้านี้เท่านั้น':(canChange?'กดยืนยันเพื่อเปลี่ยนสถานะทันที':'ตรวจสอบระบบก่อนเปิดหรือปิดรับสมัคร');
}
$('toggle-registration').onclick=async()=>{
 if(!canChange||busy)return;
 const next=!registrationOpen;
 if(!confirm(demo?'ทดลองเปลี่ยนสถานะในหน้าตัวอย่างเท่านั้น?':next?'ยืนยันเปิดรับสมัคร MOVE KIDS บนเว็บจริง? คนทั่วไปจะสามารถส่งฟอร์มได้ทันที':'ยืนยันปิดรับสมัคร MOVE KIDS? ลิงก์กิจกรรมยังเปิดได้ แต่จะส่งฟอร์มไม่ได้'))return;
 busy=true;$('toggle-registration').disabled=true;$('registration-feedback').textContent='กำลังบันทึก...';
 try{
  if(demo){registrationOpen=next}
  else{const r=await fetch(root+'registration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({open:next,expectedOpen:registrationOpen})});if(!r.ok)throw Error('state');const data=await r.json();registrationOpen=data.open;}
  $('registration-feedback').textContent=(demo?'(ทดลอง) ':'')+(registrationOpen?'เปิดรับสมัครแล้ว':'ปิดรับสมัครแล้ว');
 }catch{$('registration-feedback').textContent='ไม่สามารถยืนยันสถานะได้ กำลังโหลดค่าล่าสุด…'}
 finally{busy=false;await load()}
};
async function copyLink(){
 const field=$('share-url'),link=field.value;
 try{await navigator.clipboard.writeText(link);$('share-feedback').textContent='คัดลอกลิงก์แล้ว'}
 catch{field.focus();field.select();$('share-feedback').textContent='เลือกลิงก์ไว้แล้ว กดคัดลอก (Ctrl+C / Cmd+C)'}
}
$('copy-link').onclick=copyLink;
$('share-link').onclick=async()=>{
 if(navigator.share){try{await navigator.share({title:'MOVE KIDS — NORX',url:$('share-url').value});$('share-feedback').textContent='เปิดเมนูแชร์แล้ว'}catch(e){if(e.name!=='AbortError')await copyLink()}}
 else await copyLink();
};
$('searchform').onsubmit=e=>{e.preventDefault();query=$('search').value.trim();cursor=0;load()};$('clear').onclick=()=>{$('search').value='';query='';cursor=0;load()};$('prev').onclick=()=>{cursor=Math.max(0,cursor-50);load()};$('next').onclick=()=>{cursor+=50;load()};$('export').onclick=()=>{if(!demo&&confirm('ดาวน์โหลดรายชื่อผู้สมัครที่มีข้อมูลส่วนบุคคลเพื่อใช้จัดงานเท่านั้น?'))location.href=root+'export'};load();
</script></html>`,{headers:{...headers,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`}})
}
async function jsonInput(request){
  if(request.headers.get("Origin")!==origin)return {error:reply({error:"ORIGIN"},403)};
  if(request.headers.get("Content-Type")?.split(";")[0].trim()!=="application/json")return {error:reply({error:"INVALID"},415)};
  if(!request.body)return {error:reply({error:"INVALID"},400)};
  const reader=request.body.getReader(),decoder=new TextDecoder();let raw="",size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024){await reader.cancel();return {error:reply({error:"INVALID"},413)}}raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode();
  try{return {data:JSON.parse(raw)}}catch{return {error:reply({error:"INVALID"},400)}}
}
export async function eventAdminFetch(request,env,verify=authorized){
  const u=new URL(request.url);
  if(!routes.has(u.pathname))return null;
  if(u.origin===preview&&env.EVENT_ADMIN_DEMO==="1"){
    return request.method==="GET"?(u.pathname===root?dashboard(true):u.pathname===root+"qr"?qrResponse(u):reply({error:"NOT_FOUND"},404)):reply({error:"NOT_FOUND"},404);
  }
  if(u.origin!==origin||!(await verify(request,env)))return reply({error:"ACCESS_REQUIRED"},403);
  if(u.pathname===root.slice(0,-1)&&request.method==="GET")return Response.redirect(origin+root,302);
  if(u.pathname===root&&request.method==="GET")return dashboard();
  if(u.pathname===root+"qr"&&request.method==="GET")return qrResponse(u);
  if(!env.EVENTS_DB)return reply({error:"UNAVAILABLE"},503);
  const db=env.EVENTS_DB;
  try{
    if(u.pathname===root+"roster"&&request.method==="POST"){
      const input=await jsonInput(request);if(input.error)return input.error;
      const data=input.data;
      if(!data||typeof data!=="object"||Object.keys(data).length!==2||typeof data.q!=="string"||data.q.length>100||!Number.isInteger(data.offset)||data.offset<0||data.offset>999999||data.offset%50!==0)return reply({error:"INVALID"},400);
      const q=data.q.trim(),offset=data.offset;
      const totals=await db.prepare("SELECT COUNT(*) AS total, COUNT(c.checked_in_at) AS checked FROM move_kids_roster r LEFT JOIN move_kids_checkins c ON c.reference=r.reference").first();
      let where="", args=[];
      if(q){const value="%"+escapeLike(q)+"%";where=" WHERE (r.full_name LIKE ?1 ESCAPE '\\' OR r.nickname LIKE ?1 ESCAPE '\\' OR r.reference LIKE ?1 ESCAPE '\\' OR r.phone LIKE ?1 ESCAPE '\\')";args=[value];}
      const countSQL="SELECT COUNT(*) AS matched FROM move_kids_roster r"+where;
      const matched=(await (args.length?db.prepare(countSQL).bind(...args):db.prepare(countSQL)).first()).matched;
      const rows=await db.prepare(select+where+order+" LIMIT 50 OFFSET ?"+(args.length+1)).bind(...args,offset).all();
      const state=await registrationState(env);
      return reply({...state,total:totals.total,checked:totals.checked,matched,offset,rows:rows.results});
    }
    if(u.pathname===root+"registration"&&request.method==="POST"){
      const input=await jsonInput(request);if(input.error)return input.error;const data=input.data;
      if(!data||typeof data!=="object"||Object.keys(data).length!==2||typeof data.open!=="boolean"||typeof data.expectedOpen!=="boolean")return reply({error:"INVALID"},400);
      const result=await setRegistrationState(env,data.open,data.expectedOpen);
      return reply(result,result.ok?200:result.error==="DISABLED"?403:result.error==="STALE_STATE"?409:503);
    }
    if(u.pathname===root+"export"&&request.method==="GET"){
      const data=await db.prepare(select+order+" LIMIT 5001").all();
      if(data.results.length>5000)return reply({error:"EXPORT_LIMIT"},413);
      const csv="\ufeff"+columns.map(csvCell).join(",")+"\r\n"+data.results.map(row=>columns.map(k=>csvCell(row[k])).join(",")).join("\r\n");
      return new Response(csv,{headers:{...headers,"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="norx-move-kids-roster.csv"'}});
    }
    if(u.pathname===root+"checkin"&&request.method==="POST"){
      const input=await jsonInput(request);if(input.error)return input.error;const data=input.data;
      if(!data||typeof data!=="object"||Object.keys(data).length!==2||typeof data.checked!=="boolean"||typeof data.reference!=="string"||!/^MK-[A-F0-9]{12}$/.test(data.reference))return reply({error:"INVALID"},400);
      const known=await db.prepare("SELECT reference FROM move_kids_registrations WHERE reference=?1").bind(data.reference).first();
      if(!known)return reply({error:"NOT_FOUND"},404);
      await db.prepare("INSERT INTO move_kids_checkins (reference,checked_in_at,updated_at) VALUES (?1,CASE WHEN ?2=1 THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP) ON CONFLICT(reference) DO UPDATE SET checked_in_at=CASE WHEN ?2=1 THEN COALESCE(move_kids_checkins.checked_in_at,CURRENT_TIMESTAMP) ELSE NULL END,updated_at=CURRENT_TIMESTAMP").bind(data.reference,data.checked?1:0).run();
      return reply({ok:true});
    }
    return reply({error:"METHOD"},405);
  }catch{return reply({error:"UNAVAILABLE"},503)}
}
