import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorized,mediaFetch} from '../src/media-worker.mjs';
const domain='https://norxcraftingmovement.com', admin='/admin/media/', upload=admin+'poster', image='/media/events/move-kids-2026/poster';
const preview='https://feature-media-manager-norx-crafting-movement.norx-craftingmovement.workers.dev';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kvZkAAAAASUVORK5CYII=','base64');
const req=(path,init={},host=domain)=>new Request(host+path,init);
const permit=async()=>true, deny=async()=>false;
function storage(){
 const map=new Map();
 return {map,async put(key,body,meta){map.set(key,{body,size:body.length,httpMetadata:meta.httpMetadata})},async get(key){return map.get(key)}};
}
function send(body=png,type='image/png',origin=domain){return req(upload,{method:'PUT',headers:{'Content-Type':type,Origin:origin},body});}
test('JWT requires valid signature, issuer, audience, time, email, and enabled flag',async()=>{
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='test-key';
 const env={MEDIA_ADMIN_ENABLED:'1',MEDIA_ACCESS_ISSUER:'https://test-team.cloudflareaccess.com',MEDIA_ACCESS_AUD:'test-aud',MEDIA_ADMIN_EMAIL:'owner@example.com'};
 const fetchKeys=async url=>{assert.equal(url,env.MEDIA_ACCESS_ISSUER+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]})};
 const claims={iss:env.MEDIA_ACCESS_ISSUER,aud:['test-aud'],email:'owner@example.com',exp:Math.floor(Date.now()/1000)+60};
 const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 async function token(overrides={},forged=false){
  const content=enc({alg:'RS256',kid:'test-key'})+'.'+enc({...claims,...overrides});
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(content));
  return content+'.'+(forged?Buffer.alloc(256):Buffer.from(signature)).toString('base64url');
 }
 const check=async(t,e=env)=>authorized(req(admin,{headers:{'CF-Access-Jwt-Assertion':t}}),e,fetchKeys);
 assert.equal(await check(await token()),true);
 for(const data of [{aud:['wrong']},{iss:'https://fake.cloudflareaccess.com'},{email:'other@example.com'},{exp:0},{nbf:Math.floor(Date.now()/1000)+100}])assert.equal(await check(await token(data)),false);
 assert.equal(await check(await token({},true)),false);
 assert.equal(await check(await token(),{...env,MEDIA_ADMIN_ENABLED:'0'}),false);
 assert.equal(await authorized(req(admin),env,fetchKeys),false);
});
test('admin inaccessible without verified login; unrelated routes untouched',async()=>{
 assert.equal((await mediaFetch(req(admin),{},deny)).status,403);
 assert.equal((await mediaFetch(send(),{MEDIA_BUCKET:storage()},deny)).status,403);
 assert.equal(await mediaFetch(req('/cart/'),{},deny),null);
 assert.equal((await mediaFetch(req(admin,{},'https://another.example'),{},permit)).status,403);
});
test('demo is read-only; preview cannot upload even with authorization',async()=>{
 const env={MEDIA_DEMO:'1',MEDIA_BUCKET:storage()};
 const page=await mediaFetch(req(admin,{},preview),env,deny);
 assert.equal(page.status,200);assert.match(await page.text(),/โหมดตัวอย่าง/);
 const request=req(upload,{method:'PUT',headers:{Origin:preview,'Content-Type':'image/png'},body:png},preview);
 assert.equal((await mediaFetch(request,env,permit)).status,404);
 assert.equal(env.MEDIA_BUCKET.map.size,0);
});
test('private upload validates origin, format, signatures, actual byte length',async()=>{
 const env={MEDIA_BUCKET:storage()};
 assert.equal((await mediaFetch(send(png,'image/png','https://other.example'),env,permit)).status,403);
 assert.equal((await mediaFetch(send('<svg/>','image/svg+xml'),env,permit)).status,415);
 assert.equal((await mediaFetch(send('not an image'),env,permit)).status,415);
 assert.equal((await mediaFetch(send(new Uint8Array(4*1024*1024+1)),env,permit)).status,413);
 assert.equal(env.MEDIA_BUCKET.map.size,0);
});
test('authorized upload and public GET/HEAD; no cache; missing storage fails closed',async()=>{
 const env={MEDIA_BUCKET:storage()};
 assert.equal((await mediaFetch(req(image),env)).status,404);
 assert.equal((await mediaFetch(send(),env,permit)).status,200);
 assert.equal(env.MEDIA_BUCKET.map.size,1);
 const r=await mediaFetch(req(image),env);
 assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');
 assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);
 const h=await mediaFetch(req(image,{method:'HEAD'}),env);assert.equal(h.status,200);assert.equal(await h.text(),'');
 assert.equal((await mediaFetch(req(image,{method:'PUT'}),env)).status,405);
 assert.equal((await mediaFetch(send(),{},permit)).status,503);
 assert.equal((await mediaFetch(req(image),{})).status,404);
});
