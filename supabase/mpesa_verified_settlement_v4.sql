-- Dwellio M-Pesa settlement bridge (v4).
-- PRECONDITIONS: V1 STK foundation, V3 query evidence, and the existing
-- record_payment(), auto_allocate_payment(), allocate_payment() functions.
--
-- IMPORTANT: Query-matched callbacks are NOT sufficient proof that merchant
-- received the specific receipt/amount. Only a verified merchant transaction
-- record may authorize settlement; this migration does not automatically
-- create merchant confirmations from the public STK callback.
--
-- The SETTLEMENT itself is fully atomic:
-- merchant-confirmed STK -> status confirmed -> payment INSERT ->
-- payments trigger -> auto_allocate_payment(oldest first) -> payment_id link.
-- Any failure rolls back the whole operation.
begin;

do $$
begin
  if to_regclass('public.mpesa_stk_requests') is null
     or to_regclass('public.payments') is null
     or to_regclass('public.invoices') is null
     or to_regclass('public.bill_drafts') is null
  then
    raise exception 'Run the Dwellio billing and M-Pesa STK foundation migrations first';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'mpesa_stk_requests'
      and column_name = 'verification_status'
  ) then
    raise exception 'Run mpesa_stk_query_reconciliation_v3.sql before this migration';
  end if;
  if to_regprocedure('public.auto_allocate_payment(uuid)') is null
     or to_regprocedure('public.allocate_payment(uuid,uuid,numeric)') is null
  then
    raise exception 'Missing existing auto_allocate_payment or allocate_payment billing functions';
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname = 'public' and p.proname = 'record_payment'
  ) then
    raise exception 'Missing existing public.record_payment() billing function';
  end if;
end;
$$;

create table if not exists public.mpesa_merchant_confirmations (
  id uuid primary key default gen_random_uuid(),
  stk_request_id uuid not null unique
    references public.mpesa_stk_requests(id) on delete restrict,
  merchant_paybill text not null,
  account_reference text not null,
  receipt_number text not null unique,
  payer_phone text not null,
  confirmed_amount numeric(12,2) not null check (confirmed_amount > 0),
  paid_at timestamptz not null,
  confirmation_source text not null
    check (confirmation_source in ('merchant_transaction_status','merchant_statement')),
  external_evidence_reference text not null
    check (length(btrim(external_evidence_reference)) >= 4),
  evidence_notes text,
  verified_at timestamptz not null default now(),
  verified_by_role text not null default current_user,
  created_at timestamptz not null default now()
);

create unique index if not exists mpesa_stk_payment_id_unique
  on public.mpesa_stk_requests(payment_id)
  where payment_id is not null;

-- A recorded link must actually point to an accounting payment.
do $
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mpesa_stk_requests'::regclass
      and conname = 'mpesa_stk_payment_id_fk'
  ) then
    alter table public.mpesa_stk_requests
      add constraint mpesa_stk_payment_id_fk
      foreign key (payment_id) references public.payments(id) on delete restrict;
  end if;
end;
$;

alter table public.mpesa_merchant_confirmations enable row level security;
revoke all on public.mpesa_merchant_confirmations from public, anon, authenticated;
-- Immutable audit evidence: only authorized reconciliation backend may INSERT.
grant select, insert on public.mpesa_merchant_confirmations to service_role;
revoke update, delete on public.mpesa_merchant_confirmations from service_role;

-- The verification record must come from an authorized merchant transaction
-- result/statement, NOT a direct copy of the public STK callback.
-- The table is private to privileged backend code; no tenant/landlord policies.

create or replace function public.enforce_mpesa_settlement_gate()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_proof public.mpesa_merchant_confirmations%rowtype;
begin
  -- After confirmation, the accounting identity must stay immutable.
  if OLD.status = 'confirmed' then
    if NEW.status is distinct from OLD.status
       or NEW.tenant_id is distinct from OLD.tenant_id
       or NEW.organization_id is distinct from OLD.organization_id
       or NEW.property_id is distinct from OLD.property_id
       or NEW.paybill_shortcode is distinct from OLD.paybill_shortcode
       or NEW.account_reference is distinct from OLD.account_reference
       or NEW.phone_number is distinct from OLD.phone_number
       or NEW.amount is distinct from OLD.amount
       or NEW.mpesa_receipt is distinct from OLD.mpesa_receipt
       or NEW.checkout_request_id is distinct from OLD.checkout_request_id
       or NEW.merchant_request_id is distinct from OLD.merchant_request_id
       or (OLD.payment_id is not null
           and NEW.payment_id is distinct from OLD.payment_id)
    then
      raise exception 'A confirmed M-Pesa payment is immutable';
    end if;
  end if;

  if NEW.status <> 'confirmed' or OLD.status = 'confirmed' then
    return NEW;
  end if;

  if OLD.status <> 'callback_received'
     or NEW.verification_status <> 'query_matched'
     or NEW.callback_result_code is distinct from 0
     or NEW.stk_query_response_code is distinct from '0'
     or NEW.stk_query_result_code is distinct from 0
     or NEW.checkout_request_id is null
     or NEW.merchant_request_id is null
     or NEW.mpesa_receipt is null
     or NEW.payment_id is not null
  then
    raise exception 'Only fully matched and independently reconciled M-Pesa attempts can be settled';
  end if;

  -- Confirm that the ORIGINAL callback & query refer to the stored attempt.
  if NEW.callback_payload #>> '{Body,stkCallback,CheckoutRequestID}'
       is distinct from NEW.checkout_request_id
     or NEW.callback_payload #>> '{Body,stkCallback,MerchantRequestID}'
       is distinct from NEW.merchant_request_id
     or NEW.stk_query_payload ->> 'CheckoutRequestID'
       is distinct from NEW.checkout_request_id
     or NEW.stk_query_payload ->> 'MerchantRequestID'
       is distinct from NEW.merchant_request_id
  then
    raise exception 'Provider callback/query identifiers are inconsistent';
  end if;

  select * into v_proof
  from public.mpesa_merchant_confirmations
  where stk_request_id = NEW.id
  for update;

  if not found then
    raise exception 'Independent merchant confirmation is missing for this STK request';
  end if;

  if v_proof.merchant_paybill is distinct from NEW.paybill_shortcode
     or v_proof.account_reference is distinct from NEW.account_reference
     or v_proof.receipt_number is distinct from NEW.mpesa_receipt
     or v_proof.payer_phone is distinct from NEW.phone_number
     or v_proof.confirmed_amount is distinct from NEW.amount::numeric
  then
    raise exception 'Merchant receipt, PayBill, unit reference, payer or amount mismatch';
  end if;

  if not exists (
    select 1
    from public.properties p
    join public.tenants t on t.organization_id = p.organization_id
    where p.id = NEW.property_id
      and t.id = NEW.tenant_id
      and p.organization_id = NEW.organization_id
  ) then
    raise exception 'M-Pesa tenant/property/organization linkage failed';
  end if;

  -- Current Dwellio auto_allocate_payment is tenant-wide.
  -- Never let money received for one PayBill settle another property's debt.
  if exists (
    select 1 from public.invoices i
    join public.bill_drafts bd on bd.id = i.bill_draft_id
    join public.units u on u.id = bd.unit_id
    join public.floors f on f.id = u.floor_id
    join public.buildings b on b.id = f.building_id
    where i.tenant_id = NEW.tenant_id
      and i.status <> 'void'
      and i.outstanding_amount > 0
      and b.property_id <> NEW.property_id
  ) then
    raise exception 'Cross-property arrears require property-scoped payment allocation';
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_mpesa_settlement_gate on public.mpesa_stk_requests;
create trigger trg_mpesa_settlement_gate
before update on public.mpesa_stk_requests
for each row execute function public.enforce_mpesa_settlement_gate();

-- Second stage: every newly completed payment is automatically allocated to
-- oldest invoices. Other payment methods benefit as well, so record_payment()
-- must NOT separately call auto_allocate_payment during the INSERT transaction.
-- This function is idempotent across repeated status updates.
create or replace function public.allocate_completed_payment_on_insert()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  if NEW.status::text <> 'completed' then return NEW; end if;

  if TG_OP = 'UPDATE' then
    if OLD.status::text = 'completed' then
      return NEW;
    end if;
  end if;

  -- Serialize concurrent completed payment allocations for this tenant.
  perform pg_advisory_xact_lock(
    hashtextextended('dwellio-payments:' || NEW.tenant_id::text, 0)
  );
  perform public.auto_allocate_payment(NEW.id);
  return NEW;
end;
$function$;

drop trigger if exists trg_allocate_completed_payment on public.payments;
create trigger trg_allocate_completed_payment
after insert or update of status on public.payments
for each row execute function public.allocate_completed_payment_on_insert();

-- First stage: a verified status transition inserts a completed accounting
-- payment; the payments trigger above immediately allocates it in this same
-- Postgres transaction. If anything raises an exception, STK confirmation
-- and payment insertion BOTH roll back.
create or replace function public.post_confirmed_mpesa_stk_payment()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_id uuid;
  v_proof public.mpesa_merchant_confirmations%rowtype;
  v_method text;
begin
  if NEW.status <> 'confirmed' or OLD.status = 'confirmed' then
    return NEW;
  end if;
  if NEW.payment_id is not null then
    raise exception 'STK attempt already has a payment_id';
  end if;

  select * into v_proof from public.mpesa_merchant_confirmations
  where stk_request_id = NEW.id;
  if not found then
    raise exception 'Merchant confirmation missing';
  end if;

  -- Existing Dwellio payment_method is an enum. Honor either conventional
  -- mpesa or m_pesa labels; fail if the deployed enum has neither.
  select e.enumlabel into v_method
  from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
    and t.typname = 'payment_method'
    and e.enumlabel in ('mpesa','m_pesa')
  order by case when e.enumlabel = 'mpesa' then 0 else 1 end
  limit 1;

  if v_method is null then
    raise exception 'Add a matching mpesa label to public.payment_method before settling payments';
  end if;

  v_id := public.record_payment(
    NEW.tenant_id,
    NEW.amount::numeric,
    v_method::public.payment_method,
    NEW.mpesa_receipt,
    v_proof.paid_at,
    format('Verified M-Pesa PayBill %s; unit %s; STK %s',
           NEW.paybill_shortcode, NEW.account_reference, NEW.id)
  );

  if v_id is null then
    raise exception 'record_payment returned no payment ID';
  end if;

  -- This inner update doesn't modify the status, so it doesn't create
  -- a second payment. The confirmed STK identity remains immutable.
  update public.mpesa_stk_requests
  set payment_id = v_id, updated_at = now()
  where id = NEW.id and payment_id is null;

  if not found then
    raise exception 'Could not attach created payment to the STK request';
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_mpesa_post_confirmed_payment on public.mpesa_stk_requests;
create trigger trg_mpesa_post_confirmed_payment
after update of status on public.mpesa_stk_requests
for each row
when (NEW.status = 'confirmed' and OLD.status is distinct from NEW.status)
execute function public.post_confirmed_mpesa_stk_payment();

-- Service-role-only (or SQL Editor owner): entry point after the merchant
-- receipt is independently validated and a confirmation row is stored.
-- The public callback never calls this function.
create or replace function public.finalize_merchant_confirmed_mpesa_stk(
  p_stk_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_current public.mpesa_stk_requests%rowtype;
begin
  select * into v_current
  from public.mpesa_stk_requests
  where id = p_stk_request_id
  for update;

  if not found then
    raise exception 'Unknown M-Pesa STK attempt';
  end if;
  if v_current.status = 'confirmed' then
    if v_current.payment_id is null then
      raise exception 'Confirmed STK request has no associated payment: investigate';
    end if;
    return jsonb_build_object('status','already_confirmed',
      'attempt_id',v_current.id,'payment_id',v_current.payment_id);
  end if;

  if v_current.status <> 'callback_received' then
    raise exception 'STK attempt is not eligible for settlement: %', v_current.status;
  end if;

  update public.mpesa_stk_requests
  set status = 'confirmed', completed_at = now(), updated_at = now()
  where id = p_stk_request_id;
  -- Guard + payment creation + auto allocation all execute as triggers here.

  select * into v_current
  from public.mpesa_stk_requests where id = p_stk_request_id;

  if v_current.payment_id is null then
    raise exception 'Confirmed STK request missing payment ID after settlement';
  end if;

  return jsonb_build_object('status','confirmed',
    'attempt_id',v_current.id,'payment_id',v_current.payment_id,
    'receipt',v_current.mpesa_receipt);
end;
$function$;

-- Defense in depth: no browser user can manipulate evidence, invoke the
-- trusted settlement endpoint, or execute internal accounting triggers.
revoke all on function public.enforce_mpesa_settlement_gate() from public, anon, authenticated;
revoke all on function public.allocate_completed_payment_on_insert() from public, anon, authenticated;
revoke all on function public.post_confirmed_mpesa_stk_payment() from public, anon, authenticated;
revoke all on function public.finalize_merchant_confirmed_mpesa_stk(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_merchant_confirmed_mpesa_stk(uuid)
  to service_role;

commit;
