// Local synthetic rehearsal only. Call with a fresh context/server; never use deployed customer data.
export async function checkProductMedia(page, base = "http://127.0.0.1:8790") {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error("Local simulation only");
  const passed=[],errors=[],must=(v,m)=>{if(!v)throw Error(m);},pass=m=>passed.push(m);
  page.on("pageerror",e=>errors.push(e.message));
  const publicBefore=await (await page.request.get(base+"/api/orders")).json();
  await page.setViewportSize({width:390,height:844});await page.goto(base+"/admin/products/");
  await page.locator("#productName").fill("NORX — พรีวิวเทมเพลต");await page.locator("#productSlug").fill("cover-ui-test");await page.locator("#priceShort").fill("490");await page.locator("#productSizes").fill("S, M, L");
  const literal='<img src=x onerror=alert(1)> ทดสอบส่วนตัว ใช้ภาพรุ่นเดิมตรวจเทมเพลต';await page.locator("#productDescription").fill(literal);
  must(await page.locator("#saveDraft").isDisabled(),"Save enabled before preview");pass("save requires preview of current values");
  const photo=await (await page.request.get(base+"/assets/hero.jpg")).body();
  await page.locator("#productCover").setInputFiles({name:"fixture.jpg",mimeType:"image/jpeg",buffer:photo});
  await page.waitForFunction(()=>!document.getElementById('coverThumb').hidden);
  const review=async()=>{await page.locator("#showProductPreview").click();await page.waitForFunction(()=>!document.getElementById('saveDraft').disabled);};
  await review();const frame=page.locator("#storeFrame").contentFrame();
  await frame.locator(".hero-image img").evaluate(img=>img.decode());must(await frame.locator(".preview-description").innerText()===literal,"Literal text changed");must(await frame.locator("script").count()===0,"Preview has runtime");
  must(await frame.locator(".hero-image img").evaluate(img=>img.naturalWidth)>0,"Cover did not load");
  await page.locator("#previewDesktop").click();must(await page.locator("#storeFrame").evaluate(e=>e.clientWidth)===1200,"Desktop preview width incorrect");await page.locator("#previewPhone").click();pass("isolated phone/desktop preview renders selected photo and literal text");
  await page.locator("#closeStorePreview").click();await page.locator("#productName").fill("NORX — ตรวจหน้าก่อนบันทึก");must(await page.locator("#saveDraft").isDisabled(),"Stale preview allowed save");await review();await page.locator("#closeStorePreview").click();pass("any edit invalidates the previous preview");
  await page.locator("#saveDraft").click();await page.locator("#notice").getByText("บันทึกฉบับร่างแล้ว ยังไม่เปิดขาย",{exact:true}).waitFor();
  let product=(await (await page.request.get(base+"/api/admin/products")).json()).products.find(p=>p.slug==='cover-ui-test');must(product?.coverUrl,"Cover not persisted");must((await page.request.get(base+product.coverUrl)).ok(),"Saved cover unavailable");
  const firstCover=product.coverUrl;await page.locator("#reloadProducts").click();await page.waitForFunction(()=>document.getElementById('coverThumb').getAttribute('src')?.startsWith('/api/admin/'));
  must(JSON.stringify((await (await page.request.get(base+"/api/orders")).json()).products)===JSON.stringify(publicBefore.products),"Public products changed");pass("image survives reload and remains outside public catalog");
  await page.locator("#productCover").setInputFiles({name:"replacement.jpg",mimeType:"image/jpeg",buffer:photo});await page.waitForFunction(()=>document.getElementById('coverThumb').src.startsWith('blob:'));
  await review();await page.locator("#closeStorePreview").click();
  await page.route('**/api/admin/products/'+product.id,route=>route.request().method()==='PUT'?route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'SERVER_ERROR'})}):route.continue());
  await page.locator("#saveDraft").click();await page.locator("#productError").waitFor({state:'visible'});must(await page.locator("#coverThumb").getAttribute('src').then(s=>s.startsWith('blob:')),"Failed upload lost selection");
  await page.unroute('**/api/admin/products/'+product.id);const saved=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/products/'+product.id));await page.locator("#saveDraft").click();must((await saved).ok(),"Retry failed");await page.waitForLoadState('networkidle');pass("upload failure preserves selection; retry succeeds");
  product=(await (await page.request.get(base+"/api/admin/products")).json()).products.find(p=>p.id===product.id);must(product.coverUrl!==firstCover,"Replacement reused mutable URL");must((await page.request.get(base+firstCover)).status()===404,"Old image URL still visible");pass("replacement revokes old image URL");
  await page.locator("#removeCover").click();await review();await page.locator("#closeStorePreview").click();await page.locator("#saveDraft").click();await page.waitForLoadState('networkidle');
  must((await page.request.get(base+product.coverUrl)).status()===404,"Removed image accessible");pass("remove and save revokes cover access");
  for(const width of [320,390,820,1440]){await page.setViewportSize({width,height:900});must(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Overflow at '+width);}
  must(errors.length===0,errors.join(';'));pass("four responsive widths and no JavaScript exceptions");return {passed:passed.length,checks:passed};
}
