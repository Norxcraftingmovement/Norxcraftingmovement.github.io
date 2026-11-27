// Fail closed if the Worker's declared environment, its DB label and the DB's own marker disagree.
export async function environmentGuard(env) {
  const e = env.ENVIRONMENT;
  if (!["staging", "production"].includes(e) || env.ORDERS_DB_LABEL !== e || !env.ORDERS_DB) return false;
  try {
    const row = await env.ORDERS_DB.prepare("SELECT value FROM meta WHERE key='environment'").first();
    return row?.value === e;
  } catch { return false; }
}
