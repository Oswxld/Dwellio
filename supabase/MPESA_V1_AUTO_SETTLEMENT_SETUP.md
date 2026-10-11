# Dwellio M-Pesa V1 — Automatic STK Query-confirmed settlement (sandbox only)

**Policy agreed for V1:** a successful Safaricom STK callback followed by a
matching **independent Safaricom STK Query result** (same original
CheckoutRequestID, MerchantRequestID and ResultCode 0) is sufficient to credit
the requested amount. The callback's Amount, PhoneNumber and MpesaReceiptNumber
must also be valid and match Dwellio's original STK request; receipts must not
have been used by another STK attempt.

**Tradeoff:** standard STK Query doesn't independently return the amount or
receipt. We intentionally do NOT demand a separate merchant statement or
Transaction Status API for V1. This is *status corroboration*, not complete
merchant-transaction reconciliation. This workflow remains **SANDBOX ONLY**;
review payment security and reconciliation before enabling live money.

## What is automated

1. `mpesa-stk-initiate` sends request using landlord's approved sandbox PayBill,
   tenant's actual unit number (as AccountReference), original tenant and amount.
2. Safaricom callback arrives; `mpesa-stk-callback` validates URL token and
   original CheckoutRequestID/MerchantRequestID and stores callback evidence.
3. The callback contacts Safaricom sandbox STK Query using this property's
   approved credentials stored in Supabase Vault.
4. Only when **both** callback and STK Query report success for the same
   transaction, and callback amount/phone/receipt match the original request,
   the Edge Function stores `verification_status = 'query_matched'`.
5. The trusted Edge Function calls `finalize_query_matched_mpesa_stk(attempt_id)`
   with its service-role client. The SQL locks the STK row, rechecks **raw**
   callback and STK Query IDs/codes/amount/phone/receipt, ensures the PayBill
   belongs to the correct organization and that there are no cross-property
   arrears.
6. Status changes to `confirmed`, V4's `trg_mpesa_post_confirmed_payment`
   invokes `record_payment(...)` to create a single `completed` payment,
   and the `trg_allocate_completed_payment` trigger calls
   `auto_allocate_payment(NEW.id)`. Oldest invoice is cleared first.
7. The STK row's `payment_id` links the transaction to the payment.
   **ALL those database writes are one PostgreSQL transaction.**

No tenant or landlord can invoke the finalization RPC. No callback by itself
inserts into `payments`; the separate STK Query must corroborate success.
A duplicate callback returns the previous payment or safely retries a
previously failed accounting write. The `mpesa_receipt` is unique in the
STK requests table and the payment reference must also be unique.

### Outcome table

| Situation | STK state | Payment created? |
| --- | --- | --- |
| Callback success, STK Query success, all available IDs/details match | `confirmed` with `payment_id` | **YES** |
| Both report final payment failure | `failed` | NO |
| Callback and STK Query disagree | `needs_review` | NO |
| Wrong checkout/merchant IDs, amount, phone, missing/duplicate receipt | `needs_review` or error | NO |
| Safaricom query unavailable | `needs_review` | NO |
| Safaricom query matched, but `record_payment`/allocation raised a DB error | `callback_received` + `query_matched` | NO; pending retry |

## Deploy manually in Supabase dashboard — NO CLI NEEDED

**Important: these changes are in GitHub only until YOU apply the migration
and redeploy the callback. GitHub merges do not change the live database
or deployed Supabase Edge Functions.**

Run in Supabase SQL Editor, in order, skipping migrations you have already
successfully run:

1. `supabase/mpesa_multi_landlord_foundation_v1.sql`
2. `supabase/mpesa_unit_account_reference_v2.sql`
3. `supabase/mpesa_stk_query_reconciliation_v3.sql`
4. `supabase/mpesa_verified_settlement_v4.sql` (previous trigger foundation; **use
   the latest GitHub version**, which fixes a malformed `DO $$` block)
5. **NEW** `supabase/mpesa_query_matched_autosettlement_v5.sql`, which replaces
   only the merchant-proof gate and payment-posting function; it preserves
   the existing payment allocation trigger.

Then go to **Supabase → Edge Functions → mpesa-stk-callback**. Replace the
entire code with the latest:

`supabase/functions/mpesa-stk-callback/index.ts`

Deploy from the Supabase editor. Keep **Verify JWT disabled** for Safaricom's
public callback. Keep it **enabled** on tenant-authenticated
`mpesa-stk-initiate`; its previous code still works with this change.

The V5 migration **deprecates** V4's manual finalizer
`finalize_merchant_confirmed_mpesa_stk`. Its historical
`mpesa_merchant_confirmations` table remains unused, not deleted.

### Check your deployed billing functions before taking even sandbox payments

These functions are from your pre-existing billing SQL, not defined in V5:

```sql
select p.proname,
       pg_get_function_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and p.proname in ('record_payment','auto_allocate_payment','allocate_payment');

select enumlabel
from pg_enum
where enumtypid = 'public.payment_method'::regtype
order by enumsortorder;
```

The V4 payment trigger calls `auto_allocate_payment(uuid)`, and V5 calls
`record_payment(uuid,numeric,payment_method,text,timestamptz,text)`
with the enum label `mpesa` or `m_pesa`. If your live signature or
enum differs, **adapt the bridge to the actual DB**, not the pre-existing
billing functions. Check that `record_payment` inserts with
`status='completed'` and does not itself also auto-allocate a payment.

Check triggers:

```sql
select c.relname as table_name, t.tgname
from pg_trigger t
join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal
  and t.tgname in (
    'trg_mpesa_settlement_gate',
    'trg_mpesa_post_confirmed_payment',
    'trg_allocate_completed_payment'
  )
order by c.relname,t.tgname;
```

### Post-test inspection

```sql
select id, status, verification_status, stk_query_result_code,
       callback_result_code, mpesa_receipt, payment_id,
       amount, account_reference, paybill_shortcode
from public.mpesa_stk_requests
order by created_at desc
limit 10;
```

For a confirmed attempt, `payment_id` should be non-null. Then inspect:

```sql
select p.id, p.tenant_id, p.amount, p.reference, p.status
from public.payments p
join public.mpesa_stk_requests s on s.payment_id=p.id
where s.status='confirmed'
order by p.id desc limit 10;

select pa.*
from public.payment_allocations pa
join public.mpesa_stk_requests s on s.payment_id=pa.payment_id
where s.status='confirmed'
order by pa.payment_id desc limit 25;
```

Test in Daraja sandbox with one known tenant/property, KSh 1–100, and the
landlord sandbox PayBill configured. Test success, cancellation, duplicate
callback, query timeout, mismatched receipt/phone/amount, and invoice balance
changes. Never synthesize an STK Query result or manually set status to
`confirmed` just to satisfy the triggers.

**Not yet built:** a periodic reconciliation worker for missing callbacks or
no-retry `pending_retry` states; the tenant portal's Pay button still shows
an informational sheet. Those are follow-on tasks. This version only
automatically settles *when the actual callback is received and the separate
STK Query returns a matching success*.
