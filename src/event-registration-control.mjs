export const slug="move-kids-2026";
export const publicEventURL="https://norxcraftingmovement.com/events/"+slug+"/";
// The Worker flag is a hard emergency switch: "0" closes and prevents owner
// writes; "admin" delegates to the D1 record. "1" preserves legacy fixed mode.
export async function registrationState(env){
  if(env.EVENTS_REGISTRATION_OPEN==="0")return {open:false,canChange:false};
  if(env.EVENTS_REGISTRATION_OPEN==="1")return {open:true,canChange:false};
  if(env.EVENTS_REGISTRATION_OPEN!=="admin"||!env.EVENTS_DB)return {open:false,canChange:false};
  const row=await env.EVENTS_DB.prepare("SELECT registration_open FROM event_registration_control WHERE slug=?1").bind(slug).first();
  if(!row||![0,1].includes(row.registration_open))throw Error("Control missing");
  return {open:row.registration_open===1,canChange:true};
}
export async function setRegistrationState(env,open,expectedOpen){
  if(env.EVENTS_REGISTRATION_OPEN!=="admin"||!env.EVENTS_DB)return {error:"DISABLED"};
  if(open&&!env.REGISTRATION_LIMITER)return {error:"UNAVAILABLE"};
  if(open)await env.EVENTS_DB.prepare("SELECT 1 FROM move_kids_registrations LIMIT 1").first();
  await env.EVENTS_DB.prepare("UPDATE event_registration_control SET registration_open=?1,updated_at=CURRENT_TIMESTAMP WHERE slug=?2 AND registration_open=?3").bind(open?1:0,slug,expectedOpen?1:0).run();
  const state=await registrationState(env);
  if(state.open!==open)return {error:"STALE_STATE",...state};
  return {ok:true,...state};
}
