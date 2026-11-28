// Local synthetic-only theme rehearsal. Inspect screenshots separately; this is developer-reported.
export async function checkProductThemes(page, base="http://127.0.0.1:8790", capture=null) {
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error("Local simulation only");
  const checks=[],errors=[],must=(v,m)=>{if(!v)throw Error(m);},pass=m=>checks.push(m);page.on('pageerror',e=>errors.push(e.message));
  const publicBefore=JSON.stringify((await(await page.request.get(base+'/api/orders')).json()).products);
  await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/admin/products/');
  for(const [name,id,color,count,columns,rows]of [['HOME TERRAIN','home-terrain-v1','rgb(25, 25, 25)',5,5,6],['WOVEN STRIDE','woven-stride-v1','rgb(255, 255, 255)',9,3,11]]){
    await page.locator('#productList button').filter({hasText:name}).click();await page.locator('#showProductPreview').click();const frame=page.locator('#storeFrame').contentFrame();await frame.locator('body').waitFor();
    must(await frame.locator('body').getAttribute('data-theme')===id,'Wrong theme for '+name);must(await frame.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor)===color,'Wrong background for '+name);
    must(await frame.locator('#photos > .gallery img').count()===count,'Gallery count for '+name);must(await frame.locator('thead th').count()===columns&&await frame.locator('tbody tr').count()===rows,'Size chart for '+name);
    must(await page.locator('#saveDraft').isDisabled()&&await page.locator('#productTheme').isDisabled(),'Active product became editable');
    if(id==='home-terrain-v1'){await frame.locator('.lookbook summary').click();must(await frame.locator('.preview-lookbook img').count()===9,'Missing lookbook');await frame.locator('.lookbook summary').click();}
    const broken=await frame.locator('img').evaluateAll(async images=>{for(const img of images)img.loading='eager';return(await Promise.all(images.map(async img=>{try{await img.decode();return '';}catch{return img.getAttribute('src');}}))).filter(Boolean);});must(!broken.length,'Broken fixture images: '+broken.join(','));
    for(const width of [320,390,820,1440]){await page.setViewportSize({width,height:1000});for(const mode of ['Phone','Desktop']){await page.locator('#preview'+mode).click();must(await frame.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),'Frame overflow '+id+' '+width+' '+mode);must(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Admin overflow');}await page.locator('#previewPhone').click();}
    if(capture){await page.setViewportSize({width:1440,height:1000});await page.locator('#previewDesktop').click();await frame.locator('html').evaluate(()=>scrollTo(0,0));await page.screenshot({path:capture+'/'+id+'-preview-desktop.png'});await page.setViewportSize({width:390,height:844});await page.locator('#previewPhone').click();await frame.locator('html').evaluate(()=>scrollTo(0,0));await page.screenshot({path:capture+'/'+id+'-preview-phone.png'});}
    await page.locator('#closeStorePreview').click();pass(name+': own colors, images, sizing, read-only state, and four widths in both preview modes');
  }
  await page.locator('#newDraft').click();await page.locator('#productName').fill('THEME — LOCAL TEST');await page.locator('#productSlug').fill('theme-ui-test');await page.locator('#priceShort').fill('490');await page.locator('#productSizes').fill('S, M');await page.locator('#productTheme').selectOption('woven-stride-v1');
  const review=async()=>{await page.locator('#showProductPreview').click();await page.waitForFunction(()=>!document.getElementById('saveDraft').disabled);await page.locator('#closeStorePreview').click();};
  await review();await page.locator('#saveDraft').click();await page.locator('#notice').getByText('บันทึกฉบับร่างแล้ว ยังไม่เปิดขาย',{exact:true}).waitFor();
  await page.locator('#reloadProducts').click();await page.waitForFunction(()=>document.getElementById('productTheme').value==='woven-stride-v1');must(await page.locator('#productFit').inputValue()==='boxy','Theme changed fit');pass('paper theme saves and reloads independently of Boxy fit');
  await review();await page.locator('#productTheme').selectOption('home-terrain-v1');must(await page.locator('#saveDraft').isDisabled(),'Theme change did not invalidate preview');
  must(await page.locator('#priceShort').inputValue()==='490'&&await page.locator('#productSizes').inputValue()==='S, M','Theme changed price or sizes');await review();pass('theme change requires fresh preview and keeps commerce fields');
  await page.locator('#productFit').selectOption('regular');must(await page.locator('#productTheme').inputValue()==='home-terrain-v1','Fit silently chose theme');await review();await page.locator('#saveDraft').click();await page.waitForLoadState('networkidle');pass('Regular fit can keep dark/orange theme');
  const api=await(await page.request.get(base+'/api/admin/products')).json(),product=api.products.find(p=>p.slug==='theme-ui-test');
  const data={};for(const k of ['slug','name','fit','fitName','prices','sizes','description','shortName','collectionId'])data[k]=product[k];data.expectedRevision=product.revision;data.themeId='unsupported-theme';
  const rejected=await page.request.put(base+'/api/admin/products/'+product.id,{headers:{Origin:base},data});must(rejected.status()===400,'Unsupported theme accepted');pass('server rejects unsupported theme');
  must(JSON.stringify((await(await page.request.get(base+'/api/orders')).json()).products)===publicBefore,'Public catalog changed');pass('public products and existing prices unchanged');must(!errors.length,errors.join(';'));pass('no JavaScript exceptions');
  return {passed:checks.length,checks};
}
