-- Dwellio billing workflow: cycle-aware meter readings
-- Apply this in Supabase before using the new Meter Readings step.

begin;

alter table public.meter_readings
  add column if not exists billing_cycle_id uuid;

alter table public.meter_readings
  add column if not exists reading_type text;

-- Existing Dwellio-created readings were opening/baseline readings because
-- the previous UI only created readings while configuring new meters.
update public.meter_readings
set reading_type = 'opening'
where reading_type is null;

alter table public.meter_readings
  alter column reading_type set default 'opening';

alter table public.meter_readings
  alter column reading_type set not null;

-- Add the FK only when it does not already exist.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meter_readings_billing_cycle_id_fkey'
      and conrelid = 'public.meter_readings'::regclass
  ) then
    alter table public.meter_readings
      add constraint meter_readings_billing_cycle_id_fkey
      foreign key (billing_cycle_id)
      references public.billing_cycles(id)
      on delete restrict;
  end if;
end
$$;

-- Opening readings are intentionally not attached to a billing cycle.
-- Periodic readings always belong to exactly one billing cycle.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meter_readings_reading_type_check'
      and conrelid = 'public.meter_readings'::regclass
  ) then
    alter table public.meter_readings
      add constraint meter_readings_reading_type_check
      check (
        (reading_type = 'opening' and billing_cycle_id is null)
        or
        (reading_type = 'periodic' and billing_cycle_id is not null)
      );
  end if;
end
$$;

-- PostgreSQL UNIQUE allows multiple NULL billing_cycle_id values, which is
-- exactly what we want for opening readings while guaranteeing one current
-- reading per meter per billing cycle.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'meter_readings_meter_cycle_key'
      and conrelid = 'public.meter_readings'::regclass
  ) then
    alter table public.meter_readings
      add constraint meter_readings_meter_cycle_key
      unique (meter_id, billing_cycle_id);
  end if;
end
$$;

create index if not exists meter_readings_cycle_idx
  on public.meter_readings (billing_cycle_id, meter_id);

create index if not exists meter_readings_meter_date_idx
  on public.meter_readings (meter_id, reading_date desc);

-- Keep the existing frontend meter setup compatible: it omits reading_type
-- and billing_cycle_id, so the default remains `opening` with a NULL cycle.

-- RLS for the monthly readings workflow.
drop policy if exists "meter_readings_select_property_staff"
  on public.meter_readings;

create policy "meter_readings_select_property_staff"
on public.meter_readings
for select
to authenticated
using (
  exists (
    select 1
    from public.meters m
    join public.units u
      on u.id = m.unit_id
    where m.id = meter_id
      and can_work_property(u.property_id)
  )
);

drop policy if exists "meter_readings_insert_property_staff"
  on public.meter_readings;

create policy "meter_readings_insert_property_staff"
on public.meter_readings
for insert
to authenticated
with check (
  recorded_by = auth.uid()
  and exists (
    select 1
    from public.meters m
    join public.units u
      on u.id = m.unit_id
    where m.id = meter_id
      and can_work_property(u.property_id)
  )
);

drop policy if exists "meter_readings_update_property_staff"
  on public.meter_readings;

create policy "meter_readings_update_property_staff"
on public.meter_readings
for update
to authenticated
using (
  exists (
    select 1
    from public.meters m
    join public.units u
      on u.id = m.unit_id
    where m.id = meter_id
      and can_work_property(u.property_id)
  )
)
with check (
  recorded_by = auth.uid()
  and exists (
    select 1
    from public.meters m
    join public.units u
      on u.id = m.unit_id
    where m.id = meter_id
      and can_work_property(u.property_id)
  )
);

-- Guarded repair for the determine_billing_context error discovered during
-- October draft generation. If move_out_date is still text, normalize it.
do $$
declare
  v_type text;
begin
  select data_type
  into v_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'leases'
    and column_name = 'move_out_date';

  if v_type = 'text' then
    execute '
      alter table public.leases
      alter column move_out_date type date
      using nullif(move_out_date, '''')::date
    ';
  end if;
end
$$;

commit;
