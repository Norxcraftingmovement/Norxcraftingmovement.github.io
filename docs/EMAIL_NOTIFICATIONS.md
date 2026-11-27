# Owner notifications via Cloudflare Email Service (D17) — status
## What I could verify
**Nothing from the official pages.** `developers.cloudflare.com` is not reachable from the build environment (direct request: proxy 403; web-fetch helper: host not resolvable). I did not fill the gap from memory. The three pages you listed (overview, send bindings, destination addresses) still need to be read against the code below.
Facts taken from your message (not independently verified): Email Service supports verified destination addresses on Workers Free since 24 Nov 2026; a Workers binding is used to send.

## What is built (and safe to keep either way)
* `makeEmailProvider(env, getRecipient)` in `src/orders-notify.mjs`: active only if `env.EMAIL.send` exists. Needs `env.NOTIFY_FROM` (sender) and the recipient from Admin → Settings (`notifyTo`). Content = the V1 alert text (order no., name/phone, items, total, "check the slip", admin link; no address). Sends header `X-NORX-Idempotency-Key`. Recipient/sender missing → clear failure (visible in Admin), not a crash.
* The **only** line that depends on the Cloudflare API shape is `sendViaBinding(binding, msg)` (`binding.send({to, from, subject, text, headers})`). **To verify against the docs:** method name and argument shape; whether `headers` / a message-id / idempotency key are accepted; the exact error behaviour; whether `from` must be on an onboarded domain (DNS records) and what the Free plan allows; the wrangler binding declaration (not added to any config yet).
* Preference order: native email binding > generic webhook > none (queue holds messages; Admin shows readiness: what is missing).
* Failure log never stores e-mail addresses (redacted). Duplicate-safety: see below.

## Delivery guarantees (tested: `tests/orders-notify-p1.test.mjs`)
At-least-once. If the provider accepts a message but the Worker stops before `SENT` is recorded, the row is reclaimed after 5 minutes as "delivery unconfirmed", retried with the SAME idempotency key and a visible "(อาจเป็นข้อความซ้ำ)" marker. Ambiguous errors (timeout/abort) are treated the same way. Backoff 1m/5m/30m/2h/12h, then dead-letter + manual retry in Admin.

## Not done (needs the owner)
Enabling the service, onboarding a sending domain, DNS records, verifying the destination address, adding the `send_email`/email binding to a wrangler config, any real send.
