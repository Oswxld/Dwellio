# Dwellio tenant M-Pesa checkout (v6 — SANDBOX ONLY)

This implements the tenant-facing checkout against the existing per-landlord
PayBill and per-unit M-Pesa account reference.

## Existing backend foundation (already in GitHub)

- Landlord sets their PayBill via `request_my_property_mpesa_setup`.
- Dwellio operator provisions their sandbox Daraja credentials in Supabase
  Vault and changes `mpesa_property_settings.setup_status` to
  `sandbox_ready` with the Vault secret UUID.
- V2's `reserve_my_mpesa_stk(property,phone,amount)` validates that the
  authenticated tenant has **one current unit** in the requested property,
  reads **`units.name`** (e.g. `A12`) and the associated approved
  `mpesa_property_settings.paybill_shortcode` and creates one tracked attempt.
  The browser **cannot set the PayBill, unit account reference or tenant ID**.
- `mpesa-stk-initiate` gets the property's credentials from Vault and sends
  `BusinessShortCode=property PayBill`, `PartyB=property PayBill`,
  `AccountReference=units.name`, `PhoneNumber=tenant-entered phone`.
- V5's callback and query-matched auto-settlement post completed payments
  and run `auto_allocate_payment` **only after** the matching Safaricom query.
  Safaricom query does **not** independently verify receipt/amount; this is
  Dwellio's intentionally limited V1 sandbox policy.

## NEW: Apply SQL in the Supabase dashboard

**After V1, V2, V3, V4 and V5** migrations, run:

`supabase/mpesa_tenant_checkout_context_v6.sql`

This adds tenant-authenticated, security-definer read-only RPCs:

- `get_my_mpesa_checkout_context(p_invoice_id uuid = null)` derives the
  current property's PayBill and the tenant's unit from their authenticated
  tenancy, or identifies an invoice the tenant owns. It returns the PayBill,
  unit name, tenant phone prefill, outstanding balance and setup status, **not
  secret credentials**. A tenant with multiple current units must open a
  specific invoice; cross-landlord balance guards still apply.
- `get_my_recent_mpesa_stk(p_property_id)` returns the latest nonterminal
  attempt from the last 24 hours to prevent accidental duplicate prompts when
  the user reloads their browser.
- `get_my_mpesa_stk_status(p_attempt_id)` extends the existing status RPC
  with verification, receipt and `payment_id`, scoped to the signed-in tenant.

## Frontend

Both `/tenant/invoices` and `/tenant/invoices/:invoiceId` now open
`TenantMpesaCheckout`. It displays:

- Property name
- The PayBill submitted/approved by that property
- Tenant's **actual unit number** (read-only)
- Outstanding account balance
- Editable M-Pesa phone and whole-KSh amount (maximum single request KSh 150,000)

The form invokes authenticated `mpesa-stk-initiate` with **only**
`property_id`, `phone_number` and `amount`. It polls the tenant-scoped
status RPC (not a payment acceptance response) until a terminal outcome or
timeout. It refreshes the invoice ledger after `confirmed`.

**Note:** Since `auto_allocate_payment` applies payments oldest-invoice-first,
the amount entered on an individual invoice does not guarantee allocation to
that invoice ahead of older outstanding debt; this is explained in the UI.

## Deployment checklist (no CLI required)

1. Make sure the PayBill row's `setup_status='sandbox_ready'`, Vault secret UUID
   points to a **valid** JSON sandbox credential (not placeholder values), and
   the PayBill is correct for those credentials.
2. In **Supabase → SQL Editor**, run the full new V6 SQL file.
3. Verify `mpesa-stk-initiate` and `mpesa-stk-callback` are deployed in
   **Supabase → Edge Functions** from the V5-updated GitHub files.
   Initiate requires tenant JWT; callback requires Verify JWT **disabled**.
4. Ensure `MPESA_CALLBACK_BASE_URL` is your project origin HTTPS URL.
5. Deploy the latest Dwellio React app with these frontend changes.
6. Sign in as a tenant with `tenants.user_id` linked to Auth and an active or
   upcoming/noticed lease. Open **Invoices → Pay with M-Pesa** and verify the
   displayed PayBill and unit match that lease and landlord.
7. Use valid **sandbox** test credentials and phone data to test: success,
   user cancellation, timeout, incorrect unit names, pending merchant setup,
   reload during a pending prompt, and V5 automatic accounting.
8. On successful confirmation, inspect the `mpesa_stk_requests.payment_id`,
   linked `payments` row and `payment_allocations` rows. No balance change
   should occur from an unconfirmed STK acknowledgement.

## Existing V1 limitations

- This is **sandbox only**. Never display the checkout as live collection.
- PayBill/AccountReference come from **backend**; a tenant cannot override them.
- Unit names must be 1–12 letters, digits or hyphens and unique on shared
  PayBills as enforced by V2.
- If a tenant has open invoices in more than one property, the V2 reservation
  and V5 settlement intentionally refuse the cross-property allocation case.
- Amount limits and unit eligibility are rechecked **on the server**, not
  trusted from browser inputs.
- A timed-out or uncertain attempt should **not** be blindly retried. The
  tenant can check its status or contact the manager.
- This PR changes **frontend and SQL only**. New SQL and Edge Functions must
  be deployed manually in the user's Supabase project before end-to-end use.
