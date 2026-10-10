-- Tenant portal V1: read-only, authenticated snapshot for HOME / LEASE / PROFILE.
-- Run in Supabase SQL Editor. Do not expose this function to anon users.
-- Uses auth.uid(); no client-supplied tenant or lease ID can be used to read
-- another resident's information.

create or replace function public.get_my_tenant_portal()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_tenant public.tenants%rowtype;
  v_lease record;
  v_contact record;
  v_lease_json jsonb;
  v_contact_json jsonb;
  v_balance numeric;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  -- A user may be attached to a tenant in one organization but belong to
  -- another organization as staff. Always resolve through the Auth user ID.
  select t.* into v_tenant
    from public.tenants t
   where t.user_id = v_actor
     and t.deleted_at is null
   order by case when t.status = 'active' then 0 else 1 end, t.created_at desc
   limit 1;

  if not found then
    return null;
  end if;

  -- Prefer an ongoing residence, then a future move-in, then the latest lease.
  select
    l.id as lease_id, l.status as lease_status,
    l.start_date, l.end_date, l.notice_date, l.move_out_date,
    l.rent_amount, l.deposit_amount, l.due_day,
    l.billing_frequency, l.grace_period_days,
    u.name as unit_name, f.name as floor_name, f.floor_number,
    b.name as building_name, p.name as property_name,
    p.address as property_address, p.city as property_city
  into v_lease
  from public.leases l
  join public.units u on u.id = l.unit_id
  join public.floors f on f.id = u.floor_id
  join public.buildings b on b.id = f.building_id
  join public.properties p on p.id = b.property_id
  where l.tenant_id = v_tenant.id and l.deleted_at is null
  order by
    case
      when l.status in ('active', 'notice_given') then 0
      when l.status in ('not_moved_in_yet', 'pending_confirmation') then 1
      else 2
    end,
    l.start_date desc
  limit 1;

  if found then
    v_lease_json := pg_catalog.jsonb_build_object(
      'id', v_lease.lease_id,
      'status', v_lease.lease_status,
      'start_date', v_lease.start_date,
      'end_date', v_lease.end_date,
      'notice_date', v_lease.notice_date,
      'move_out_date', v_lease.move_out_date,
      'rent_amount', v_lease.rent_amount,
      'deposit_amount', v_lease.deposit_amount,
      'due_day', v_lease.due_day,
      'billing_frequency', v_lease.billing_frequency,
      'grace_period_days', v_lease.grace_period_days,
      'unit_name', v_lease.unit_name,
      'floor_name', v_lease.floor_name,
      'floor_number', v_lease.floor_number,
      'building_name', v_lease.building_name,
      'property_name', v_lease.property_name,
      'property_address', v_lease.property_address,
      'property_city', v_lease.property_city
    );
  end if;

  select c.full_name, c.relationship, c.phone
    into v_contact
    from public.tenant_emergency_contacts c
   where c.tenant_id = v_tenant.id
   order by c.created_at asc
   limit 1;

  if found then
    v_contact_json := pg_catalog.jsonb_build_object(
      'full_name', v_contact.full_name,
      'relationship', v_contact.relationship,
      'phone', v_contact.phone
    );
  end if;

  -- Reuse Dwellio's existing outstanding calculation if deployed.
  -- If billing has not yet been connected, return null (never invent a balance).
  if pg_catalog.to_regprocedure('public.get_tenant_outstanding_balance(uuid)') is not null then
    execute 'select public.get_tenant_outstanding_balance($1)'
      into v_balance using v_tenant.id;
  end if;

  return pg_catalog.jsonb_build_object(
    'tenant', pg_catalog.jsonb_build_object(
      'id', v_tenant.id,
      'full_name', v_tenant.full_name,
      'email', v_tenant.email,
      'phone', v_tenant.phone,
      'identification_type', v_tenant.identification_type,
      'masked_identification_number',
        case when v_tenant.identification_number is null then null
             else pg_catalog.repeat('•', greatest(pg_catalog.length(v_tenant.identification_number) - 2, 0))
               || pg_catalog.right(v_tenant.identification_number, 2)
        end,
      'date_of_birth', v_tenant.date_of_birth,
      'status', v_tenant.status
    ),
    'lease', v_lease_json,
    'emergency_contact', v_contact_json,
    'outstanding_balance', v_balance
  );
end;
$function$;

revoke all on function public.get_my_tenant_portal() from public, anon;
grant execute on function public.get_my_tenant_portal() to authenticated;
