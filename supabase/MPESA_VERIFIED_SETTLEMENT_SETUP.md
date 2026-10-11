# Dwellio M-Pesa: verified settlement into payments and invoice allocations (v4)

## What is implemented

The database now supports **atomic, idempotent settlement** after *independent merchant payment confirmation*.

**No callback automatically creates financial credit.** `stk_query_result_code = 0` and
`verification_status = 'query_matched'` corroborate transaction status but are not
independent proof of receipt, payer or amount on Safaricom's business ledger.

Flow:

1. Tenant starts an STK Push with an authorized landlord's PayBill and their **unit number** as `AccountReference`.
2. Safaricom calls `mpesa-stk-callback`; it saves the callback and verifies STK status via `stkpushquery`. A matched result becomes `callback_received` + `query_matched`. It **does not** mark a payment complete.
3. A **trusted operator/backend reconciliation process** verifies a merchant transaction record
   (for example, the landlord's official M-Pesa merchant statement or an authorized asynchronous
   Daraja Transaction Status API result), including **receipt, PayBill, account reference, phone, amount, and timestamp**.
4. **Only after step 3**, Dwellio stores the independently checked values in
   `public.mpesa_merchant_confirmations` and calls
   `public.finalize_merchant_confirmed_mpesa_stk(attempt_id)`.
5. `enforce_mpesa_settlement_gate` prevents settlement unless callback, STK Query, merchant
   confirmation, original request and landlord/property/tenant all agree.
6. Status updates to `confirmed`; `trg_mpesa_post_confirmed_payment` inserts one
   `payments` row via existing `record_payment(...)`. The separate
   `trg_allocate_completed_payment` on `payments` automatically calls
   `auto_allocate_payment(payment_id)` and the existing invoice update functions.
7. STK attempt gets `payment_id`. All operations occur in ONE PostgreSQL transaction.
   Failed allocations, wrong enum label, reused receipts, duplicate payment or mismatched
   proof roll the whole settlement back, without a phantom `confirmed` transaction.

### Core protection

The user/browser cannot invoke the settlement RPC or write the merchant confirmation
table. Those operations are restricted to **service_role/privileged SQL**. Only approved,
audited reconciliation code should have credentials/permission to insert merchant
confirmations. In particular: **DO NOT** take values from the STK callback and
immediately INSERT them as merchant confirmation. That defeats the independent check.

The trigger on `payments` intentionally applies to **all newly completed payments**,
including other payment methods, to match the existing oldest-invoice-first accounting
logic. If you have already created a different automatic-allocation trigger, assess
the interaction before enabling this one. `auto_allocate_payment` should be idempotent
but concurrent money flows still need accounting review.

The current allocator is tenant-wide. Settlement refuses a tenant with open invoices
at another property; this prevents posting a landlord's M-Pesa funds to another landlord
until property-specific allocation is built.

## Manual SQL Editor setup (no CLI required)

Apply SQL files in **this order**, skipping already successfully applied migrations:

1. `supabase/mpesa_multi_landlord_foundation_v1.sql`
2. `supabase/mpesa_unit_account_reference_v2.sql`
3. `supabase/mpesa_stk_query_reconciliation_v3.sql` — the latest GitHub revision
   fixes the `DO $$ ... $$` quote delimiter; if an older version failed, run the corrected file.
4. **NEW:** `supabase/mpesa_verified_settlement_v4.sql`

Migration 4 *requires* the existing PL/pgSQL functions
`record_payment`, `allocate_payment` and `auto_allocate_payment`. It
expects `record_payment(uuid,numeric,payment_method,text,timestamptz,text)`
(and requires an enum label `mpesa` or `m_pesa` at settlement time).
If the live database uses a different signature, do **not** rename or override
your existing billing function. Inspect the signature and adapt this bridge only.

### Check migration was installed

```sql
select
  t.tgname as trigger_name,
  c.relname as table_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and t.tgisinternal = false
  and t.tgname in (
    'trg_mpesa_settlement_gate',
    'trg_mpesa_post_confirmed_payment',
    'trg_allocate_completed_payment'
  )
order by table_name, trigger_name;
```

Expected 3 triggers:

- `mpesa_stk_requests`: `trg_mpesa_settlement_gate` and `trg_mpesa_post_confirmed_payment`
- `payments`: `trg_allocate_completed_payment`

### Inspect your actual payment function/enum

```sql
select n.nspname, p.proname,
       pg_get_function_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result_type
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('record_payment','auto_allocate_payment','allocate_payment');

select enumlabel
from pg_enum
where enumtypid = 'public.payment_method'::regtype
order by enumsortorder;
```

## How to settle a genuinely independently verified receipt

**NOT** a copy of callback data, and **NOT** based only on `query_matched`.

When authorized Dwellio staff verify a particular transaction against the
receiving landlord's real merchant transaction records, they can manually
record that reconciliation using privileged SQL Editor access (shown here as
placeholders — replace all with the verified **merchant-side** values).

```sql
insert into public.mpesa_merchant_confirmations (
  stk_request_id,
  merchant_paybill,
  account_reference,
  receipt_number,
  payer_phone,
  confirmed_amount,
  paid_at,
  confirmation_source,
  external_evidence_reference,
  evidence_notes
)
values (
  'STK_REQUEST_UUID'::uuid,
  'VERIFIED_RECEIVING_PAYBILL',
  'VERIFIED_UNIT_REFERENCE',
  'VERIFIED_MPESA_RECEIPT',
  '2547XXXXXXXX',
  7000,
  '2026-10-11T05:45:00+03:00'::timestamptz,
  'merchant_statement',
  'MERCHANT_STATEMENT_ENTRY_ID',
  'Verified independently against merchant statement, not copied from STK callback'
);
```

The actual `confirmed_amount`, reference, payer, PayBill and paid time must come
from independent merchant evidence. The placeholder timestamp above is illustrative.

**Next,** settle it:

```sql
select public.finalize_merchant_confirmed_mpesa_stk(
  'STK_REQUEST_UUID'::uuid
);
```

It will either atomically create and allocate one payment, return the previously
settled payment ID on a duplicate call, or raise a specific mismatch/missing-evidence
error while creating **no** incomplete accounting entry.

Verify:

```sql
select id, status, verification_status, payment_id,
       mpesa_receipt, amount, paybill_shortcode, account_reference
from public.mpesa_stk_requests
where id = 'STK_REQUEST_UUID'::uuid;

select p.*
from public.payments p
join public.mpesa_stk_requests r on r.payment_id = p.id
where r.id = 'STK_REQUEST_UUID'::uuid;

select pa.*
from public.payment_allocations pa
join public.mpesa_stk_requests r on r.payment_id = pa.payment_id
where r.id = 'STK_REQUEST_UUID'::uuid;
```

## Still required for fully automatic payments

Safaricom **Transaction Status API** (separate from STK Push Query) is an asynchronous
merchant-account lookup by M-Pesa receipt or conversation ID. It needs merchant
authorization, **Initiator** and encrypted **SecurityCredential**, and an
asynchronous result callback with its own security/reconciliation requirements.
We have **NOT implemented that API or its separate callback** in this version.
Alternatively a separately authenticated merchant statement/feed can supply
equivalent independent proof. See Safaricom's official docs:
https://developer.safaricom.co.ke/apis/TransactionStatus

To fully automate settlement next, Dwellio needs a merchant-reconciliation worker
and a secure write into `mpesa_merchant_confirmations`, followed by the
`finalize_merchant_confirmed_mpesa_stk` call. The trigger and accounting stages
are already in place. Never enable automated crediting directly from the
public `mpesa-stk-callback` endpoint.

**Production collections are not yet enabled. Remain on sandbox.**
