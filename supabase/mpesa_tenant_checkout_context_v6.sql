-- Dwellio Tenant M-Pesa checkout context (v6, sandbox).
-- Run AFTER v1 foundation, v2 unit reference, v3 query, v4 settlement and v5.
-- Returns only the authenticated tenant's PayBill and current unit; never
-- returns credentials, Vault IDs or callback tokens.
begin;

create or replace function public.get_my_mpesa_checkout_context(
  p_invoice_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_invoice_tenant uuid;
  v_invoice_property uuid;
  v_units integer;
  v_tenant uuid;
  v_property uuid;
  v_property_name text;
  v_unit text;
  v_phone text;
  v_paybill text;
  v_setup text;
  v_has_credentials boolean;
  v_balance numeric;
begin
  if v_actor is null then raise exception 'Sign in required'; end if;

  -- Details screen may identify a particular invoice. Do NOT trust a
  -- client-supplied property ID or let an unrelated invoice resolve a PayBill.
  if p_invoice_id is not null then
    select bd.tenant_id, b.property_id
      into v_invoice_tenant, v_invoice_property
    from public.invoices i
    join public.bill_drafts bd on bd.id = i.bill_draft_id
    join public.tenants t on t.id = bd.tenant_id
    join public.units u on u.id = bd.unit_id
    join public.floors f on f.id = u.floor_id
    join public.buildings b on b.id = f.building_id
    where i.id = p_invoice_id and i.status <> 'void'
      and t.user_id = v_actor and t.deleted_at is null;
    if not found then raise exception 'Invoice is not available to your account'; end if;
  end if;

  select count(distinct u.id) into v_units
  from public.tenants t
  join public.leases l on l.tenant_id = t.id and l.deleted_at is null
  join public.units u on u.id = l.unit_id and u.deleted_at is null
  join public.floors f on f.id = u.floor_id
  join public.buildings b on b.id = f.building_id
  join public.properties p on p.id = b.property_id and p.deleted_at is null
  where t.user_id = v_actor and t.deleted_at is null and t.status = 'active'
    and l.status::text in ('active','notice_given','not_moved_in_yet')
    and (v_invoice_tenant is null or t.id = v_invoice_tenant)
    and (v_invoice_property is null or p.id = v_invoice_property);

  if v_units <> 1 then
    return jsonb_build_object(
      'available', false,
      'message', case when v_units = 0
        then 'No current unit could be linked to this invoice and tenant.'
        else 'Several current units are linked. Open the specific invoice or contact management.'
      end
    );
  end if;

  select t.id, p.id, p.name, btrim(u.name), t.phone,
         cfg.paybill_shortcode, cfg.setup_status,
         (cfg.credential_secret_id is not null)
    into v_tenant, v_property, v_property_name, v_unit, v_phone,
         v_paybill, v_setup, v_has_credentials
  from public.tenants t
  join public.leases l on l.tenant_id = t.id and l.deleted_at is null
  join public.units u on u.id = l.unit_id and u.deleted_at is null
  join public.floors f on f.id = u.floor_id
  join public.buildings b on b.id = f.building_id
  join public.properties p on p.id = b.property_id and p.deleted_at is null
  left join public.mpesa_property_settings cfg
    on cfg.property_id = p.id and cfg.organization_id = p.organization_id
  where t.user_id = v_actor and t.deleted_at is null and t.status = 'active'
    and t.organization_id = p.organization_id
    and l.status::text in ('active','notice_given','not_moved_in_yet')
    and (v_invoice_tenant is null or t.id = v_invoice_tenant)
    and (v_invoice_property is null or p.id = v_invoice_property)
  order by l.start_date desc
  limit 1;

  if v_tenant is null then
    return jsonb_build_object('available',false,
      'message','Your tenancy cannot be linked to the receiving property.');
  end if;

  v_balance := public.get_tenant_outstanding_balance(v_tenant);

  return jsonb_build_object(
    'available', v_setup = 'sandbox_ready' and v_has_credentials
        and v_unit ~ '^[A-Za-z0-9-]{1,12}$',
    'property_id', v_property,
    'property_name', v_property_name,
    'unit_number', v_unit,
    'paybill_shortcode', v_paybill,
    'setup_status', coalesce(v_setup, 'not_configured'),
    'phone_number', v_phone,
    'outstanding_balance', coalesce(v_balance, 0),
    'message', case
      when v_setup is distinct from 'sandbox_ready' or not coalesce(v_has_credentials,false)
        then 'M-Pesa checkout has not been activated for this property.'
      when v_unit !~ '^[A-Za-z0-9-]{1,12}$'
        then 'The unit number is not in a valid M-Pesa account reference format.'
      else null
    end
  );
end;
$function$;

-- Show an unfinished payment when the tenant reopens the checkout.
-- Prevent accidental repeat prompts after a page refresh.
create or replace function public.get_my_recent_mpesa_stk(
  p_property_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_attempt public.mpesa_stk_requests%rowtype;
begin
  if v_actor is null then raise exception 'Sign in required'; end if;

  select r.* into v_attempt
  from public.mpesa_stk_requests r
  join public.tenants t on t.id = r.tenant_id
  where t.user_id = v_actor and t.deleted_at is null
    and r.property_id = p_property_id
    and r.status in ('initiating','awaiting_callback','callback_received','needs_review')
    and r.created_at > now() - interval '24 hours'
  order by r.created_at desc limit 1;

  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_attempt.id, 'status', v_attempt.status,
    'amount', v_attempt.amount,
    'created_at', v_attempt.created_at,
    'account_reference', v_attempt.account_reference,
    'paybill_shortcode', v_attempt.paybill_shortcode
  );
end;
$function$;

-- Keep the existing authenticated status RPC compatible with older screens,
-- but add settlement fields necessary to report when rent is actually credited.
create or replace function public.get_my_mpesa_stk_status(p_attempt_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  r public.mpesa_stk_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into r from public.mpesa_stk_requests
  where id = p_attempt_id and tenant_id in (
    select id from public.tenants where user_id = auth.uid() and deleted_at is null
  ) limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'id',r.id, 'status',r.status, 'amount',r.amount,
    'paybill_shortcode',r.paybill_shortcode,
    'account_reference',r.account_reference,
    'created_at',r.created_at, 'result_code',r.callback_result_code,
    'result_description',r.callback_result_description,
    'verification_status',r.verification_status,
    'payment_id',r.payment_id, 'receipt',r.mpesa_receipt
  );
end;
$function$;

revoke all on function public.get_my_mpesa_checkout_context(uuid)
  from public, anon, authenticated;
revoke all on function public.get_my_recent_mpesa_stk(uuid)
  from public, anon, authenticated;
revoke all on function public.get_my_mpesa_stk_status(uuid)
  from public, anon, authenticated;

grant execute on function public.get_my_mpesa_checkout_context(uuid) to authenticated;
grant execute on function public.get_my_recent_mpesa_stk(uuid) to authenticated;
grant execute on function public.get_my_mpesa_stk_status(uuid) to authenticated;

commit;
