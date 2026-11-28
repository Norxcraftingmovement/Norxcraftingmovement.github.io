// Opt-in website rehearsal configuration. The original staging/R2 rejection stays unchanged.
import {renderStaging,checkRendered,productionIdentifiers,STAGING_HOST} from './staging-lib.mjs';
export const PRODUCT_BUCKET='norx-product-content-staging';
const files=['wrangler.orders.jsonc','wrangler.orders-public.jsonc'];
export function websiteInputsFromPrivate(admin,pub){
  const host='https://'+STAGING_HOST;
  if(admin.name!=='norx-orders-staging'||pub.name!=='norx-orders-public-staging'||admin.account_id!==pub.account_id||! /^[a-f0-9]{32}$/.test(admin.account_id||''))throw Error('Private staging identity mismatch');
  for(const c of [admin,pub])if(c.vars?.ENVIRONMENT!=='staging'||c.vars?.ORDERS_DB_LABEL!=='staging'||c.workers_dev!==false||c.preview_urls!==false||c.d1_databases?.length!==1||c.d1_databases[0].binding!=='ORDERS_DB'||c.d1_databases[0].database_name!=='norx-orders-staging')throw Error('Private staging boundary mismatch');
  if(admin.d1_databases[0].database_id!==pub.d1_databases[0].database_id||admin.vars.MEDIA_ACCESS_AUD!==pub.vars.MEDIA_ACCESS_AUD||admin.vars.MEDIA_ADMIN_EMAIL_HASH!==pub.vars.MEDIA_ADMIN_EMAIL_HASH||admin.vars.ORDERS_ALLOWED_ORIGIN!==host||pub.vars.ORDERS_PUBLIC_ORIGINS!==host||pub.vars.STAGING_REQUIRE_ACCESS!=='1'||pub.send_email?.length!==1||pub.send_email[0].name!=='EMAIL'||pub.ratelimits?.length!==1||pub.ratelimits[0].name!=='ORDERS_LIMITER')throw Error('Private staging controls mismatch');
  return {accountId:admin.account_id,d1Id:admin.d1_databases[0].database_id,rateLimitNs:String(pub.ratelimits[0].namespace_id),accessAud:admin.vars.MEDIA_ACCESS_AUD,accessOwnerHash:admin.vars.MEDIA_ADMIN_EMAIL_HASH,ownerEmail:pub.send_email[0].destination_address,notifyFrom:pub.vars.NOTIFY_FROM};
}
export function checkWebsiteStaging(configs,expect,prodIds){
  const errors=[],base=structuredClone(configs);
  const accounts=Object.values(base).map(c=>c.account_id);
  if(accounts.some(a=>a!==undefined)&&(!accounts.every(a=>/^[a-f0-9]{32}$/.test(a||'')&&a===accounts[0])))errors.push('All candidate Workers must use the same verified account');
  for(const c of Object.values(base))delete c.account_id;
  for(const name of files){
    const c=base[name];if(!c){errors.push('Missing website Worker config');continue;}
    if(JSON.stringify(c.r2_buckets)!==JSON.stringify([{binding:'PRODUCT_MEDIA',bucket_name:PRODUCT_BUCKET}]))errors.push('Dedicated PRODUCT_MEDIA bucket required');
    if(c.vars?.WEBSITE_MANAGEMENT_ENABLED!=='1')errors.push('Website rehearsal must be explicitly enabled');
    if(c.vars?.ORDERS_ALLOWED_ORIGIN!=='https://'+STAGING_HOST)errors.push('Website origin must be staging');
    if(c.vars?.MEDIA_ACCESS_AUD!==base[files[0]]?.vars.MEDIA_ACCESS_AUD||c.vars?.MEDIA_ADMIN_EMAIL_HASH!==base[files[0]]?.vars.MEDIA_ADMIN_EMAIL_HASH)errors.push('Both Workers must use the same owner Access policy');
    for(const key of ['services','kv_namespaces','durable_objects','queues','dispatch_namespaces','unsafe','assets'])if(key in c)errors.push('Unexpected binding in website Worker');
    delete c.r2_buckets;delete c.vars.WEBSITE_MANAGEMENT_ENABLED;
    if(name===files[1])delete c.vars.ORDERS_ALLOWED_ORIGIN;
  }
  return [...errors,...checkRendered(base,expect,prodIds)];
}
export function renderWebsiteStaging(inputs,root=new URL('../',import.meta.url)){
  if(!/^[a-f0-9]{64}$/.test(inputs.accessOwnerHash||''))throw Error('Verified Access owner hash is required separately from the notification recipient');
  const configs=renderStaging(inputs,root);
  for(const name of files){
    const c=configs[name];c.vars.MEDIA_ADMIN_EMAIL_HASH=inputs.accessOwnerHash;c.vars.WEBSITE_MANAGEMENT_ENABLED='1';c.vars.ORDERS_ALLOWED_ORIGIN='https://'+STAGING_HOST;
    c.r2_buckets=[{binding:'PRODUCT_MEDIA',bucket_name:PRODUCT_BUCKET}];c.main='../'+c.main;
    for(const db of c.d1_databases)if(db.migrations_dir)db.migrations_dir='../'+db.migrations_dir;
  }
  configs['wrangler.staging-storefront.jsonc'].assets.directory='../../dist-staging';
  if(inputs.accountId!==undefined)for(const c of Object.values(configs))c.account_id=inputs.accountId;
  const errors=checkWebsiteStaging(configs,{d1Id:inputs.d1Id,ownerEmail:inputs.ownerEmail},productionIdentifiers(root));
  if(errors.length)throw Error('Website staging configuration rejected: '+errors.join('; '));
  return configs;
}
