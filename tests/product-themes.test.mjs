import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupV1 } from "./helpers/orders-env.mjs";
import { saveDraft, listProducts } from "../src/product-drafts.mjs";
import { productThemeSources } from "../scripts/product-theme-sources.mjs";
import { productTemplate } from "../admin-ui/product-template.mjs";
import { assets } from "../src/generated/orders-admin-assets.mjs";
const draft = extra => ({slug:"theme-test",name:"Theme test",fit:"boxy",fitName:"Boxy",prices:{short:490},sizes:["S","M"],...extra});
test("known products default to their own theme; theme choice is independent of fit",async()=>{
  const {env}=await setupV1(), catalog=await listProducts(env);
  assert.equal(catalog.products.find(p=>p.slug==='drop03').themeId,'home-terrain-v1');assert.equal(catalog.products.find(p=>p.slug==='drop02').themeId,'woven-stride-v1');
  const p=await saveDraft(env,'test',draft({themeId:'woven-stride-v1'}));assert.equal(p.themeId,'woven-stride-v1');assert.equal(p.fit,'boxy');
  const next=await saveDraft(env,'test',draft({expectedRevision:p.revision,fit:'regular'}),p.id);assert.equal(next.themeId,'woven-stride-v1');
  const dark=await saveDraft(env,'test',draft({expectedRevision:next.revision,themeId:'home-terrain-v1',fit:'regular'}),p.id);assert.equal(dark.themeId,'home-terrain-v1');assert.equal(dark.fit,'regular');
});
test("unsupported themes reject before writes and theme setting rolls back with product audit",async()=>{
  const {env,sqlite,hooks}=await setupV1();await assert.rejects(saveDraft(env,'test',draft({themeId:'custom-css'})),/เลือกธีม/);
  const p=await saveDraft(env,'test',draft({themeId:'woven-stride-v1'}));
  hooks.onStatement=sql=>{if(sql.startsWith('INSERT INTO settings(key,value)'))throw Error('theme storage failure');};
  await assert.rejects(saveDraft(env,'test',draft({expectedRevision:p.revision,name:'Must rollback',themeId:'home-terrain-v1'}),p.id),/theme storage failure/);
  const kept=(await listProducts(env)).products.find(x=>x.id===p.id);assert.equal(kept.name,p.name);assert.equal(kept.revision,p.revision);assert.equal(kept.themeId,p.themeId);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity='products'").get().n,1);
});
test("concurrent theme edits cannot leave product/audit/theme from different revisions",async()=>{
  const {env}=await setupV1(),p=await saveDraft(env,'test',draft());
  const results=await Promise.allSettled(['home-terrain-v1','woven-stride-v1'].map(themeId=>saveDraft(env,'test',draft({expectedRevision:p.revision,name:themeId,themeId}),p.id)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const current=(await listProducts(env)).products.find(x=>x.id===p.id);assert.equal(current.name,current.themeId);
});
test("all source style blocks and paper body class are represented in generated preview assets",()=>{
  const sources=productThemeSources();for(const [index,page]of ['home-terrain','woven-stride'].entries()){
    const html=readFileSync(new URL('../'+page+'/index.html',import.meta.url),'utf8'),styles=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]);
    const id=index?'woven-stride-v1':'home-terrain-v1';assert.equal(styles.length,2);assert.ok(assets['product-theme-'+id+'.css'].text.startsWith(styles.join('\n')));assert.equal(sources.themes[id].styleBlocks,2);
  }
  const paper=productTemplate(draft({themeId:'woven-stride-v1'}));assert.ok(paper.includes('draft-storefront theme-paper'));assert.ok(paper.includes('product-theme-woven-stride-v1.css'));
  assert.ok(!productTemplate(draft({themeId:'evil" onload="bad'})).includes('onload='));
});
test("fixtures retain per-product gallery groups, lookbook and exact different sizing columns",()=>{
  const {fixtures,images}=productThemeSources();assert.deepEqual(fixtures.drop03.sizing.headers,['ไซส์','อก','ยาว','แขนสั้น','แขนยาว']);assert.equal(fixtures.drop03.sizing.rows.length,6);
  assert.equal(fixtures.drop03.gallery[0].images.length,5);assert.equal(fixtures.drop03.lookbook.length,9);assert.equal(images.length,9);
  assert.deepEqual(fixtures.drop02.gallery.map(g=>g.heading),['แขนสั้น','แขนยาว','เนื้อผ้า']);assert.deepEqual(fixtures.drop02.sizing.headers,['ไซส์','อก','ยาว']);assert.equal(fixtures.drop02.sizing.rows.length,11);
  for(const f of Object.values(fixtures)){
    const html=productTemplate(draft({slug:f.slug,themeId:f.themeId}),'',f);assert.ok(html.includes('scope="row"'));assert.ok(html.includes('aria-label="ตารางไซส์สินค้า"'));assert.ok(!html.includes('<script'));assert.ok(!html.includes('script.google'));assert.ok(!html.includes('data:image/'));
    for(const image of [f.hero,...f.gallery.flatMap(g=>g.images),...f.lookbook])assert.ok(html.includes(image.src));
  }
});
test("fixture content cannot leak into another product or allow arbitrary image paths",()=>{
  const f=productThemeSources().fixtures.drop02;
  const other=productTemplate(draft({slug:'another-product',themeId:'woven-stride-v1'}),'',f);assert.ok(!other.includes(f.hero.src));assert.ok(!other.includes('Air Square'));
  for(const url of ['javascript:alert(1)','/assets/../private/image.jpg','//external.test/photo.jpg','data:image/svg+xml,bad'])assert.ok(!productTemplate(draft(),url).includes('src="'+url));
});
