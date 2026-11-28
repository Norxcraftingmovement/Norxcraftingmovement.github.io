import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {renderStaging,checkRendered,productionIdentifiers} from '../scripts/staging-lib.mjs';
import {renderWebsiteStaging,checkWebsiteStaging,websiteInputsFromPrivate,PRODUCT_BUCKET} from '../scripts/website-staging-config.mjs';
const root=new URL('../',import.meta.url),inputs={d1Id:'11111111-2222-4333-8444-555555555555',rateLimitNs:'30000001',accessAud:'a'.repeat(64),accessOwnerHash:'b'.repeat(64),ownerEmail:'owner@example.test',notifyFrom:'alerts@example.test'},expect={d1Id:inputs.d1Id,ownerEmail:inputs.ownerEmail},prod=productionIdentifiers(root); // Synthetic fixture only. preflight-allow
test('website configs add only dedicated private product storage and flags; preserve commerce/notification controls',()=>{
 const old=renderStaging(inputs),next=renderWebsiteStaging(inputs);assert.deepEqual(checkWebsiteStaging(next,expect,prod),[]);
 for(const name of ['wrangler.orders.jsonc','wrangler.orders-public.jsonc']){const c=next[name];assert.deepEqual(c.r2_buckets,[{binding:'PRODUCT_MEDIA',bucket_name:PRODUCT_BUCKET}]);assert.equal(c.vars.WEBSITE_MANAGEMENT_ENABLED,'1');assert.deepEqual(c.d1_databases.map(d=>d.database_id),old[name].d1_databases.map(d=>d.database_id));assert.equal(c.workers_dev,false);assert.equal(c.preview_urls,false);assert.ok(!('routes' in c));}
 assert.equal(next['wrangler.orders.jsonc'].vars.MEDIA_ADMIN_EMAIL_HASH,inputs.accessOwnerHash);assert.notEqual(inputs.accessOwnerHash,old['wrangler.orders.jsonc'].vars.MEDIA_ADMIN_EMAIL_HASH,'login identity is independent of the notification address');
 assert.deepEqual(next['wrangler.orders-public.jsonc'].send_email,old['wrangler.orders-public.jsonc'].send_email);assert.deepEqual(next['wrangler.orders-public.jsonc'].ratelimits,old['wrangler.orders-public.jsonc'].ratelimits);assert.deepEqual(next['wrangler.orders-public.jsonc'].triggers,old['wrangler.orders-public.jsonc'].triggers);
 assert.ok(checkRendered(next,expect,prod).some(s=>s.includes('R2')),'legacy guard must still refuse R2');assert.ok(!('r2_buckets' in old['wrangler.orders.jsonc']));
 const privateConfigs=renderWebsiteStaging({...inputs,accountId:'c'.repeat(32)});assert.deepEqual(checkWebsiteStaging(privateConfigs,expect,prod),[]);privateConfigs['wrangler.staging-storefront.jsonc'].account_id='d'.repeat(32);assert.ok(checkWebsiteStaging(privateConfigs,expect,prod).length);
});
test('candidate paths resolve to current checkout assets/source/migrations from nested private output',()=>{
 const next=renderWebsiteStaging(inputs),dir=fileURLToPath(new URL('.staging/website/',root));
 assert.equal(resolve(dir,next['wrangler.orders.jsonc'].main),fileURLToPath(new URL('src/orders-admin-worker.mjs',root)));assert.equal(resolve(dir,next['wrangler.orders.jsonc'].d1_databases[0].migrations_dir),fileURLToPath(new URL('migrations/orders',root)));assert.equal(resolve(dir,next['wrangler.staging-storefront.jsonc'].assets.directory),fileURLToPath(new URL('dist-staging',root)));
});
test('website guard refuses foreign storage, additional bindings, weakened access/origin, routes and production DB',()=>{
 for(const mutate of [c=>c['wrangler.orders.jsonc'].r2_buckets[0].bucket_name='norx-event-media',c=>c['wrangler.orders-public.jsonc'].services=[{binding:'OTHER',service:'other'}],c=>c['wrangler.orders-public.jsonc'].vars.STAGING_REQUIRE_ACCESS='0',c=>c['wrangler.orders-public.jsonc'].vars.ORDERS_ALLOWED_ORIGIN='https://evil.test',c=>c['wrangler.orders.jsonc'].routes=['*'],c=>c['wrangler.orders.jsonc'].d1_databases[0].database_name='norx-orders',c=>c['wrangler.orders-public.jsonc'].vars.MEDIA_ACCESS_AUD='b'.repeat(64),c=>c['wrangler.orders.jsonc'].workers_dev=true]){const c=renderWebsiteStaging(inputs);mutate(c);assert.ok(checkWebsiteStaging(c,expect,prod).length);}
});
test('private-input handoff refuses disagreement or production labels before constructing configs',()=>{
 const configs=renderStaging(inputs),a=configs['wrangler.orders.jsonc'],p=configs['wrangler.orders-public.jsonc'];a.account_id=p.account_id='c'.repeat(32);assert.equal(websiteInputsFromPrivate(a,p).d1Id,inputs.d1Id);
 for(const mutate of [(a,p)=>p.account_id='d'.repeat(32),(a,p)=>a.d1_databases[0].database_name='norx-orders',(a,p)=>p.vars.ORDERS_DB_LABEL='production',(a,p)=>p.vars.MEDIA_ADMIN_EMAIL_HASH='e'.repeat(64),(a,p)=>p.vars.STAGING_REQUIRE_ACCESS='0']){const x=structuredClone(a),y=structuredClone(p);mutate(x,y);assert.throws(()=>websiteInputsFromPrivate(x,y));}
});
