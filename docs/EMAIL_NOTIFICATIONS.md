# Owner notifications — Cloudflare Email Service (D17: decided)
## API (verified by the project reviewer against the official pages; I could not open them from the build environment)
`developers.cloudflare.com/email-service/api/send-emails/workers-api/`, `…/configuration/send-bindings/`, `…/configuration/destination-addresses/`, `…/reference/headers/`.
```js
const result = await env.EMAIL.send({ from, to, subject, text });   // result.messageId
```
Wrangler: a `send_email` binding named `EMAIL`, **restricted to the single verified owner recipient** (`destination_address`). `wrangler deploy --dry-run` (v4.168.0) accepted this exact shape and lists it as a "Send Email" binding bound to that address. As of 24 Nov 2026 (reviewer-verified): Workers Free can send to **verified destination addresses**, free; arbitrary recipients need Workers Paid — **not used**.
Configuration stays out of the repo: committed configs hold `REPLACE_*`; the owner address, sender and ids come from environment variables when `scripts/render-staging-config.mjs` writes the git-ignored `.staging/` files. The recipient shown in Admin Settings must be the verified address (the binding itself enforces it).

## What the code does (`src/orders-notify.mjs`, tests `tests/orders-notify.test.mjs`)
* Active only if `env.EMAIL.send` exists, plus `NOTIFY_FROM` and a recipient; otherwise the queue holds messages and Admin shows exactly what is missing. Nothing is sent from tests (mock binding) or from this repo.
* Content = the V1 owner alert (order no., name/phone, items, total, "check the slip", admin link; **no address**). Only `{from,to,subject,text}` are sent — **no custom headers are invented**.
* The provider's `messageId` is stored. **`sent` means "accepted by the provider", never "delivered to the inbox".** `delivery_confirmed_at` stays NULL unless the owner confirms (button) or a future provider event does; the admin list shows the difference.
* **We do not assume the provider de-duplicates or honours an idempotency key.** A reference line (`norx-notification-<id>`) is printed in the body so a human can recognise a duplicate, and a retry after an ambiguous outcome is marked "(อาจเป็นข้อความซ้ำ)".

## Retry policy (final)
| Outcome | Rule |
|---|---|
| Definite refusal (normal failure) | backoff 1 m / 5 m / 30 m / 2 h / 12 h; at most **5** provider calls in total; then `dead` |
| **Ambiguous** (TimeoutError/AbortError, 5xx from the webhook fallback, or the Worker stopped after calling the provider) | the message may already be out → **at most ONE further automatic attempt, whatever its own outcome** (flagged possible duplicate). If that attempt is accepted → `sent`; if it fails (ambiguous **or** refused) → `unconfirmed`, **no more automatic attempts**. An ambiguous outcome on the last budgeted attempt is `unconfirmed`, not `dead` |
| Before the first ambiguous outcome | definite refusals still count toward the 5-call budget |
| Owner actions | "send again" (resets counters, keeps history) · "mark as received" (sets `delivery_confirmed_at`) |
Verified by a **model-based test**: all 243 outcome sequences (ambiguous / refused / success × 5) are run through the real dispatcher and compared with an independently written specification; invariants asserted for every sequence: ≤ 5 provider calls, ≤ 1 call after the first ambiguous outcome, `dead` only when nothing was ambiguous, no automatic attempt after a terminal state, every failed attempt present in the audit history. (An earlier policy let "ambiguous, then four refusals" make five calls — fixed.)
**Races:** claim, stale-lock recovery and every outcome write are compare-and-set on `lock_token`; 8 concurrent recoverers record one outcome (one failure row, one event); a slow worker finishing after its row was recovered cannot overwrite it (logged as `late_accept_after_reclaim`).
**Audit & PII:** `notification_failures` (kind, code, fixed text) and `notification_events` are append-only. Raw provider errors are never stored: only a validated code (`E_REFUSED`, `TimeoutError`, `http_503`, …) or `unknown`; e-mail addresses, phone numbers and names are never written (tested by dumping every notification table).

## Not done (needs the owner / approval)
Enabling the service, verifying the destination address, onboarding a sending domain / DNS, any real send, any paid plan.

## Admin channel status (2026-11-27)
The Public Worker's existing one-minute cron writes a sanitized configuration report to the existing `settings` table (`notification_channel_report`): schema version, environment, channel mode, sender-configured boolean and check time. No sender/recipient address, URL, token or provider error is stored in that report. No schema migration, new binding or Admin send privilege is required.

Admin combines the report with the CURRENT recipient setting. Missing, malformed, mismatched-environment, future-dated or older-than-five-minute reports are not ready. The pulse token changes when the report changes or expires, so the page updates without requiring a new order. The page says configuration is complete, while explicitly stating that delivery to the recipient is not yet confirmed.

Report persistence failure logs fixed text and leaves the existing notification dispatcher running. Queue claiming, retry limits, ambiguity handling and delivery confirmation rules are unchanged. Tests use mocks only.

Staging rollout requires BOTH updated Workers: deploy Public first, wait for its cron report, then Admin (with regenerated browser assets). Validate the authenticated Admin status and actual owner-delivered email separately. This code change does not enable Email Service, verify destinations, configure DNS or authorize a real send. A rollback can restore the prior Workers; the extra settings row is inert for older code and need not be deleted.
