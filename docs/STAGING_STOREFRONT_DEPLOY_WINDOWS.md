# Deploy ONLY `norx-staging-storefront` — Windows PowerShell (owner action)

**Why:** the cloud session deployed the Admin and Public API Workers and set up the D1 database, but the storefront's static-asset upload failed with `401 Unauthorized` (`POST …/workers/assets/upload`). The asset upload needs a real Cloudflare login, so it is done once from the owner's machine. Nothing here touches D1, the other two Workers, Production, Events, Media, Orders V1, DNS, routes or billing.

The committed `wrangler.staging-storefront.jsonc` is already deployable as-is: assets-only, no bindings, `workers_dev:false`, `preview_urls:false`, no routes, no secrets or IDs. No environment variables or rendered `.staging/` files are needed.

Requirements: Git, Node.js 20+ (22 tested), a Cloudflare login for the NORX account (the same account that owns `norx-orders-staging`).

```powershell
# 1. Checkout the staging branch (never the production branch)
git clone https://github.com/Norxcraftingmovement/Norxcraftingmovement.github.io.git norx-staging
cd norx-staging
git fetch origin feature/orders-v2
git checkout feature/orders-v2
git pull --ff-only origin feature/orders-v2
git branch --show-current          # must print: feature/orders-v2
```

```powershell
# 2. Dependencies: the repository has no package.json (the build uses only Node.js built-ins).
#    Wrangler is fetched on demand; pin the version that was tested.
node --version                      # 20 or newer
npx --yes wrangler@4.168.0 --version
```

```powershell
# 3. Build the standalone staging storefront into dist-staging\ (fails if any production reference remains)
node scripts/build-staging-storefront.mjs
# expected: staging storefront built: { rewrites: 5, files: 155 }
```

```powershell
# 4. Configuration check: the committed config must be assets-only with nothing that could reach production
node -e "const c=JSON.parse(require('fs').readFileSync('wrangler.staging-storefront.jsonc','utf8'));const bad=Object.keys(c).filter(k=>!['name','compatibility_date','workers_dev','preview_urls','assets'].includes(k));const ok=c.name==='norx-staging-storefront'&&c.workers_dev===false&&c.preview_urls===false&&bad.length===0&&!('routes' in c)&&!('route' in c);console.log(ok?'CONFIG OK: assets-only, workers_dev=false, preview_urls=false, no routes, no bindings':'CONFIG PROBLEM: '+bad.join(','));process.exit(ok?0:1)"
```

```powershell
# 5. Authenticate (opens a browser; choose the NORX account). Do not use a token that has Zone/DNS/Access rights.
npx wrangler@4.168.0 login
npx wrangler@4.168.0 whoami
```

```powershell
# 6. Dry run: uploads nothing. The output must NOT contain a "bindings" table, any route, or a workers.dev URL.
npx wrangler@4.168.0 deploy --dry-run -c wrangler.staging-storefront.jsonc
```

```powershell
# 7. Deploy ONLY the storefront
npx wrangler@4.168.0 deploy -c wrangler.staging-storefront.jsonc
# expected: "Uploaded norx-staging-storefront", then "No targets deployed" (= no routes, no workers.dev) and a Current Version ID
```

```powershell
# 8. Verify (read-only)
npx wrangler@4.168.0 deployments list --name norx-staging-storefront
```

Do **not** run `wrangler d1 …`, `wrangler deploy` for the other configs, `render-staging-config`, or anything with `--remote` against the database: D1, migrations, marker, seed and the two other Workers are already in place.

## Verification checklist (dashboard, read-only)
Workers & Pages → `norx-staging-storefront` → Settings:
- Domains & Routes: **empty**; workers.dev: **disabled**; Preview URLs: **disabled**.
- Bindings: **none**.

## Report back
Send the Version ID from step 7 and the output of steps 4 and 6 (no secrets are in them). Then continue with `STAGING_RUNBOOK.md` steps 6–9 (below).

## Next steps after the storefront is deployed
1. **Access re-check (owner):** application "staging" covers the whole hostname `staging.norxcraftingmovement.com`; exactly one Allow policy, owner only; AUD matches the one given to the Workers.
2. **DNS (owner):** one record only — type `AAAA`, name `staging`, content `100::`, proxied, TTL Auto.
3. **Routes (owner)**, zone `norxcraftingmovement.com`: `staging.norxcraftingmovement.com/api/orders*` → `norx-orders-public-staging`; `…/api/admin/*` and `…/admin*` → `norx-orders-staging`; `…/*` → `norx-staging-storefront`.
4. **Gate (must pass before anything else):** `node scripts/staging-gate.mjs --base https://staging.norxcraftingmovement.com`
5. **Integration tests** (§4 of the runbook) with the owner session, synthetic data only; record latency and failures in TEST_REPORT.
Rollback if anything looks wrong: remove the routes only (non-destructive, runbook §6).
