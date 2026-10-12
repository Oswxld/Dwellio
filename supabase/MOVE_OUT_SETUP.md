# Dwellio move-out: rollout checklist

This feature builds on the Tenants module in PR #39.

## Available now

- A seven-stage Stitch-inspired inspection/settlement UI inside each tenant profile.
- Inspection drafts and itemized charges (name, positive KSh amount, optional description) stored via Supabase.
- Resume/edit/remove while draft; complete an inspection (including zero-damage inspections).
- Read-only indicative view of historical invoices and deposit settlement.
- Actual downloadable **DRAFT** PDF and a browser-printable **DRAFT** PDF.
- A full-detail SMS **preview with no portal link**.
- A secure `finalize_move_out` RPC that terminates the lease and vacates the unit **only after** an actual non-void move-out invoice exists, the inspection is completed, and the staff member confirms keys/physical handover. The RPC refuses conflicting live/reserved leases.

## Corrected database hierarchy and migration recovery

These corrected SQL migrations use the **live** property hierarchy:

`units.floor_id -> floors.building_id -> buildings.property_id -> properties.organization_id`.

`units.property_id` is nullable and only cross-checked if populated. The SQL
never attempts to read `organization_id` from `units`, `floors`, or `buildings`.
The `leases` table carries `organization_id`, and the inspection table has its
**own** `organization_id` column for authorization; this column is added and
backfilled from the lease if a previous inspection table was created without it.

Both corrected scripts run inside a single SQL transaction, drop/recreate their
own named RLS policies, and should be rerunnable. They do not drop existing
inspection data. If an old inspection points to inconsistent lease/property
ownership, the script **stops with an explanation**, rather than silently
reassigning the inspection to a different organization.

**If you saw SQLSTATE 42703**, use the revised scripts from this branch, not
an old local copy. Apply them in the order below. If either script fails, no
changes from that invocation are committed; preserve the error text.

## Apply in Supabase SQL Editor, in this order

1. `supabase/move_out_inspections_v1.sql` (inspection drafts and charges).
2. `supabase/move_out_closeout_v1.sql` (guarded lease termination and unit vacancy).

Both depend on the existing organizations, organization_members, leases, tenants, units and invoices tables. Do not run against an uninitialized project. Check errors and existing schema before applying to production.

## Still blocked intentionally

- **Process final move-out invoice:** A transaction-based billing RPC must create a real row in `public.invoices`, original charge rows in `invoice_lines`, carried-debt references in `invoice_line_sources`, and a single auditable deposit application. It must compute arrears from authoritative invoices/payments, not by summing carried-forward balances from old invoices. The current screen presents a clearly labeled **indicative** total and keeps official processing disabled.
- **Official invoice print/PDF:** The PDF generator works, but is **DRAFT**-watermarked until the final financial snapshot exists. Never send it as a finalized statement.
- **Send final invoice SMS:** Existing `send-invoices` assumes monthly bill drafts/billing cycles and sends a *summary*. A dedicated server-side move-out invoice sender is needed for complete, itemized SMS delivery, with **no URL**. It should reuse Africa's Talking, authorization, delivery-status tracking, retry restrictions and cost metadata. No real send occurs in the prototype.
- **Security deposit refund:** Dwellio records a future refund obligation, but there is **no B2C integration**. Any refund is manual.
- **Closeout button:** Becomes eligible only after the official move-out invoice is present in the returned tenant invoice list, with `invoice_type = 'move_out'` and non-void status, as well as a completed inspection. The SQL RPC rechecks eligibility atomically. Until then it remains disabled.

## Rules

- Inspections do not require a move-out request.
- Inspection start/completion does not terminate the lease, vacate a unit, send SMS, or deduct a deposit.
- Deposits are reserved until final settlement, not consumed by monthly invoices.
- An arrears snapshot must not duplicate debts copied via previous_balance.
- Finalize Move-Out is separate from processing and SMS. It sets `leases.status = 'terminated'`, sets `terminated_at` and `move_out_date`, and sets the unit to `vacant` only if there is no conflicting lease.
- The tenant may lose portal access after termination. **SMS must include full invoice details and must not include a login/dashboard link.**
- Financial balances and refund obligations survive lease termination.
- Print and PDF download should always show the complete official snapshot once processing is ready.

## Smoke-test before merging

1. Start inspection with an active lease that has no move-out request.
2. Save, edit and remove an inspection line; reload and verify persistence.
3. Complete a zero-charge inspection and verify further edits are rejected.
4. Create a draft PDF with multiple items; verify it opens and shows the DRAFT watermark.
5. Check historical invoices with carried-forward debt; verify the UI calls amounts indicative.
6. Confirm the Process Invoice and Send SMS controls cannot fabricate a completed operation.
7. Test the closeout RPC only in a sandbox with a genuine processed move-out invoice; verify termination, vacant unit, rejection of conflicting leases and retention of financial history.

**No live Supabase instance or SMS provider was called by the GitHub build.**
