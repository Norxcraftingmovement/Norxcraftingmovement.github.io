// Owner check for the Orders Workers (copy of the logic in admin-access-worker.mjs, kept separate on purpose:
// importing that module would bundle the Events/Media admin code into the Orders Workers. A differential test keeps both identical).
// Only Cloudflare-provided invocation identity is trusted, never user-supplied headers. Fails closed on any misconfiguration.
export async function verifiedOwner(ctx, env) {
  try {
    if (env.MEDIA_ADMIN_ENABLED !== "1" || !ctx?.access || ctx.access.aud !== env.MEDIA_ACCESS_AUD || !env.MEDIA_ACCESS_AUD || !/^[a-f0-9]{64}$/.test(env.MEDIA_ADMIN_EMAIL_HASH ?? "")) return false;
    const identity = await ctx.access.getIdentity();
    if (typeof identity?.email !== "string") return false;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity.email.toLowerCase()));
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("") === env.MEDIA_ADMIN_EMAIL_HASH;
  } catch { return false; }
}
