-- DWELLIO | MOVE-OUT INSPECTIONS — EXISTING SCHEMA COMPATIBLE (v2)
-- Your original table has: lease_id, unit_id, inspected_by,
-- inspection_date (timestamptz), status (inspection_status enum, 'pending'),
-- notes, created_at and updated_at.
-- PRESERVE those columns, enum, existing rows, and existing permissions.
-- Extend with tenant_id, organization_id and completed_at for settlement.
-- Apply this entire file in Supabase SQL Editor. Atomic: failure rolls back.
-- No deposit, invoice, lease or unit is modified by this migration.

begin;

-- Existing inspection_status enum uses 'pending'. Add a completed lifecycle
-- label if missing, without altering the column type or converting old rows.
alter type public.inspection_status add value if not exists 'completed';

create table if not exists public.move_out_inspections (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references public.leases(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  inspected_by uuid references auth.users(id),
  inspection_date timestamptz,
  status public.inspection_status not null default 'pending'::public.inspection_status,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only extend the original inspection schema. Do not introduce a second
-- status field or duplicate inspected_at/created_by fields.
alter table public.move_out_inspections
  add column if not exists tenant_id uuid references public.tenants(id),
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists completed_at timestamptz;

-- Derive missing identity from the linked lease. Keep populated values
-- unchanged so inconsistent historical records are detected, not reassigned.
update public.move_out_inspections i
   set tenant_id = coalesce(i.tenant_id, l.tenant_id),
       organization_id = coalesce(i.organization_id, l.organization_id)
  from public.leases l
 where l.id = i.lease_id
   and (i.tenant_id is null or i.organization_id is null);

do $verify$
begin
  if exists (
    select 1 from public.move_out_inspections i
    where i.tenant_id is null or i.organization_id is null
  ) then
    raise exception 'Existing inspection references a missing lease; cannot derive tenant or organization';
  end if;
  if exists (
    select 1 from public.move_out_inspections i
    left join public.leases l on l.id = i.lease_id
    where l.id is null
       or i.tenant_id is distinct from l.tenant_id
       or i.unit_id is distinct from l.unit_id
       or i.organization_id is distinct from l.organization_id
  ) then
    raise exception 'Existing inspection disagrees with its lease tenant, unit or organization. Review the original record before migrating';
  end if;
end;
$verify$;

alter table public.move_out_inspections
  alter column tenant_id set not null,
  alter column organization_id set not null;

-- Exactly one inspection per lease in the current Dwellio workflow.
-- Duplicate legacy inspections must be reconciled, never discarded.
create unique index if not exists move_out_inspections_one_per_lease
  on public.move_out_inspections(lease_id);
create index if not exists move_out_inspections_org_idx
  on public.move_out_inspections(organization_id);

create table if not exists public.move_out_inspection_bills (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.move_out_inspections(id) on delete restrict,
  title text not null check (length(btrim(title)) between 2 and 150),
  description text,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

-- Existing charge tables may also have partial schema.
alter table public.move_out_inspection_bills
  add column if not exists inspection_id uuid references public.move_out_inspections(id),
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists amount numeric(14,2),
  add column if not exists created_at timestamptz default now();

do $verify$
begin
  if exists (
    select 1 from public.move_out_inspection_bills b
    where b.inspection_id is null or nullif(btrim(b.title),'') is null
       or b.amount is null or b.amount <= 0
  ) then
    raise exception 'An existing inspection charge lacks an inspection, title or positive amount. Resolve legacy charge data first';
  end if;
end;
$verify$;

alter table public.move_out_inspection_bills
  alter column inspection_id set not null,
  alter column title set not null,
  alter column amount set not null;
create index if not exists move_out_bills_inspection_idx
  on public.move_out_inspection_bills(inspection_id);

-- Property organization is resolved from
-- units.floor_id -> floors.building_id -> buildings.property_id ->
-- properties.organization_id. units.property_id is nullable.
create or replace function public.move_out_inspection_matches_property(
  p_lease_id uuid, p_tenant_id uuid, p_unit_id uuid, p_organization_id uuid
) returns boolean
language sql stable security definer set search_path = ''
as $match$
  select exists (
    select 1
    from public.leases l
    join public.tenants t on t.id = l.tenant_id
    join public.units u on u.id = l.unit_id
    join public.floors f on f.id = u.floor_id
    join public.buildings b on b.id = f.building_id
    join public.properties p on p.id = b.property_id
    where l.id = p_lease_id
      and l.tenant_id = p_tenant_id
      and l.unit_id = p_unit_id
      and l.organization_id = p_organization_id
      and t.organization_id = p_organization_id
      and p.organization_id = p_organization_id
      and l.deleted_at is null
      and t.deleted_at is null
      and u.deleted_at is null
      and f.deleted_at is null
      and b.deleted_at is null
      and p.deleted_at is null
  );
$match$;

-- Check historical rows ONLY after extending the table.
do $verify$
begin
  if exists (
    select 1 from public.move_out_inspections i
    where not public.move_out_inspection_matches_property(
      i.lease_id,i.tenant_id,i.unit_id,i.organization_id
    )
  ) then
    raise exception 'Existing inspection has inconsistent tenant, unit or property ownership. Correct the specific record first';
  end if;
end;
$verify$;

-- Preserve status as the existing inspection_status enum.
-- pending -> completed is the only transition performed by this workflow.
-- We never change the existing inspected_by or inspection_date column names.
create or replace function public.guard_move_out_inspection()
returns trigger language plpgsql set search_path = ''
as $guard$
begin
  if tg_op = 'UPDATE' then
    if old.status::text <> 'pending' then
      raise exception 'Only pending inspections can be modified';
    end if;
    if new.id is distinct from old.id
       or new.lease_id is distinct from old.lease_id
       or new.tenant_id is distinct from old.tenant_id
       or new.unit_id is distinct from old.unit_id
       or new.organization_id is distinct from old.organization_id
       or new.inspected_by is distinct from old.inspected_by
       or new.created_at is distinct from old.created_at
    then
      raise exception 'Inspection identity or inspector cannot be changed';
    end if;
    if new.status::text not in ('pending','completed') then
      raise exception 'Unsupported inspection lifecycle transition';
    end if;
    if new.status::text = 'completed' then
      new.completed_at := now();
    elsif new.completed_at is not null then
      raise exception 'Pending inspection cannot have a completion timestamp';
    end if;
  else
    if new.status::text <> 'pending' or new.completed_at is not null then
      raise exception 'New move-out inspection must start pending';
    end if;
  end if;

  if not public.move_out_inspection_matches_property(
      new.lease_id,new.tenant_id,new.unit_id,new.organization_id
    ) then
    raise exception 'Inspection lease, tenant, unit or organization mismatch';
  end if;
  new.updated_at := now();
  return new;
end;
$guard$;

drop trigger if exists guard_move_out_inspection_row
  on public.move_out_inspections;
create trigger guard_move_out_inspection_row
before insert or update on public.move_out_inspections
for each row execute function public.guard_move_out_inspection();

create or replace function public.guard_move_out_inspection_charge()
returns trigger language plpgsql set search_path = ''
as $guard$
declare
  v_id uuid;
  v_status text;
begin
  v_id := case when tg_op = 'DELETE' then old.inspection_id else new.inspection_id end;
  select i.status::text into v_status
    from public.move_out_inspections i where i.id=v_id for update;
  if v_status is distinct from 'pending' then
    raise exception 'Only pending inspections accept charge changes';
  end if;
  if tg_op='UPDATE' and new.inspection_id is distinct from old.inspection_id then
    raise exception 'Cannot move charges to another inspection';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$guard$;

drop trigger if exists guard_move_out_inspection_charge_row
  on public.move_out_inspection_bills;
create trigger guard_move_out_inspection_charge_row
before insert or update or delete on public.move_out_inspection_bills
for each row execute function public.guard_move_out_inspection_charge();

alter table public.move_out_inspections enable row level security;
alter table public.move_out_inspection_bills enable row level security;

drop policy if exists move_out_inspections_read on public.move_out_inspections;
drop policy if exists move_out_inspections_insert on public.move_out_inspections;
drop policy if exists move_out_inspections_update on public.move_out_inspections;
drop policy if exists move_out_bills_read on public.move_out_inspection_bills;
drop policy if exists move_out_bills_insert on public.move_out_inspection_bills;
drop policy if exists move_out_bills_update on public.move_out_inspection_bills;
drop policy if exists move_out_bills_delete on public.move_out_inspection_bills;

create policy move_out_inspections_read
on public.move_out_inspections for select to authenticated
using (
  public.is_org_admin(organization_id)
  and public.move_out_inspection_matches_property(
    lease_id,tenant_id,unit_id,organization_id
  )
);

create policy move_out_inspections_insert
on public.move_out_inspections for insert to authenticated
with check (
  inspected_by = (select auth.uid())
  and public.is_org_admin(organization_id)
  and public.move_out_inspection_matches_property(
    lease_id,tenant_id,unit_id,organization_id
  )
  and exists (
    select 1 from public.leases l
    where l.id=lease_id and l.status::text in ('active','notice_given','expired')
  )
  and status::text = 'pending'
);

create policy move_out_inspections_update
on public.move_out_inspections for update to authenticated
using (public.is_org_admin(organization_id) and status::text='pending')
with check (
  public.is_org_admin(organization_id)
  and public.move_out_inspection_matches_property(
    lease_id,tenant_id,unit_id,organization_id
  )
  and status::text in ('pending','completed')
);

create policy move_out_bills_read
on public.move_out_inspection_bills for select to authenticated
using (
  exists (
    select 1 from public.move_out_inspections i
    where i.id = inspection_id and public.is_org_admin(i.organization_id)
  )
);
create policy move_out_bills_insert
on public.move_out_inspection_bills for insert to authenticated
with check (
  exists (
    select 1 from public.move_out_inspections i
    where i.id = inspection_id and i.status::text='pending'
      and public.is_org_admin(i.organization_id)
  )
);
create policy move_out_bills_update
on public.move_out_inspection_bills for update to authenticated
using (
  exists (
    select 1 from public.move_out_inspections i
    where i.id = inspection_id and i.status::text='pending'
      and public.is_org_admin(i.organization_id)
  )
)
with check (
  exists (
    select 1 from public.move_out_inspections i
    where i.id = inspection_id and i.status::text='pending'
      and public.is_org_admin(i.organization_id)
  )
);
create policy move_out_bills_delete
on public.move_out_inspection_bills for delete to authenticated
using (
  exists (
    select 1 from public.move_out_inspections i
    where i.id = inspection_id and i.status::text='pending'
      and public.is_org_admin(i.organization_id)
  )
);

-- Do not broadly REVOKE privileges on an existing production table that
-- other inspections may already use. These grants enable Dwellio clients;
-- RLS and immutable identity trigger enforce the workflow boundaries.
grant select,insert on public.move_out_inspections to authenticated;
grant update (inspection_date,notes,status,completed_at,updated_at)
  on public.move_out_inspections to authenticated;
grant select,insert,update,delete on public.move_out_inspection_bills to authenticated;

revoke all on function public.move_out_inspection_matches_property(uuid,uuid,uuid,uuid)
  from public,anon;
grant execute on function public.move_out_inspection_matches_property(uuid,uuid,uuid,uuid)
  to authenticated;

commit;
