# Tenant invoice history and detailed ledger — V1

Mobile-first React/Tailwind-compatible pages based on the supplied Google Stitch HTML:

- `/tenant/invoices` — invoice history with status and month filters, read-only account balance and M-Pesa entry point.
- `/tenant/invoices/:invoiceId` — invoice header, itemized current-period charges (`bill_charges`), meter reading calculations (`bill_charge_details`), historical source invoices (`bill_draft_balance_sources`), financial summary and confirmed allocated payments (`payment_allocations` + `payments`).
- Existing Home, Lease and Personal Information screens remain intact; existing tenant bottom navigation remains shared.

## REQUIRED Supabase deployment

Before testing, in **Supabase SQL Editor** execute:

`supabase/tenant_invoice_ledger_v1.sql`

This adds two **read-only** SECURITY DEFINER functions:
- `public.get_my_tenant_invoices()`
- `public.get_my_tenant_invoice_detail(p_invoice_id uuid)`

They use `auth.uid()` joined to `tenants.user_id`. They do not trust an email or tenant ID supplied by the browser and do not allow access to other tenants' invoices.

The detail RPC loads confirmed payment allocations only and prevents cross-tenant lookups of source invoices. It never updates payments, invoices or balances.

The invoice list only contains **finalized invoices** (`invoices`); it does not expose bill drafts.

## Financial cautions

- `bill_drafts.previous_balance` and `bill_draft_balance_sources` represent **historical snapshots as of billing generation**. A later payment on an older source invoice can change the current balance without changing this past snapshot.
- Source invoice balances are **not additional new service charges**.
- The existing `get_my_tenant_portal()` / `get_tenant_outstanding_balance(uuid)` provides the Home and invoice-list account balance. **Verify this helper does not double-count historical balances copied into newer invoices**, especially when it sums `invoices.outstanding_amount`. This migration deliberately DOES NOT change your payment allocation or outstanding-balance semantics. Do not treat an unverified aggregate as reconciled accounting.
- Invoice totals and outstanding amounts shown on the detail page come from stored invoice data, NOT client-side recalculation.
- A single payment allocated across several invoices only displays the amount allocated to the selected invoice.

## M-Pesa

The Stitch files contain simulated STK Push status updates. **Those are intentionally not integrated**. Clicking Pay with M-Pesa displays an explanatory bottom sheet saying no real STK Push is connected. No payment can be initiated, confirmed or marked successful from these views yet.

Next phase: real M-Pesa initiation + secure callback verification + idempotent payment allocations, then a full payment/receipt UI.

## How to pull and smoke test

```bash
git switch main
git pull origin main
npm run build
npm run dev
```

Open `http://localhost:5173/tenant/invoices` as a real linked tenant.

1. Check there is at least one finalized invoice tied to that tenant's bill draft.
2. Verify invoice list filters and billing month controls.
3. Open a detailed invoice, expand usage charge calculations, click a carried-forward source invoice and return.
4. Check current charges and historical balance sources against landlord billing data for the SAME invoice.
5. Confirm partially paid invoices display payment allocations; unpaid invoices have an honest empty state.
6. Test with another tenant account and verify it **cannot** open the first tenant's invoice ID.
7. Confirm M-Pesa never fakes a request or payment.

GitHub merging does not deploy SQL; no live Supabase/database browser test is performed by this PR.
