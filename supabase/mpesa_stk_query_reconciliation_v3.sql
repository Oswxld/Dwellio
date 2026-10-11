-- Apply AFTER mpesa_multi_landlord_foundation_v1.sql.
-- Stores independent STK Push Query evidence; does NOT settle/pay invoices.
-- This migration is additive and preserves previously received callbacks.
begin;

alter table public.mpesa_stk_requests
  add column if not exists verification_status text not null default 'not_checked';

alter table public.mpesa_stk_requests
  add column if not exists verification_error text;

alter table public.mpesa_stk_requests
  add column if not exists stk_query_response_code text;

alter table public.mpesa_stk_requests
  add column if not exists stk_query_result_code integer;

alter table public.mpesa_stk_requests
  add column if not exists stk_query_result_description text;

alter table public.mpesa_stk_requests
  add column if not exists stk_query_payload jsonb;

alter table public.mpesa_stk_requests
  add column if not exists stk_query_checked_at timestamptz;

-- A query only cross-checks status/identifiers. Standard STK Push Query
-- generally does not return amount/receipt, so "query_matched" is NOT
-- accounting settlement and must never alone create public.payments rows.
do $
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mpesa_stk_requests'::regclass
      and conname = 'mpesa_stk_verification_status_chk'
  ) then
    alter table public.mpesa_stk_requests
      add constraint mpesa_stk_verification_status_chk
      check (verification_status in
        ('not_checked','query_pending','query_matched','query_failed','mismatch','unavailable'));
  end if;
end;
$;

commit;
