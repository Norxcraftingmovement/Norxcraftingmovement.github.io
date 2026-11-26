# NORX Official Website — Infrastructure & Events Roadmap
Updated: 2026-11-26 (Asia/Bangkok)

## Objective
Move the existing public website to Cloudflare without disrupting apparel preorder, then develop a reusable event registration system using a transactional SQL database. Keep GitHub as the source of truth. Google Sheets continues to be the existing order record until a controlled migration; it may later serve as a reporting/export tool.

## Baseline and guardrails
- Production GitHub Pages: https://norxcraftingmovement.github.io/
- Verified main at preparation: `0a8edb7a6745f4c3dbcc8ccdc09ea2e8fe2f55ee` (homepage redesign released).
- Domain: `norxcraftingmovement.com` (registration reported by owner; Cloudflare account/domain control not independently verified in this session).
- No changes to existing order records, Apps Script, cart, product pages, or homepage design in phase 1.
- No paid plan/subscription, production DNS cutover, database migration, or real test order without owner approval.
- Public static site assets only in Cloudflare build. Source files, secrets, private participant/customer data must never be served as assets; use private backend bindings and access-controlled admin/export.
- Keep GitHub Pages running as fallback until new production deployment and order flow are independently verified. Separate browser storage by origin means existing carts will not automatically transfer to the new domain.

## Sequential phases and gates

| Phase | Task | Status / acceptance |
|---|---|---|
| 0 | Homepage and domain | Homepage verified deployed; domain registered per owner, account verification pending. |
| 1 | Parallel Cloudflare hosting | IN PROGRESS: branch `feature/cloudflare-migration` prepares unchanged static assets; local build byte comparison PASS, 34 files. Connect GitHub to Workers, deploy test workers.dev URL and verify same content, nested routes, fonts, images, live API GET, cart flow with synthetic data, no real submission. |
| 2 | Custom domain | Pending phase 1 gate. Verify DNS/TLS, apex and www redirect preference, CORS/API behavior, metadata, and old URL availability; choose a safe cutover window with owner. Do not switch during active preorder without explicit approval. |
| 3 | Events Hub | Pending phase 2 gate. Build `/events/`, event detail route, upcoming/past states; preserve styling and shop; no fictitious event info, no unauthorized sponsor mark. |
| 4 | Event Registration (D1 + Workers) | Pending event requirements and data handling approval. Test schema, capacity and duplicate request handling, atomic writes, authentication for staff, rate limiting, input validation, privacy/retention, backups, export, and concurrency with dummy data. Keep event database separate from existing orders. |
| 5 | Supersports first event | Pending confirmed event brief, partner approval and operational safety requirements. Confirm participant type, capacity, fees, schedule, place, emergency data and consent as applicable; publish and enable registration only after validation. |
| 6 | Event operations | Pending phase 5. Staff-only roster, check-in, search, export and no-network fallback appropriate to actual event. |
| 7 | Apparel database migration | After preorder closes and phase 4 proves stable. Preserve IDs, totals and status; back up Sheets, map/reconcile test migration, establish rollback and owner-approved cutover. Never dual-write without a reconciliation design. |

## Phase 1 Cloudflare build configuration
- Worker name: `norx-crafting-movement`
- Git repository: `Norxcraftingmovement/Norxcraftingmovement.github.io`
- Initial deployment branch: `feature/cloudflare-migration` (not main)
- Root directory: repository root
- Build command: `node scripts/build-cloudflare.mjs`
- Deploy command: `npx wrangler deploy`
- Output: `dist/`, configured by `wrangler.jsonc`. No API Worker or database binding yet.
- Cloudflare Git integration may require owner authentication and permission to the specific repository. Use least-privilege repository selection; no account credentials or tokens in Git.
- Test on the assigned workers.dev URL, not custom domain. Record deployment ID, final URL and test evidence in this document before progressing.

## Official references
- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/
- https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/d1/
- https://developers.cloudflare.com/d1/worker-api/d1-database/
