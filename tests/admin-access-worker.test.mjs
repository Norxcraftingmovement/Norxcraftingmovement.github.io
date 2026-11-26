import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{verifiedOwner} from '../src/admin-access-worker.mjs';
const hash=async email=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email))).toString('hex');
const owner='owner@example.com';
const env={MEDIA_ADMIN_ENABLED:'1',MEDIA_ACCESS_AUD:'aud',MEDIA_ADMIN_EMAIL_HASH:await hash(owner)};
const context=(email=owner,aud='aud')=>({access:{aud,getIdentity:async()=>({email})}});
const origin='https://norxcraftingmovement.com';
const req=(path,options={},base=origin)=>new Request(base+path,options);
test('requires trusted runtime context, exact audience, owner hash; fail closed',async()=>{
 assert.equal(await verifiedOwner(context(),env),true);
 assert.equal(await verifiedOwner(context('OWNER@example.com'),env),true);
 for(const ctx of [undefined,{},context('other@example.com'),context(owner,'wrong'),{access:{aud:'aud',getIdentity:async()=>{throw Error('unavailable')}}}])assert.equal(await verifiedOwner(ctx,env),false);
 assert.equal(await verifiedOwner(context(),{...env,MEDIA_ADMIN_ENABLED:'0'}),false);
 assert.equal(await verifiedOwner(context(),{...env,MEDIA_ACCESS_AUD:undefined}),false);
 const forged=req('/admin/events/',{headers:{'CF-Access-Authenticated-User-Email':owner,'CF-Access-Jwt-Assertion':'forged'}});
 assert.equal((await worker.fetch(forged,env,{})).status,403);
});
test('only exact admin routes and production host allowed; no writes without auth',async()=>{
 for(const p of ['/','/media/events/move-kids-2026/poster','/api/events/move-kids-2026/registration','/admin/anything'])assert.equal((await worker.fetch(req(p),env,context())).status,404);
 assert.equal((await worker.fetch(req('/admin/events/',{},'https://norx-admin-access.workers.dev'),env,context())).status,404);
 assert.equal((await worker.fetch(req('/admin/events/registration',{method:'POST',body:'{}'}),env,{})).status,403);
 const r=await worker.fetch(req('/admin/events/'),env,context());
 assert.equal(r.status,200);assert.equal(r.headers.get('X-NORX-Admin-Auth'),'access-context');
 assert.match(await r.text(),/แชร์กิจกรรม/);
 assert.equal((await worker.fetch(req('/admin/media/'),env,context())).status,200);
 assert.equal((await worker.fetch(req('/admin/events/qr'),env,context())).headers.get('content-type'),'image/png');
});
