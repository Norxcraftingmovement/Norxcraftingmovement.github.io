import {eventAdminFetch} from "./event-admin-worker.mjs";
import {mediaFetch} from "./media-worker.mjs";

// Only trust Cloudflare-provided invocation identity, never user-supplied headers.
// This Worker must be deployed without Static Assets, which strip ctx.access.
export async function verifiedOwner(ctx,env){
  try{
    if(env.MEDIA_ADMIN_ENABLED!=="1"||!ctx?.access||ctx.access.aud!==env.MEDIA_ACCESS_AUD||!env.MEDIA_ACCESS_AUD||! /^[a-f0-9]{64}$/.test(env.MEDIA_ADMIN_EMAIL_HASH??""))return false;
    const identity=await ctx.access.getIdentity();
    if(typeof identity?.email!=="string")return false;
    const hash=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(identity.email.toLowerCase()));
    return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("")===env.MEDIA_ADMIN_EMAIL_HASH;
  }catch{return false;}
}
const reply=(error,status)=>Response.json({error},{status,headers:{"Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow","X-Content-Type-Options":"nosniff"}});
export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);
    if(u.origin!=="https://norxcraftingmovement.com"||!/^\/admin\/(?:events|media)(?:\/|$)/.test(u.pathname))return reply("NOT_FOUND",404);
    if(!(await verifiedOwner(ctx,env)))return reply("ACCESS_REQUIRED",403);
    const allow=async()=>true; // owner identity verified above by trusted runtime context
    const response=await eventAdminFetch(request,env,allow)??await mediaFetch(request,env,allow);
    if(!response)return reply("NOT_FOUND",404);
    const headers=new Headers(response.headers);
    headers.set("X-NORX-Admin-Auth","access-context");
    return new Response(response.body,{status:response.status,headers});
  }
};
