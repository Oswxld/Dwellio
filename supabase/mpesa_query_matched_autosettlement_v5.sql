-- Dwellio V1: automatically settle a corroborated STK Push (SANDBOX ONLY).
--
-- Run AFTER:
--   1. mpesa_multi_landlord_foundation_v1.sql
--   2. mpesa_unit_account_reference_v2.sql
--   3. mpesa_stk_query_reconciliation_v3.sql
--   4. mpesa_verified_settlement_v4.sql  (corrected dollar-quoting in GitHub)
--
-- V1 acceptance policy: BOTH Safaricom callback and authenticated STK Query
-- report ResultCode 0 for the original CheckoutRequestID/MerchantRequestID.
-- Callback Amount, PhoneNumber and Receipt must also match the stored request
-- and be unique. STK Query doesn't return Amount/Receipt independently:
-- this is an intentional V1 trust tradeoff, not full merchant reconciliation.
--
-- The trusted callback Edge Function calls the service_role-only
-- finalize_query_matched_mpesa_stk RPC after storing matching query evidence.
-- A SINGLE postgres transaction: confirm STK, record_payment completed,
-- payments trigger auto_allocate_payment oldest-first, attach payment ID.
-- Merchant proof table from V4 remains unused for V1 (not dropped).
begin;

do $$
begin
  if to_regprocedure('public.finalize_merchant_confirmed_mpesa_stk(uuid)') is null
     or to_regclass('public.mpesa_stk_requests') is null
     or to_regclass('public.payments') is null
  then
    raise exception 'Apply the corrected mpesa_verified_settlement_v4.sql first';
  end if;
  if to_regprocedure('public.auto_allocate_payment(uuid)') is null then
    raise exception 'Missing auto_allocate_payment(uuid)';
  end if;
end;
$$;

-- This trigger guards the change to "confirmed" even when some privileged
-- code writes to the table directly, without using our finalization RPC.
create or replace function public.enforce_mpesa_settlement_gate()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_items jsonb;
  v_amount text;
  v_phone text;
  v_receipt text;
  v_count integer;
begin
  -- A confirmed transaction's accounting identity cannot be changed,
  -- except filling payment_id exactly once in the existing after trigger.
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
      raise exception 'Confirmed M-Pesa accounting identity is immutable';
    end if;
    return NEW;
  end if;

  if NEW.status <> 'confirmed' then
    return NEW;
  end if;

  if OLD.status <> 'callback_received'
     or NEW.id is distinct from OLD.id
     or NEW.tenant_id is distinct from OLD.tenant_id
     or NEW.organization_id is distinct from OLD.organization_id
     or NEW.property_id is distinct from OLD.property_id
     or NEW.paybill_shortcode is distinct from OLD.paybill_shortcode
     or NEW.account_reference is distinct from OLD.account_reference
     or NEW.phone_number is distinct from OLD.phone_number
     or NEW.amount is distinct from OLD.amount
     or NEW.checkout_request_id is distinct from OLD.checkout_request_id
     or NEW.merchant_request_id is distinct from OLD.merchant_request_id
     or NEW.mpesa_receipt is distinct from OLD.mpesa_receipt
     or NEW.verification_status <> 'query_matched'
     or OLD.verification_status <> 'query_matched'
     or NEW.callback_result_code is distinct from 0
     or NEW.stk_query_response_code is distinct from '0'
     or NEW.stk_query_result_code is distinct from 0
     or NEW.checkout_request_id is null
     or NEW.merchant_request_id is null
     or NEW.mpesa_receipt is null
     or NEW.payment_id is not null
  then
    raise exception 'STK must have matched callback and Safaricom query evidence';
  end if;

  -- Check the stored RAW callback and status query, not just derived columns.
  if NEW.callback_payload #>> '{Body,stkCallback,CheckoutRequestID}'
       is distinct from NEW.checkout_request_id
     or NEW.callback_payload #>> '{Body,stkCallback,MerchantRequestID}'
       is distinct from NEW.merchant_request_id
     or NEW.callback_payload #>> '{Body,stkCallback,ResultCode}'
       is distinct from '0'
     or NEW.stk_query_payload ->> 'CheckoutRequestID'
       is distinct from NEW.checkout_request_id
     or NEW.stk_query_payload ->> 'MerchantRequestID'
       is distinct from NEW.merchant_request_id
     or NEW.stk_query_payload ->> 'ResponseCode' is distinct from '0'
     or NEW.stk_query_payload ->> 'ResultCode' is distinct from '0'
  then
    raise exception 'Raw Safaricom transaction IDs/result codes do not match';
  end if;

  -- Independent query confirms SUCCESS, but does not return amount or receipt.
  -- Require callback amount/phone/receipt to match the original Dwellio
  -- request so a malformed or contradictory callback cannot book money.
  v_items := NEW.callback_payload #> '{Body,stkCallback,CallbackMetadata,Item}';
  if jsonb_typeof(v_items) is distinct from 'array' then
    raise exception 'Callback payment metadata missing';
  end if;

  select count(*), min(x ->> 'Value') into v_count, v_amount
    from jsonb_array_elements(v_items) x
    where x ->> 'Name' = 'Amount';
  if v_count <> 1 or coalesce(v_amount,'') !~ '^[0-9]+(\.0+)?$'
     or v_amount::numeric is distinct from NEW.amount::numeric
  then raise exception 'Callback amount differs from requested STK amount'; end if;

  select count(*), min(x ->> 'Value') into v_count, v_phone
    from jsonb_array_elements(v_items) x
    where x ->> 'Name' = 'PhoneNumber';
  if v_count <> 1 or v_phone is distinct from NEW.phone_number then
    raise exception 'Callback payer phone differs from requested STK phone';
  end if;

  select count(*), min(x ->> 'Value') into v_count, v_receipt
    from jsonb_array_elements(v_items) x
    where x ->> 'Name' = 'MpesaReceiptNumber';
  if v_count <> 1
     or v_receipt is distinct from NEW.mpesa_receipt
     or coalesce(v_receipt,'') !~ '^[A-Za-z0-9]{5,32}$'
  then raise exception 'Callback receipt missing or inconsistent'; end if;

  if exists (
    select 1 from public.mpesa_stk_requests r
    where r.mpesa_receipt = NEW.mpesa_receipt and r.id <> NEW.id
  ) then
    raise exception 'M-Pesa receipt is already associated with another attempt';
  end if;

  -- The receiving merchant and tenant must belong to the original property.
  if not exists (
    select 1
    from public.properties p
    join public.tenants t on t.organization_id = p.organization_id
    join public.mpesa_property_settings cfg on cfg.property_id = p.id
    where p.id = NEW.property_id
      and p.organization_id = NEW.organization_id
      and t.id = NEW.tenant_id
      and cfg.paybill_shortcode = NEW.paybill_shortcode
      and cfg.setup_status = 'sandbox_ready'
  ) then
    raise exception 'STK PayBill, property, organization or tenant mismatch';
  end if;

  -- Current Dwellio auto_allocate_payment is tenant-wide. Never credit a
  -- payment to another property that may use a different landlord PayBill.
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
    raise exception 'Cross-property arrears require property-scoped allocation';
  end if;

  return NEW;
end;
$function$;

-- Reuse V4's payments trigger and accounting flow. Only remove the
-- requirement to look up a separate merchant confirmation record.
create or replace function public.post_confirmed_mpesa_stk_payment()
returns trigger
language plpgsql security definer set search_path = ''
as $function$
declare
  v_id uuid;
  v_method text;
begin
  if NEW.status <> 'confirmed' or OLD.status = 'confirmed' then
    return NEW;
  end if;
  if NEW.payment_id is not null then
    raise exception 'STK attempt already has payment ID';
  end if;

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
    raise exception 'The payment_method enum needs an mpesa or m_pesa value';
  end if;

  v_id := public.record_payment(
    NEW.tenant_id,
    NEW.amount::numeric,
    v_method::public.payment_method,
    NEW.mpesa_receipt,
    now(),
    format('V1 STK Query verified; PayBill %s; unit %s; STK %s',
           NEW.paybill_shortcode, NEW.account_reference, NEW.id)
  );
  if v_id is null then raise exception 'record_payment returned null ID'; end if;

  -- record_payment inserts completed payment -> existing V4 payments
  -- trigger calls auto_allocate_payment() in this same transaction.
  update public.mpesa_stk_requests
  set payment_id = v_id, updated_at = now()
  where id = NEW.id and payment_id is null;
  if not found then
    raise exception 'Could not link payment to STK request';
  end if;

  return NEW;
end;
$function$;

-- This RPC is only invoked by the trusted Edge Function's service-role client.
-- Row lock makes repeated/parallel callbacks idempotent and serializes posting.
create or replace function public.finalize_query_matched_mpesa_stk(
  p_stk_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_attempt public.mpesa_stk_requests%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required for automatic M-Pesa settlement';
  end if;

  select * into v_attempt
  from public.mpesa_stk_requests
  where id = p_stk_request_id
  for update;

  if not found then raise exception 'STK attempt not found'; end if;

  if v_attempt.status = 'confirmed' then
    if v_attempt.payment_id is null then
      raise exception 'Confirmed STK has no payment ID; investigate';
    end if;
    return jsonb_build_object('status','already_confirmed',
      'attempt_id',v_attempt.id,'payment_id',v_attempt.payment_id);
  end if;

  if v_attempt.status <> 'callback_received'
     or v_attempt.verification_status <> 'query_matched'
  then
    raise exception 'STK callback and Safaricom query have not both matched';
  end if;

  -- Guard + record_payment trigger + payments auto-allocation trigger all run
  -- in the same PostgreSQL transaction. Any failure rolls everything back.
  update public.mpesa_stk_requests
  set status = 'confirmed', completed_at = now(), updated_at = now()
  where id = p_stk_request_id;

  select * into v_attempt from public.mpesa_stk_requests
  where id = p_stk_request_id;
  if v_attempt.payment_id is null then
    raise exception 'Failed to attach accounting payment to confirmed STK';
  end if;

  return jsonb_build_object('status','confirmed',
    'attempt_id',v_attempt.id,'payment_id',v_attempt.payment_id,
    'receipt',v_attempt.mpesa_receipt);
end;
$function$;

-- Deprecate the V4 path so no stale code can bypass the new V1 policy.
create or replace function public.finalize_merchant_confirmed_mpesa_stk(
  p_stk_request_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
begin
  raise exception 'Deprecated: use finalize_query_matched_mpesa_stk via trusted Edge Function';
end;
$function$;

revoke all on function public.finalize_query_matched_mpesa_stk(uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_query_matched_mpesa_stk(uuid)
  to service_role;
revoke all on function public.finalize_merchant_confirmed_mpesa_stk(uuid)
  from public, anon, authenticated, service_role;

commit;
