import { $, api, el, notice } from "./common.mjs";
import { PRODUCT_THEMES } from "./product-theme-options.mjs";
import { productTemplate } from "./product-template.mjs";
const id=Number(location.pathname.match(/\/products\/(\d+)\/content\/?$/)?.[1]), endpoint="/api/admin/products/"+id+"/content";
let state=null, content=null, busy=false, dirty=false, reviewed="", operation="", fieldId=0;
const uploads=new Map(), images=()=>[content.hero,...content.gallery.flatMap(g=>g.images),...content.lookbook];
const message=e=>e.userMessage||"ทำรายการไม่ได้ ลองอีกครั้ง ข้อมูลที่แก้ยังอยู่";
function clearUploads(){for(const item of uploads.values())URL.revokeObjectURL(item.url);uploads.clear();}
function pruneUploads(){const refs=new Set(images().map(i=>i.src));for(const [ref,item]of uploads)if(!refs.has(ref)){URL.revokeObjectURL(item.url);uploads.delete(ref);}}
function readContent(){return {...content,themeId:$("contentTheme").value,heading:$("contentHeading").value,lead:$("contentLead").value,description:$("contentDescription").value,sizing:{...content.sizing,unit:$("contentUnit").value,notes:$("contentSizeNotes").value.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean)}};}
const fingerprint=()=>JSON.stringify(readContent());
function controls(){
  $("contentFields").disabled=busy||!state||!state.editable;$("previewContent").disabled=busy||!state;$("reloadContent").disabled=busy;
  $("saveContent").disabled=busy||!state||!state.editable||reviewed!==fingerprint();$("saveContent").textContent=busy&&operation==="กำลังบันทึก…"?operation:"บันทึกร่างเนื้อหา";
  $("contentState").textContent=operation||(!state?"กำลังโหลด…":!state.editable?"สินค้าที่เก็บไว้ดูได้อย่างเดียว":dirty?"มีการแก้ไข · ดูพรีวิวล่าสุดก่อนบันทึก":state.hasDraft?"เปิดฉบับร่างที่บันทึกไว้ · หน้าเว็บออนไลน์ยังใช้ฉบับเดิม":"เริ่มจากเนื้อหาหน้าเดิม · ยังไม่มีฉบับร่างที่บันทึก");
}
function changed(){dirty=true;reviewed="";notice($("contentNotice"),"");controls();}
function button(label,fn,disabled=false){const b=el("button","secondary",label);b.type="button";b.disabled=disabled;b.onclick=fn;return b;}
function field(label,value,max,change,{required=false,multiline=false}={}){const box=el("label","f",label),input=el(multiline?"textarea":"input");input.id="contentField"+(++fieldId);box.htmlFor=input.id;input.value=value;input.maxLength=max;input.required=required;if(multiline)input.rows=3;input.oninput=()=>change(input.value);box.append(input);return box;}
function reorder(list,index,delta){[list[index],list[index+delta]]=[list[index+delta],list[index]];changed();renderDynamic();}
function rowActions(list,index,remove){const row=el("div","row content-item-actions");row.setAttribute("role","group");row.setAttribute("aria-label","จัดการรายการที่ "+(index+1));row.append(button("เลื่อนขึ้น",()=>reorder(list,index,-1),index===0),button("เลื่อนลง",()=>reorder(list,index,1),index===list.length-1),button("นำออก",remove));return row;}
function renderHighlights(){const holder=$("contentHighlights");holder.replaceChildren();content.highlights.forEach((h,index)=>{const item=el("div","content-entry");item.append(field("หัวข้อจุดเด่น "+(index+1),h.title,80,v=>h.title=v,{required:true}),field("รายละเอียด",h.body,1000,v=>h.body=v,{multiline:true}),rowActions(content.highlights,index,()=>{content.highlights.splice(index,1);changed();renderDynamic();}));holder.append(item);});$("addHighlight").disabled=content.highlights.length>=8;}
function imageSource(src){return uploads.get(src)?.url||src;}
function photoEditor(photo,remove){
  const entry=el("div","content-photo");if(photo.src){const img=el("img","content-photo-thumb");img.src=imageSource(photo.src);img.alt=photo.alt;entry.append(img);}
  const fields=el("div","content-photo-fields");fields.append(field("คำอธิบายรูปสำหรับผู้ใช้ที่มองไม่เห็นภาพ",photo.alt,300,v=>photo.alt=v,{required:!!photo.src}),field("คำบรรยายใต้ภาพ",photo.caption,300,v=>photo.caption=v));if(photo.src&&remove)fields.append(button("นำรูปออก",remove));entry.append(fields);return entry;
}
function filePicker(label,target,isHero=false){const box=el("label","f",label),input=el("input");input.type="file";input.accept="image/jpeg,image/png,image/webp";input.multiple=!isHero;input.disabled=!state.mediaReady;input.onchange=()=>{const files=[...input.files];input.value="";if(files.length)importFiles(files,target,isHero);};box.append(input);return box;}
function photoList(holder,list){holder.replaceChildren();list.forEach((photo,index)=>{const row=el("div","content-entry");row.dataset.photoIndex=index;row.append(photoEditor(photo),rowActions(list,index,()=>{list.splice(index,1);changed();renderDynamic();}));const options=[...content.gallery.map((g,i)=>({label:g.heading||"กลุ่มภาพ "+(i+1),key:"g:"+i,list:g.images})),{label:"Lookbook",key:"lookbook",list:content.lookbook}].filter(option=>option.list!==list);
    if(options.length){const label=el("label","f","ย้ายภาพไปส่วนอื่น"),select=el("select"),first=el("option","","เลือกส่วนที่จะย้ายไป");first.value="";select.append(first);for(const option of options){const o=el("option","",option.label);o.value=option.key;select.append(o);}select.onchange=()=>{const target=options.find(option=>option.key===select.value)?.list;if(!target)return;if(target.length>=24){notice($("contentError"),"ส่วนปลายทางมีครบ 24 รูปแล้ว",true);select.value="";return;}target.push(...list.splice(index,1));changed();renderDynamic();};label.append(select);row.append(label);}holder.append(row);});holder.append(filePicker("เพิ่มรูปในส่วนนี้",list));}
function renderMedia(){
  $("contentHero").replaceChildren(photoEditor(content.hero,()=>{content.hero={src:"",alt:"",caption:""};changed();renderDynamic();}),filePicker("เลือกหรือเปลี่ยนภาพหลัก",content.hero,true));
  const groups=$("contentGallery");groups.replaceChildren();content.gallery.forEach((group,index)=>{const section=el("section","content-gallery-group"),title=el("h3","product-section-heading","กลุ่มภาพ "+(index+1));section.dataset.groupIndex=index;
    section.append(title,field("ชื่อกลุ่มภาพ",group.heading,80,v=>group.heading=v));const list=el("div");photoList(list,group.images);section.append(list,rowActions(content.gallery,index,()=>{content.gallery.splice(index,1);changed();renderDynamic();}));groups.append(section);
  });photoList($("contentLookbook"),content.lookbook);$("addGallery").disabled=content.gallery.length>=8;
}
function renderSizing(){
  const table=$("contentSizeTable"),head=el("thead"),tr=el("tr"),body=el("tbody");
  content.sizing.headers.forEach((name,index)=>{const th=el("th");th.scope="col";const input=el("input");input.value=name;input.required=true;input.maxLength=40;input.readOnly=index===0;input.setAttribute("aria-label","ชื่อคอลัมน์ "+(index+1));input.oninput=()=>content.sizing.headers[index]=input.value;th.append(input);if(index)th.append(button("ลบคอลัมน์",()=>{content.sizing.headers.splice(index,1);content.sizing.rows.forEach(row=>row.splice(index,1));changed();renderSizing();},content.sizing.headers.length<=2));tr.append(th);});tr.append(el("th","","จัดการแถว"));head.append(tr);
  content.sizing.rows.forEach((row,index)=>{const tr=el("tr");row.forEach((value,column)=>{const cell=el(column?"td":"th");if(!column)cell.scope="row";const input=el("input");input.value=value;input.required=true;input.maxLength=column?20:16;input.setAttribute("aria-label",content.sizing.headers[column]+" แถว "+(index+1));input.oninput=()=>row[column]=input.value;cell.append(input);tr.append(cell);});const actions=el("td");actions.append(button("ลบแถว",()=>{content.sizing.rows.splice(index,1);changed();renderSizing();},content.sizing.rows.length<=1));tr.append(actions);body.append(tr);});table.replaceChildren(head,body);$("addSizeRow").disabled=content.sizing.rows.length>=30;$("addSizeColumn").disabled=content.sizing.headers.length>=6;
}
function renderDynamic(){pruneUploads();renderHighlights();renderMedia();renderSizing();controls();}
function accept(result){clearUploads();state=result;content=structuredClone(result.content);dirty=false;reviewed="";$("contentTheme").value=content.themeId;$("contentHeading").value=content.heading;$("contentLead").value=content.lead;$("contentDescription").value=content.description;$("contentUnit").value=content.sizing.unit;$("contentSizeNotes").value=content.sizing.notes.join("\n\n");$("contentProduct").textContent=state.product.name+" · "+state.product.slug;$("contentMediaState").textContent=state.mediaReady?"รูปใหม่เก็บส่วนตัวพร้อมฉบับร่าง ยังไม่แสดงบนเว็บลูกค้า":"ยังไม่ได้เชื่อมพื้นที่รูปสินค้า · แก้ข้อความ เรียงรูปเดิม และตารางไซส์ได้";renderDynamic();}
async function load(){busy=true;operation="กำลังโหลด…";controls();try{accept(await api(endpoint));notice($("contentError"),"");}catch(e){notice($("contentError"),message(e),true);}finally{busy=false;operation="";controls();}}
async function importFiles(files,target,isHero){
  pruneUploads();notice($("contentError"),"");const prepared=[];busy=true;operation="กำลังเตรียมรูป…";reviewed="";controls();
  try{
    if(uploads.size+files.length>8||[...uploads.values()].reduce((n,x)=>n+x.file.size,0)+files.reduce((n,x)=>n+x.size,0)>12*1024*1024)throw Error("เพิ่มรูปใหม่ได้ครั้งละไม่เกิน 8 รูป รวม 12 MB");
    if(images().filter(i=>i.src).length+files.length-(isHero&&target.src?1:0)>40||(!isHero&&target.length+files.length>24))throw Error("จำนวนรูปมากเกินกำหนด: ทั้งหน้า 40 รูป แต่ละกลุ่ม 24 รูป");
    for(const file of files){if(!["image/jpeg","image/png","image/webp"].includes(file.type)||!file.size||file.size>4194304)throw Error("ใช้ JPG, PNG หรือ WebP รูปละไม่เกิน 4 MB");const url=URL.createObjectURL(file),item={file,url,ref:"upload:"+crypto.randomUUID()};prepared.push(item);const img=new Image();img.src=url;try{await img.decode();}catch{throw Error("เปิดรูปนี้ไม่ได้ กรุณาเลือกรูปใหม่");}if(!img.naturalWidth||img.naturalWidth*img.naturalHeight>40000000)throw Error("รูปใหญ่เกินไป กรุณาย่อให้ไม่เกิน 40 ล้านพิกเซล");}
    for(const item of prepared){uploads.set(item.ref,item);const photo={src:item.ref,alt:"",caption:""};if(isHero)Object.assign(target,photo);else target.push(photo);}changed();renderDynamic();
  }catch(e){for(const item of prepared)URL.revokeObjectURL(item.url);notice($("contentError"),e.message,true);}
  finally{busy=false;operation="";controls();}
}
$("contentForm").addEventListener("input",event=>{if(event.target.type!=="file")changed();});$("contentForm").addEventListener("change",event=>{if(event.target.type!=="file")changed();});
$("addHighlight").onclick=()=>{content.highlights.push({title:"",body:""});changed();renderDynamic();};$("addGallery").onclick=()=>{content.gallery.push({heading:"",images:[]});changed();renderDynamic();};
$("addSizeRow").onclick=()=>{content.sizing.rows.push(content.sizing.headers.map((_,i)=>i?"—":""));changed();renderSizing();};$("addSizeColumn").onclick=()=>{content.sizing.headers.push("");content.sizing.rows.forEach(row=>row.push("—"));changed();renderSizing();};
const viewport=mode=>{$("storeFrame").parentElement.classList.toggle("desktop",mode==="desktop");$("previewPhone").setAttribute("aria-pressed",String(mode!=="desktop"));$("previewDesktop").setAttribute("aria-pressed",String(mode==="desktop"));};
$("previewPhone").onclick=()=>viewport("phone");$("previewDesktop").onclick=()=>viewport("desktop");$("closeStorePreview").onclick=()=>$("storePreview").close();
$("previewContent").onclick=()=>{if(busy||!state||!$("contentForm").reportValidity())return;const snapshot=fingerprint(),source=structuredClone(readContent());for(const photo of [source.hero,...source.gallery.flatMap(g=>g.images),...source.lookbook])photo.src=imageSource(photo.src);source.slug=state.product.slug;source.isContentDraft=true;const product={...state.product,themeId:source.themeId,description:source.description};reviewed="";controls();$("storeFrame").onload=()=>{if(snapshot===fingerprint()){reviewed=snapshot;controls();}};$("storeFrame").srcdoc=productTemplate(product,source.hero.src,source);viewport("phone");$("storePreview").showModal();};
$("contentForm").onsubmit=async event=>{
  event.preventDefault();if(busy||!state?.editable||reviewed!==fingerprint()||!$("contentForm").reportValidity())return;
  const data={expectedRevision:state.revision,content:readContent()};busy=true;operation="กำลังบันทึก…";controls();notice($("contentError"),"");pruneUploads();
  try{let result;if(uploads.size){const form=new FormData();form.set("data",JSON.stringify(data));for(const [ref,item]of uploads)form.set("file:"+ref.slice(7),item.file);const response=await fetch(endpoint,{method:"PUT",body:form,credentials:"same-origin"});result=await response.json();if(!response.ok||result.ok===false){const error=Error("SAVE_FAILED");error.userMessage=result.message;throw error;}}else result=await api(endpoint,{method:"PUT",body:data});accept(result);notice($("contentNotice"),"บันทึกร่างเนื้อหาแล้ว หน้าเว็บที่ออนไลน์ยังไม่เปลี่ยน");}
  catch(e){notice($("contentError"),message(e),true);}finally{busy=false;operation="";controls();}
};
$("reloadContent").onclick=async()=>{if(busy)return;if(dirty){const keep=await new Promise(resolve=>{const d=$("discardContent");$("keepContent").onclick=()=>{d.close();resolve(true);};$("discardContentConfirm").onclick=()=>{d.close();resolve(false);};d.oncancel=event=>{event.preventDefault();d.close();resolve(true);};d.showModal();});if(keep)return;}await load();};
window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});
$("contentTheme").replaceChildren(...PRODUCT_THEMES.map(t=>{const o=el("option","",t.name);o.value=t.id;return o;}));controls();await load();
