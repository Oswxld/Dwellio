# Dwellio Move-out Inspection, Final Invoice and SMS

## Design and intended behavior

- Landlord can start inspection for an active / notice-given / expired lease, even without a move-out request.
- Inspection charge items have a name, positive KSh amount and optional description. Zero-charge inspections are valid.
- A completed inspection is read-only.
- **Process Final Invoice** is one server-side transaction:
  - Checks tenant, property and organization membership.
  - Rejects missing/unreconciled invoice balances and invalid deposit state.
  - Creates `invoices` row with type `move_out`.
  - Creates charge rows in `invoice_lines` marked receivable.
  - Creates **carried_forward, non-receivable** line and `invoice_line_sources` links to original unpaid invoices.
  - Captures original debt in `move_out_settlement_arrears` and settlement totals in `move_out_settlements`.
  - Applies security deposit **once at move-out**, first to old original invoices (oldest first), then to inspection charges, using the existing `apply_deposit_deduction(...)` RPC.
  - Carries any unused deposit as refundable; **no B2C payout** is performed.
  - Does **not** send SMS or terminate the lease.
- **Print / Download PDF** is a working, browser-generated document; draft before processing, official statement after a finalized financial snapshot is available.
- **Send SMS** is an independent, manager-confirmed step. The SMS contains all inspection charges, original invoice references, deposit held/applied, remaining payable and refundable. **No login/portal link**, even after lease termination. Uses Africa's Talking. Only definitely failed claims can be retried.
- **Finalize Move-Out** is an independent, confirmed RPC. Requires an official move-out invoice and completed inspection, then sets `leases.status='terminated'` and `units.status='vacant'` atomically if no conflicting lease exists. Unpaid balances and manual refund obligations remain.

## SQL migrations (run in Supabase SQL Editor, in order)

The existing billing schema, `invoice_lines`, `invoice_line_sources`, `security_deposits`, `deposit_allocations`, `payment_allocations`, `payments`, `refresh_invoice_balance(uuid)` and `apply_deposit_deduction(uuid,uuid,numeric,text)` must already exist.

1. `supabase/move_out_inspections_v1.sql`
2. `supabase/move_out_sms_v1.sql` — creates settlement snapshot and new standalone SMS delivery tables
3. `supabase/move_out_invoice_posting_v1.sql` — creates `process_move_out_invoice(p_inspection_id uuid)`
4. `supabase/move_out_closeout_v1.sql` — creates `finalize_move_out(...)`

### Edge Function deployment

Deploy `supabase/functions/send-move-out-invoice/index.ts` with name `send-move-out-invoice` using Supabase Edge Functions.

This function uses the **same secrets** as the existing monthly `send-invoices` function:

- `AFRICASTALKING_USERNAME`
- `AFRICASTALKING_API_KEY`
- `AFRICASTALKING_SENDER_ID` (required in production)

It does **not** modify or replace the monthly SMS flow. Only service role may call the final-message claim RPC. A signed-in landlord calls the Edge Function; the RPC independently checks authorized organization membership.

### Known live-schema prerequisites and safety checks

The GitHub repo does not contain the original full `security_deposits` or `deposit_allocations` SQL schema. Before running on production:

- Verify `security_deposits` includes `id`, `amount`, `tenant_id` and optionally `lease_id`.
- Verify `deposit_allocations` includes `security_deposit_id`, `invoice_id`, `amount`.
- Verify existing `apply_deposit_deduction` has signature `(uuid,uuid,numeric,text)` and correctly refreshes invoice balances.
- Verify `invoice_type` enum includes `move_out`; `invoice_lines.line_type` includes `carried_forward` and one of `move_out_inspection`, `inspection`, `adjustment`, `other`. The RPC refuses unsupported labels instead of guessing a cast.
- Verify `invoice_lines.is_receivable = true` identifies collectible charges and previous carried-forward charges have `is_receivable=false`. The processor validates recorded unpaid balances against receivable charges, completed payments and deposit allocations.
- Verify `generate_invoice_number()` exists or the processor will generate a unique move-out reference.
- If multiple deposits or a previously applied deposit exist for a lease, the RPC refuses to guess.
- The pre-existing `calculate_invoice_balance`, `refresh_invoice_balance`, and invoice trigger behavior must be confirmed on a test tenant. Trigger side-effects can affect invoice totals.

The SQL processor is transaction-atomic, but **has not been executed against a live Supabase database** in this GitHub-only workflow. Do not apply to production without testing in a safe environment first.

### Property ownership / organization

Never query `units.organization_id`, `floors.organization_id` or `buildings.organization_id`. Resolve via
`units.floor_id -> floors.building_id -> buildings.property_id -> properties.organization_id`.
The `leases.organization_id` and `tenants.organization_id` must match the property.

## Validation checklist

1. Create an inspection with no notice; save, edit and remove charges; complete a zero-charge inspection.
2. Process a final invoice for an unpaid tenant with a security deposit. Check `invoice_lines`, `invoice_line_sources`, original invoice outstanding, `deposit_allocations` and settlement totals.
3. Process again: same invoice and settlement IDs should be returned, with no duplicated deductions.
4. Test historical invoices carrying debt: non-receivable previous balance must not become a second collectible charge.
5. Test no deposit, exact deposit cover, positive refund, insufficient deposit, and no inspection damage.
6. Test pre-existing deposit allocations and deliberately unreconciled invoice ledger: the operation must refuse and leave no partial entries.
7. Print/download official final PDF and inspect page breaks and all source invoices.
8. Send SMS in Africa's Talking sandbox. Validate item descriptions and source invoice references, with no URL.
9. Test provider rejection, timeout/unknown outcome and duplicate-send protection.
10. Finalize tenancy with confirmed handover. Verify `leases.status='terminated'`, `terminated_at`, `move_out_date`, `units.status='vacant'`; reject conflicting leases.

## Git

All work is in draft PR #39 on branch `chatgpt/tenants-directory-ledger-requests`, not in main.
