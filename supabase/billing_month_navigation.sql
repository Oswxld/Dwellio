-- Dwellio billing month navigation.
-- Apply once in the Supabase SQL Editor after the existing billing tables
-- and public.can_manage_property(uuid) have been created.
-- This does NOT replace the pre-existing 3-argument create_billing_cycle RPC.

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
  v_created_at timestamptz;
  v_period_end date;
  v_cycle_id uuid;
  v_current_month date := date_trunc('month', now() at time zone 'Africa/Nairobi')::date;
begin
  if p_property_id is null or
     not coalesce(public.can_manage_property(p_property_id), false) then
    raise exception 'Not authorized to create billing cycles for this property';
  end if;

  select p.created_at
    into v_created_at
  from public.properties p
  where p.id = p_property_id
    and p.status = 'active'
    and p.deleted_at is null;

  if v_created_at is null then
    raise exception 'Active property not found';
  end if;

  if p_period_start is null
     or p_period_start <> date_trunc('month', p_period_start)::date then
    raise exception 'The billing period must start on the first day of a month';
  end if;

  if p_period_start < v_current_month then
    raise exception 'Past billing cycles cannot be created';
  end if;

  if p_period_start < date_trunc(
    'month', v_created_at at time zone 'Africa/Nairobi'
  )::date then
    raise exception 'Billing cannot start before the property was created';
  end if;

  v_period_end := (p_period_start + interval '1 month - 1 day')::date;

  perform pg_advisory_xact_lock(
    hashtextextended(p_property_id::text || ':' || p_period_start::text, 0)
  );

  select bc.id
    into v_cycle_id
  from public.billing_cycles bc
  where bc.property_id = p_property_id
    and bc.period_start = p_period_start
  limit 1;

  if v_cycle_id is not null then
    return v_cycle_id;
  end if;

  insert into public.billing_cycles (
    property_id, period_start, period_end, status, created_by
  )
  values (
    p_property_id, p_period_start, v_period_end, 'draft', auth.uid()
  )
  returning id into v_cycle_id;

  return v_cycle_id;
end;
$function$;

revoke all on function public.create_billing_cycle_for_month(uuid, date) from public;
grant execute on function public.create_billing_cycle_for_month(uuid, date) to authenticated;

-- Also protect inserts performed by the original 3-argument function.
-- Existing cycles are untouched; the guard only applies to new rows.
create or replace function public.guard_billing_cycle_month_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_created_at timestamptz;
  v_current_month date := date_trunc('month', now() at time zone 'Africa/Nairobi')::date;
begin
  select p.created_at
    into v_created_at
  from public.properties p
  where p.id = new.property_id;

  if v_created_at is null then
    raise exception 'Property not found for billing cycle';
  end if;

  if new.period_start is null
     or new.period_start <> date_trunc('month', new.period_start)::date then
    raise exception 'The billing period must start on the first day of a month';
  end if;

  if new.period_end is null
     or new.period_end <> (new.period_start + interval '1 month - 1 day')::date then
    raise exception 'The billing period must end on the final day of the month';
  end if;

  if new.period_start < v_current_month then
    raise exception 'Past billing cycles cannot be created';
  end if;

  if new.period_start < date_trunc(
    'month', v_created_at at time zone 'Africa/Nairobi'
  )::date then
    raise exception 'Billing cannot start before the property was created';
  end if;

  return new;
end;
$function$;

drop trigger if exists guard_billing_cycle_month_insert
  on public.billing_cycles;

create trigger guard_billing_cycle_month_insert
before insert on public.billing_cycles
for each row execute function public.guard_billing_cycle_month_insert();

notify pgrst, 'reload schema';

commit;
