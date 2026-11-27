# Payments — dynamic PromptPay QR (Phase 1) and the road to automation

## 1. Review of the existing architecture → smallest compatible change
What already existed and is reused unchanged: server-side pricing (the order total in D1 is the only source of the amount), `payments` (one confirmed payment per order, void on undo), `changeStatus` (owner-only, optimistic concurrency, amount must equal the total), V1 receipt contract, `settings` table, public/admin Worker split, audit log.
Added (additive): `payment_requests` (what the customer is asked to pay), `payment_events` (append-only), five columns on `payments` (`request_id, provider, bank_txn_ref, verified_at, verified_by`), a customer capability token on the order (`orders.tracking_token_hash`, already in the schema), one settings key (`payment`), two public GET routes, an optional `payment` field on the receipt, one JS panel. **No existing behaviour changes when PromptPay is not configured and verified** — the receipt, checkout and admin flows stay exactly as before (tested).

## 2. What a PromptPay QR is — and is not (design constraints)
* The standard PromptPay credit-transfer QR (EMV tag 29, AID `A000000677010111`) identifies the payee by **mobile number, national ID, tax ID or e-wallet ID registered with PromptPay**, plus an optional amount. **A bank account number cannot be encoded.** The system rejects account-number-shaped input (tested) and the settings page says so.
* This QR type **does not carry an order reference** and **the bank does not call us back**. We therefore: (a) tie the QR to the saved order in our own database (`payment_requests.order_id`), (b) show the order number to the customer, (c) keep **manual verification**: the owner matches the bank statement (amount, time, optionally the bank transaction reference) and confirms.
* **Generating, viewing, downloading a QR, or (future) uploading a slip never marks an order paid.** Only the owner's confirmation (or, later, an explicitly enabled reconciliation policy) does. Tested: the order and `payments` are byte-identical before/after QR views.
* The payload is checked structurally (TLV, tag order, CRC-16/CCITT-FALSE against the standard vector and an independent implementation) and the rendered QR was decoded back with an independent decoder (jsQR) in a real browser. **It still has not been scanned by a banking app**: before the first real use the owner must scan the preview QR (1.00 THB) in a banking app, read the payee name, and NOT confirm the transfer.

## 3. Flow (Phase 1)
1. Owner: Admin → Settings → PromptPay: type (mobile / national ID / tax ID / e-wallet), ID, payee name → **saved = unverified**. Scan the 1.00 THB preview QR with a banking app, read the payee name (do not transfer), type that name in "confirm" → **verified**. Any later change to ID, type or name **un-verifies** (QR disabled until re-verified). The ID is stored only in D1, shown masked everywhere, never committed, never in audit rows.
2. Customer submits an order (unchanged V1 contract). If PromptPay is verified, the server, after the order is saved: creates the `payment_request` (amount = saved total incl. shipping, payload stored for audit, deadline = round payment deadline) and returns an extra `payment` block with `reference` (= order number), `amount`, `deadline`, `payeeName`, `qrUrl`, `downloadUrl`, `payUrl`, `apiUrl`. The checkout panel shows QR, order number, amount, payee name, deadline, PNG/SVG download, the bank-transfer fallback, and the notice that verification is manual.
3. Customer access = order number + random 128-bit token (stored hashed). Wrong token and unknown order give the same 404. After the deadline, or once the order is paid / cancelled / on-site, **no QR is served**. A retried submit (same requestId) revokes the old token and issues a new one (one request per order).
4. Owner confirms payment in Orders (amount must equal the total; optional **bank transaction reference**). The payment row links to the request, provider and reference; the request becomes `verified`. Undo returns it to `awaiting` and voids the payment.

## 4. Data model
`payment_requests(order_id UNIQUE, reference UNIQUE, provider, expected_amount_baht, currency THB, status awaiting|slip_received|verified|expired|cancelled|mismatch|duplicate, deadline_at, qr_payload, payee_name, payee_id_masked, bank_txn_ref, verified_at, verified_by)` · `payment_events(request_id, at, event, detail, provider_event_id)` · `payments(+request_id, provider, bank_txn_ref, verified_at, verified_by)`.
**Duplicate-payment prevention:** unique index on `payments.bank_txn_ref` (confirmed) and `payment_requests.bank_txn_ref`; an up-front check gives a clear message; concurrent confirmations of two orders with the same reference → one wins (tested); one confirmed payment per order (existing).

## 5. Future (the schema/code seams are in place; none is built)
| Capability | Seam |
|---|---|
| Slip upload + verification | `slip_received` status, `payments.slip_key`, events `slip_*`; a slip only moves the request to `slip_received` (owner still confirms); statement matching proposes, never auto-pays |
| Merchant QR / Bill Payment (carries Ref1/Ref2 → the bank's data can return our reference) | `provider='bill_payment'|'merchant_qr'`, same request/reference columns; needs a biller agreement (not purchased) |
| Gateway webhooks | `provider='gateway'`, `payment_events.provider_event_id UNIQUE` for idempotent webhooks, signature verification in a new Worker route |
| Automatic reconciliation | match by (amount, time window, `bank_txn_ref`) against imported statements/webhook data into `verified` **only** under an explicit owner-enabled policy; mismatches → `mismatch`; double payments → `duplicate` |

## 6. Not done / needs the owner
A real PromptPay ID (staging uses a synthetic one), the banking-app scan described above, any gateway/biller contract, slip upload UI, e-mail/LINE receipt to the customer. No payment was initiated; nothing was purchased.


## 7. Changing the receiving account (safety, tested)
Existing QR codes and links are bound to the account they were issued for (payload, payee name and masked ID are stored on the request; the pay page and QR image come from that record, never from the live setting). Settings changes: any change un-verifies; with unpaid payable orders outstanding the change is refused until acknowledged (count shown); `POST /api/admin/payments/revoke-outstanding {confirm:true}` withdraws every still-payable QR (orders stay pending, pages show "withdrawn" + the bank fallback, nothing is marked paid). Admin shows "QR บัญชีเดิม" on orders holding an old-account QR and the confirm dialog names the account to check. Procedure for the owner: `STAGING_RUNBOOK.md` §5. No transfers are ever made by the system or its tests.
