import { $,api,el,notice } from './common.mjs';
export function productPublication({endpoint,accept,setBusy}){
  let state=null,blocked=true,proof=null,ready=false;
  const reset=()=>{proof=null;ready=false;$('productPublishCheck').checked=false;$('productPublishConfirm').disabled=true;$('productPublicationConfirm').hidden=true;$('storePreviewHeading').textContent='พรีวิวร่างเนื้อหา';};
  const unlock=()=>{$('productPublishConfirm').disabled=blocked||!proof||!ready||!$('productPublishCheck').checked;};
  $('storePreview').addEventListener('close',reset);$('productPublishCheck').onchange=unlock;
  async function review(targetId=''){
    if(blocked||!state?.publishEnabled)return;reset();const instance=crypto.randomUUID();
    try{
      blocked=true;setBusy(true);buttons();const result=await api(endpoint+'/review',{method:'POST',body:{expectedRevision:state.revision,expectedPublishedId:state.published?.id||'',targetId}});
      proof=result.proof;$('storePreviewHeading').textContent='ตรวจฉบับก่อนยืนยัน';$('productPublicationConfirm').hidden=false;$('productPublishLabel').textContent=(targetId?'ยืนยันย้อนคืนฉบับนี้ในระบบทดสอบ':'ยืนยันใช้ฉบับนี้ในระบบทดสอบ')+' · ตรวจรูป ข้อความ และตารางไซส์แล้ว';
      $('productPublishConfirm').textContent=targetId?'ย้อนคืนฉบับที่ตรวจแล้ว':'ใช้ฉบับที่ตรวจแล้ว';
      $('storeFrame').onload=()=>{if($('storeFrame').contentDocument?.documentElement.dataset.publicationInstance===instance){ready=true;unlock();}};
      $('storeFrame').srcdoc=result.html.replace('<html lang="th">','<html lang="th" data-publication-instance="'+instance+'">');
      $('storePreview').showModal();
    }catch(e){reset();notice($('contentError'),e.userMessage||'เปิดพรีวิวไม่ได้ กรุณาโหลดฉบับล่าสุด',true);}
    finally{blocked=false;setBusy(false);buttons();unlock();}
  }
  function buttons(){
    $('reviewProductPublication').disabled=blocked||!state?.publishEnabled||!state?.hasDraft;
    for(const b of $('productPublicationHistory').querySelectorAll('button'))b.disabled=blocked||!state?.publishEnabled;
  }
  $('reviewProductPublication').onclick=()=>review();
  $('productPublishConfirm').onclick=async()=>{
    if(blocked||!proof||!ready||!$('productPublishCheck').checked)return;
    blocked=true;setBusy(true);buttons();unlock();
    try{const result=await api(endpoint+'/publish',{method:'POST',body:{proof}});$('storePreview').close();accept(result);notice($('contentNotice'),'เปลี่ยนฉบับในระบบทดสอบแล้ว เว็บออนไลน์จริงยังไม่เปลี่ยน');}
    catch(e){reset();notice($('contentError'),e.userMessage||'ยืนยันไม่ได้ กรุณาโหลดแล้วดูพรีวิวใหม่',true);}
    finally{blocked=false;setBusy(false);buttons();unlock();}
  };
  return {reset,update(next,disabled){state=next;blocked=disabled;
    $('productPublishedState').textContent=!state?'กำลังโหลด…':!state.publishEnabled?'ยังไม่เปิดเผยแพร่สินค้านี้ในระบบนี้':state.published?'มีฉบับใช้งานในระบบทดสอบ · ร่างที่บันทึกใหม่ยังไม่เผยแพร่':'ยังใช้หน้ารุ่นเดิมในระบบทดสอบ';
    const link=$('openPublishedProduct');link.hidden=!state?.published||!state?.publishEnabled;link.href=state?'/api/site/products/'+encodeURIComponent(state.product.slug):'#';
    const list=$('productPublicationHistory');list.replaceChildren();
    for(const snapshot of state?.history||[]){const li=el('li'),text=el('span','',snapshot.title+' · '+new Date(snapshot.at).toLocaleString('th-TH')+(snapshot.id===state.published?.id?' · กำลังใช้อยู่':'')),button=el('button','secondary','ดูก่อนย้อนคืน');button.type='button';button.onclick=()=>review(snapshot.id);li.append(text,button);list.append(li);}
    buttons();unlock();
  }};
}
