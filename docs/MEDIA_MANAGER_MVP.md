# Media Manager MVP — MOVE KIDS
Status: feature branch only. Demo selects/previews local image; no uploads or registrations in preview.
Production configuration is intentionally disabled. No subscription, storage binding, Access policy, or production deployment was created as part of this branch.
## Scope
- Admin /admin/media/; upload PUT /admin/media/poster. Fixed event key only; JPG/PNG/WebP, 4 MiB maximum, signature check; preview shows uncropped image. Explicit replace action.
- Public GET/HEAD /media/events/move-kids-2026/poster; private R2 storage; no public writes or listing; no-store. Event page hides figure if missing.
- Access JWT requires exact issuer, application audience, valid RS256 signature, expiry and configured administrator email. Fail closed; same-origin mutation. Existing shop and registration flags unchanged.
## Activation after owner approval
1. Owner approves R2 subscription (current onboarding shows $0 due now plus additional monthly usage; free allowance/overage subject to billing). Create private dedicated bucket; do not expose public R2 endpoint.
2. Configure Cloudflare Access for /admin/media and /admin/media/* only, restrict to authorized NORX owner email. Confirm shop and public event URLs unaffected. Do not protect the entire site.
3. Bind MEDIA_BUCKET, set MEDIA_ACCESS_ISSUER, MEDIA_ACCESS_AUD, MEDIA_ADMIN_EMAIL and MEDIA_ADMIN_ENABLED=1 in production configuration; keep preview isolated and demo-only. Ensure future automated deploys preserve intended settings.
4. Verify staging and actual auth, unauthorized requests, upload with owner-approved poster, image display on mobile, existing shop and closed registration. Review before production rollout.
5. Record actual production result; no real uploads, R2 integration or Access sign-ins have been verified by unit tests.
