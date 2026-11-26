# Dedicated Access Worker — staged
Cloudflare documents Static Assets router dropping ctx.access. New Worker norx-admin-access uses native ctx.access and exact Access audience plus owner email digest; no fallback or client header trust. Host and paths restricted. Initially no custom route; existing storefront remains untouched.
Deployment: branch feature/admin-access-worker, deploy command npx wrangler deploy --config wrangler.admin.jsonc, preview builds disabled. Verify worker build and exact QR route before routing remaining admin paths. Roll back route if context is unavailable. Long-term unify build branches after live verification.
Local QA: 28 / 28 passed. No production registrations submitted.
