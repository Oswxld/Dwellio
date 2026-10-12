-- Dwellio: property-scoped billing-cycle creation for the current or a future month.
-- Run after supabase/billing_readings_workflow.sql.
begin;

create or replace function public.create_billing_cycle_for_month(
  p_property_id uuid,
  p_period_start date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_property_created_at timestamptz;
  v_start date;
  v_end date;
  v_cycle_id uuid;
begin
  if not public.can_work_property(p_property_id) then
    raise exception 'Not authorized to create billing cycles for this property';
  end if;

  select created_at into v_property_created_at
  from public.properties
  where id = p_property_id
    and status = 'active'
    and deleted_at is null;

  if v_property_created_at is null then
    raise exception 'Active property not found';
  end if;

  if p_period_start is null or
     p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'The billing period must start on the first day of a month';
  end if;

  v_start := p_period_start;
  v_end := (v_start + interval '1 month - 1 day')::date;

  if v_start < date_trunc('month', current_date)::date then
    raise exception 'Past billing cycles cannot be created';
  end if;

  if v_start < date_trunc('month', v_property_created_at at time zone 'Africa/Nairobi')::date then
    raise exception 'Billing cannot start before the property was created';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_property_id::text || ':' || v_start::text, 0)
  );

  select id into v_cycle_id
  from public.billing_cycles
  where property_id = p_property_id
    and period_start = v_start
  limit 1;

  if v_cycle_id is not null then
    return v_cycle_id;
  end if;

  insert into public.billing_cycles (
    property_id, period_start, period_end, status, created_by
  ) values (
    p_property_id, v_start, v_end, 'draft', auth.uid()
  ) returning id into v_cycle_id;

  return v_cycle_id;
end;
$function$;

revoke all on function public.create_billing_cycle_for_month(uuid, date) from public;
grant execute on function public.create_billing_cycle_for_month(uuid, date) to authenticated;

-- The original RPC is kept for existing callers but now delegates to
-- the protected month-aware RPC, preserving the rules for old clients.
create or replace function public.create_billing_cycle(p_property_id uuid)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $function$
  select public.create_billing_cycle_for_month(
    p_property_id,
    date_trunc('month', current_date)::date
  );
$function$;

revoke all on function public.create_billing_cycle(uuid) from public;
grant execute on function public.create_billing_cycle(uuid) to authenticated;

commit;
