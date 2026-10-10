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

## Before production or enabling the tenant Pay button

- Confirm the correct landlord merchant's Daraja credentials, **licensed/authorized PayBill** and production Go-Live activation.
- Verify each configured `units.name` is a short, unique **PayBill account number** under that PayBill, including any other property using the same PayBill. No automatic building prefixes are added.
- Implement Safaricom Query/reconciliation with transaction evidence and duplicate-callback protection.
- Integrate the deployed `record_payment`, `auto_allocate_payment`, and `refresh_invoice_balance` functions in one atomic, idempotent transaction **after verified success**. Ensure payment method enum/signatures match the real database. Accounting functions are NOT automatically created by this foundation.
- Handle webhook retries, provider outages, timeouts and refund/reversal processes.
- Test cross-property/cross-landlord isolation and correct settlement/reconciliation of real paybill statements.
- Only then replace the tenant invoice payment informational sheet with an actual STK initiation form.

**No production funds should be accepted through this unfinished integration.**
