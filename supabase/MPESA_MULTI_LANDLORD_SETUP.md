# Dwellio M-Pesa — multi-landlord PayBill foundation (SANDBOX ONLY)

**Status:** Backend scaffolding and a landlord PayBill submission page. NOT PRODUCTION READY. NO automatic crediting of invoices. Do not activate for real-money payments.

## Architecture

1. Each property belongs to one landlord organization.
2. The landlord opens **Payment Settings → M-Pesa PayBill Setup**, selects a property and submits their receiving PayBill shortcode. This is a *request for verification*, not permission to charge.
3. Dwellio staff obtain the landlord's explicit authorization, complete Safaricom/Daraja sandbox setup and later Go Live verification for that merchant/shortcode, and securely provision its **Consumer Key, Consumer Secret and STK Passkey** in Supabase Vault. NEVER enter these credentials in the landlord's browser, the `src/` directory or Git.
4. Dwellio staff associate the Vault secret UUID with the property's settings row and mark its sandbox configuration ready.
5. An authenticated tenant requests a whole-KSh payment, specifying **property ID, mobile number, amount**. The server derives tenant, organization's PayBill, and an immutable tenant-specific reference. Clients cannot supply their own PayBill or account reference.
6. `mpesa-stk-initiate` authenticates the caller, reserves a tracked attempt via `reserve_my_mpesa_stk`, reads *that property's* Vault merchant credentials using the service role, sends an STK request to **Safaricom SANDBOX ONLY**, and records the CheckoutRequestID. A 202 acknowledgement is **not a payment confirmation**.
7. `mpesa-stk-callback` is a public endpoint requiring a per-attempt opaque token in its URL and a matching CheckoutRequestID. It records callback evidence for later reconciliation. **It never inserts a completed payment and never calls `auto_allocate_payment`.**

### Why do we stop at recording the callback?

The backend must not trust a callback payload as sufficient financial proof. Before going live we need a production authorization/verification and reconciliation workflow, an idempotent **atomic** `payments` + `payment_allocations` settlement transaction and proper handling for lost/duplicated callbacks, retries, timeouts and reversals. Only after verified settlement will `auto_allocate_payment` settle the oldest unpaid invoices.

### Property/account routing

- PayBill shortcode: `mpesa_property_settings.paybill_shortcode`; property-specific, approved separately.
- Credentials: stored as JSON in Supabase Vault, referenced by `mpesa_property_settings.credential_secret_id`. Encrypted at rest. One secret can be referenced by multiple properties *only if* that same Daraja merchant authorization covers them.
- Tenant account reference: the tenant's **actual unit number** from `public.units.name` (e.g. `A12`), using the follow-up migration `supabase/mpesa_unit_account_reference_v2.sql`. Dwellio sends this exact value as Daraja's `AccountReference` and snapshots it on the STK attempt. It must be 1–12 letters/digits/hyphens; if duplicate across units sharing the same PayBill (including across properties), STK initiation is blocked rather than guessing. The legacy `mpesa_tenant_accounts` table remains for historical compatibility but is no longer used for new attempts. Confirm the unit number convention with each landlord before collecting funds.
- When a tenant has unpaid invoices at multiple properties, this initial version refuses an STK request. The current `auto_allocate_payment` function is tenant-wide; enabling multi-property collections requires property-scoped allocation so one landlord's funds are never assigned to another PayBill/property.

## Step 1 — Apply the migration

Run these files **in order** in Supabase SQL Editor:

1. `supabase/mpesa_multi_landlord_foundation_v1.sql` — original tables and payment functions (skip if already applied).
2. `supabase/mpesa_unit_account_reference_v2.sql` — overrides STK reservation to use the tenant's unit number, with duplicate-reference protection. **Always apply this after the original foundation.**

Includes:
- `mpesa_property_settings`
- `mpesa_tenant_accounts` (legacy compatibility only; unit number now sourced from `units.name`)
- `mpesa_stk_requests`
- `get_my_property_mpesa_settings(uuid)`
- `request_my_property_mpesa_setup(uuid,text)`
- `reserve_my_mpesa_stk(uuid,text,integer)`
- `get_my_mpesa_stk_status(uuid)`
- `get_mpesa_stk_service_context(uuid)` (service-role-only, returns Vault secrets)

Only approved owner/admin/manager memberships can read/request property PayBill configuration. The landlord UI never sees provider secrets. Tenant attempts are tied to their linked, active tenant record and lease at the selected property.

## Step 2 — Request a PayBill in the landlord portal

After pulling the code, sign in to the landlord portal and open **Payment Settings** in the sidebar. Visit:

`http://localhost:5173/settings/payments`

Select a property, enter the numeric PayBill shortcode, and submit. It remains **pending**, and no STK payment can begin until Dwellio staff approve and provision Daraja credentials.

## Step 3 — Provision sandbox merchant credentials securely

Only Dwellio staff with Supabase SQL Editor access should run the following example, replacing the placeholders with SANDBOX test data. **Never commit this statement with real credentials**.

```sql
select vault.create_secret(
  '{"environment":"sandbox","consumer_key":"SANDBOX_KEY","consumer_secret":"SANDBOX_SECRET","passkey":"SANDBOX_PASSKEY"}',
  'dwellio-mpesa-sandbox-unique-property-name',
  'Dwellio landlord sandbox Daraja credentials'
);
```

Copy the returned Vault secret UUID. Verify it corresponds to the intended property and shortcode. After confirming landlord authorization and sandbox merchant compatibility, use:

```sql
update public.mpesa_property_settings
set credential_secret_id = 'VAULT_SECRET_UUID'::uuid,
    setup_status = 'sandbox_ready',
    verified_at = now(),
    updated_at = now()
where property_id = 'PROPERTY_UUID'::uuid
  and paybill_shortcode = 'APPROVED_SANDBOX_SHORTCODE'
  and setup_status = 'pending';
```

This requires privileged SQL Editor access, not a tenant or landlord browser request. For production, a separate operator-only provisioning workflow, rotation and live verification are still needed.

## Step 4 — Deploy the Edge Functions

Install and log into the Supabase CLI. Link your Supabase project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Set `MPESA_CALLBACK_BASE_URL` to your public HTTPS Supabase project origin (not a function path), e.g. `https://YOUR_PROJECT_REF.supabase.co`. For a local webhook tunnel, supply its equivalent publicly reachable HTTPS origin **only if it correctly routes /functions/v1/...**.

```bash
supabase secrets set MPESA_CALLBACK_BASE_URL=https://YOUR_PROJECT_REF.supabase.co
supabase functions deploy mpesa-stk-initiate
supabase functions deploy mpesa-stk-callback --no-verify-jwt
```

**Why --no-verify-jwt on the callback?** Safaricom does not supply your tenant Supabase Auth JWT. The callback validates a per-attempt URL token and checkout correlation instead. This remains *untrusted evidence*, not proof of payment.

The initiation function uses user authentication (`withSupabase({auth:'user'})`) and the database authorization RPC. **Never deploy the callback as a tenant-authenticated function.**

### Test an authorized tenant request

Once the schema, property settings, Vault sandbox credentials and functions are deployed, call the function with the tenant's legitimate Supabase session; e.g. within a frontend button handler:

```ts
const { data, error } = await supabase.functions.invoke('mpesa-stk-initiate', {
  body: {
    property_id: propertyId,
    phone_number: '0712345678',
    amount: 100,
  },
})
```

- The actual test account must have at least KSh 100 unpaid and an active linked tenancy at the selected property.
- The server chooses the approved PayBill and tenant account reference.
- The STK request response may return `awaiting_callback` or `needs_review`. **Neither means paid**.
- To read status, call `get_my_mpesa_stk_status(attempt_id)` with the tenant's JWT.
- To make a second attempt, first check and reconcile the previous one; do not loop/retry blindly.

## STK callback status query reconciliation (v3)

**Before replacing/deploying these functions**, run **`supabase/mpesa_stk_query_reconciliation_v3.sql`** in Supabase SQL Editor after the foundation migration. This adds `verification_status`, `verification_error`, `stk_query_response_code`, `stk_query_result_code`, `stk_query_result_description`, `stk_query_payload`, and `stk_query_checked_at` to `mpesa_stk_requests`. The migration is safe to re-run. Do not skip it: the new callback expects the columns.

If you use the Supabase Dashboard rather than CLI (recommended when you prefer manual deployment):
1. Open **Edge Functions → mpesa-stk-callback**, replace its source code from **`supabase/functions/mpesa-stk-callback/index.ts`**, and deploy. Keep **Verify JWT disabled** for this provider callback.
2. Open **Edge Functions → mpesa-stk-initiate**, replace the code from **`supabase/functions/mpesa-stk-initiate/index.ts`**, and deploy. Keep **Verify JWT enabled** for tenant initiation.
3. The `MPESA_CALLBACK_BASE_URL` setting and sandbox merchant credentials in Vault are still required; this change introduces **no new keys**.

The callback now:
- Validates the opaque per-attempt callback URL token, `CheckoutRequestID` and `MerchantRequestID` against the original STK request.
- Stores the first callback as evidence, **before** querying Safaricom. Identical retries are idempotent; conflicting callbacks are quarantined.
- Uses the same property's **sandbox** Daraja credentials from Vault to authenticate and call `POST https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query` with the **original** `CheckoutRequestID`.
- Compares query result code and IDs with the callback and original request. Also checks callback amount and phone against original amount/phone; ensures receipt shape and detects another STK attempt with that receipt.
- Stores the **full query response** and the verification outcome for investigation. No API keys, passkeys or OAuth access tokens are stored in query evidence.
- **Never creates rows in `payments`, never marks an STK attempt `confirmed`, and never calls `auto_allocate_payment`.**

| Condition | `mpesa_stk_requests.status` | `verification_status` |
| --- | --- | --- |
| Safaricom Query says success; callback also says success; IDs and locally known amount/phone/receipt agree | `callback_received` | `query_matched` |
| Query and callback both report the same unsuccessful final result | `failed` | `query_failed` |
| Query and callback disagree, IDs don't match, callback amount/phone differs, or receipt is reused | `needs_review` | `mismatch` |
| Query unavailable/timed out, invalid or merchant credentials missing | `needs_review` | `unavailable` |
| Request is querying Safaricom | `callback_received` | `query_pending` |

**Important limitation:** Safaricom's standard **STK Push Query** response confirms the status and request IDs, but normally **does not contain `Amount`, `PhoneNumber`, or `MpesaReceiptNumber`**. A `query_matched` result only means the status corroborates the callback, while the amount/phone/receipt have been checked against what *Dwellio* originally requested. It is **not an independent amount/receipt comparison to Safaricom's merchant transaction ledger**. Such reconciliation must be added separately with the merchant's authorized transaction records/status API before automated monetary settlement.

For records left in `needs_review`, a future privileged retry/reconciliation job should re-query Safaricom; do not trigger duplicate STK prompts or directly edit the `status` to `confirmed`. A matching result is *still not money booked*. A later atomic settlement function is needed to create one confirmed `payments` row and call `auto_allocate_payment` safely.

## Verified accounting settlement (v4)

After applying the callback/query evidence migration, the **separate** settlement
bridge is in `supabase/mpesa_verified_settlement_v4.sql`. It implements two
database triggers:

- When a **merchant-reconciled** STK attempt is changed to `confirmed`, post one
  `payments` record via `record_payment`.
- When a `payments` row becomes `completed`, call `auto_allocate_payment`
  to clear the tenant's oldest unpaid invoices.

Both triggers execute **inside one transaction** and roll back together on
error. A separate `mpesa_merchant_confirmations` record must be created
**only after independent merchant transaction verification**; the callback's
`query_matched` flag alone cannot create money. See
`supabase/MPESA_VERIFIED_SETTLEMENT_SETUP.md` for complete SQL and tests.

This creates the settlement path but **does not yet fully automate merchant
transaction reconciliation**. Safaricom Transaction Status needs separately
authorized initiator/security credentials and asynchronous results; until
that's implemented, verify via official merchant records and use the
privileged SQL workflow described in that guide.

## Before production or enabling the tenant Pay button

- Confirm the correct landlord merchant's Daraja credentials, **licensed/authorized PayBill** and production Go-Live activation.
- Verify each configured `units.name` is a short, unique **PayBill account number** under that PayBill, including any other property using the same PayBill. No automatic building prefixes are added.
- Implement Safaricom Query/reconciliation with transaction evidence and duplicate-callback protection.
- Integrate the deployed `record_payment`, `auto_allocate_payment`, and `refresh_invoice_balance` functions in one atomic, idempotent transaction **after verified success**. Ensure payment method enum/signatures match the real database. Accounting functions are NOT automatically created by this foundation.
- Handle webhook retries, provider outages, timeouts and refund/reversal processes.
- Test cross-property/cross-landlord isolation and correct settlement/reconciliation of real paybill statements.
- Only then replace the tenant invoice payment informational sheet with an actual STK initiation form.

**No production funds should be accepted through this unfinished integration.**
