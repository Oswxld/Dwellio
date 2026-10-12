-- DWELLIO MOVE-OUT INSPECTIONS (corrected, rerunnable)
-- Apply this entire file first in Supabase SQL Editor.
-- Real property ancestry: units.floor_id -> floors.building_id ->
-- buildings.property_id -> properties.organization_id.
-- units.property_id is optional and is NOT needed for ownership checks.
-- Inspections may start without a tenant notice.
-- No security deposit, invoice, SMS or lease is modified by this file.

begin;

create table if not exists public.move_out_inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id),
  lease_id uuid not null unique references public.leases(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  unit_id uuid not null references public.units(id) on delete restrict,
  inspected_at date not null default (now() at time zone 'Africa/Nairobi')::date,
  status text not null default 'draft'
    check (status in ('draft', 'completed')),
  notes text,
  created_by uuid not null references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- An older version of move_out_inspections may already exist with
-- only lease_id (and without tenant_id, unit_id, or organization_id).
-- CREATE TABLE IF NOT EXISTS does NOT repair existing table structures.
-- Add expected fields BEFORE any statement reads those fields.
-- Existing values are preserved and validated: never overwrite a
-- conflicting tenant/unit/organization with values from another lease.
alter table public.move_out_inspections
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists lease_id uuid references public.leases(id) on delete restrict,
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict,
  add column if not exists unit_id uuid references public.units(id) on delete restrict,
  add column if not exists inspected_at date default (now() at time zone 'Africa/Nairobi')::date,
  add column if not exists status text default 'draft',
  add column if not exists notes text,
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- Backfill only the missing identity fields, from the authoritative lease.
-- This update does not rewrite populated identifiers or financial data.
update public.move_out_inspections i
   set organization_id = coalesce(i.organization_id, l.organization_id),
       tenant_id       = coalesce(i.tenant_id, l.tenant_id),
       unit_id         = coalesce(i.unit_id, l.unit_id)
  from public.leases l
 where l.id = i.lease_id
   and (i.organization_id is null or i.tenant_id is null or i.unit_id is null);

-- A pre-existing inspection without a lease or creator cannot safely be
-- invented. Stop and identify these rows instead of discarding them.
do $verify$
begin
  if exists (
    select 1 from public.move_out_inspections
    where lease_id is null or tenant_id is null or unit_id is null
      or organization_id is null
  ) then
    raise exception 'Legacy inspection has missing lease/tenant/unit/organization identity. Resolve the linked lease before migrating.';
  end if;

  if exists (
    select 1 from public.move_out_inspections
    where created_by is null
  ) then
    raise exception 'Legacy inspection has no created_by. Identify the original inspector; the migration will not invent an actor.';
  end if;

  if exists (
    select 1 from public.move_out_inspections
    where inspected_at is null or status is null
  ) then
    raise exception 'Legacy inspection has missing inspection date or status. Review the existing records before migrating.';
  end if;

  if exists (
    select 1 from public.move_out_inspections i
    join public.leases l on l.id = i.lease_id
    where i.tenant_id is distinct from l.tenant_id
       or i.unit_id is distinct from l.unit_id
       or i.organization_id is distinct from l.organization_id
  ) then
    raise exception 'Legacy inspection ownership conflicts with its lease. Resolve tenant_id, unit_id or organization_id before continuing.';
  end if;
end;
$verify$;

alter table public.move_out_inspections
  alter column organization_id set not null,
  alter column tenant_id set not null,
  alter column unit_id set not null,
  alter column lease_id set not null,
  alter column created_by set not null,
  alter column inspected_at set not null,
  alter column status set not null;

create unique index if not exists move_out_inspections_one_per_lease
  on public.move_out_inspections(lease_id);
create index if not exists move_out_inspections_org_idx
  on public.move_out_inspections(organization_id,status);

create table if not exists public.move_out_inspection_bills (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references public.move_out_inspections(id) on delete restrict,
  title text not null check (length(btrim(title)) between 2 and 150),
  description text,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists move_out_bills_inspection_idx
  on public.move_out_inspection_bills(inspection_id);

-- Read the organization from the PROPERTY, never from units or floors.
-- Verify it matches leases.organization_id and tenants.organization_id.
create or replace function public.move_out_inspection_matches_property(
  p_lease_id uuid,
  p_tenant_id uuid,
  p_unit_id uuid,
  p_organization_id uuid
)
returns boolean
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

-- Guard existing data as well as future inserts.
do $verify$
begin
  if exists (
    select 1 from public.move_out_inspections i
    where not public.move_out_inspection_matches_property(
      i.lease_id,i.tenant_id,i.unit_id,i.organization_id
    )
  ) then
    raise exception 'Existing inspection does not match its lease, tenant, unit and property organization. Resolve this record before continuing.';
  end if;
end;
$verify$;

create or replace function public.guard_move_out_inspection()
returns trigger
language plpgsql set search_path = ''
as $guard$
begin
  if tg_op = 'UPDATE' then
    if old.status <> 'draft' then
      raise exception 'Completed move-out inspections are immutable';
    end if;
    if new.id is distinct from old.id
       or new.lease_id is distinct from old.lease_id
       or new.tenant_id is distinct from old.tenant_id
       or new.unit_id is distinct from old.unit_id
       or new.organization_id is distinct from old.organization_id
       or new.created_by is distinct from old.created_by
    then
      raise exception 'Inspection ownership and lease details cannot change';
    end if;
  end if;

  if not public.move_out_inspection_matches_property(
      new.lease_id,new.tenant_id,new.unit_id,new.organization_id
    ) then
    raise exception 'Inspection lease, tenant, unit or property organization mismatch';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.completed_at is not null then
      raise exception 'New inspections must start as drafts';
    end if;
  elsif new.status = 'completed' then
    new.completed_at := now();
  elsif new.completed_at is not null then
    raise exception 'Draft inspections cannot have a completed date';
  end if;

  new.updated_at := now();
  return new;
end;
$guard$;

drop trigger if exists guard_move_out_inspection_row on public.move_out_inspections;
create trigger guard_move_out_inspection_row
  before insert or update on public.move_out_inspections
  for each row execute function public.guard_move_out_inspection();

-- Charges are mutable only while their inspection is a draft.
create or replace function public.guard_move_out_inspection_charge()
returns trigger
language plpgsql set search_path = ''
as $guard$
declare
  v_inspection_id uuid;
  v_state text;
begin
  v_inspection_id := case when tg_op = 'DELETE' then old.inspection_id else new.inspection_id end;
  select status into v_state
    from public.move_out_inspections where id = v_inspection_id for update;
  if v_state is distinct from 'draft' then
    raise exception 'Inspection charges cannot change after inspection completion';
  end if;
  if tg_op = 'UPDATE' and new.inspection_id <> old.inspection_id then
    raise exception 'Cannot move charges to another inspection';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$guard$;

drop trigger if exists guard_move_out_inspection_charge_row on public.move_out_inspection_bills;
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

create policy move_out_inspections_read on public.move_out_inspections
  for select to authenticated using (
    public.is_org_admin(organization_id)
    and public.move_out_inspection_matches_property(
      lease_id,tenant_id,unit_id,organization_id
    )
  );

create policy move_out_inspections_insert on public.move_out_inspections
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and public.is_org_admin(organization_id)
    and public.move_out_inspection_matches_property(
      lease_id,tenant_id,unit_id,organization_id
    )
    and exists (
      select 1 from public.leases l
      where l.id = lease_id
        and l.status::text in ('active','notice_given','expired')
    )
    and status = 'draft'
  );

create policy move_out_inspections_update on public.move_out_inspections
  for update to authenticated
  using (public.is_org_admin(organization_id) and status = 'draft')
  with check (
    public.is_org_admin(organization_id)
    and public.move_out_inspection_matches_property(
      lease_id,tenant_id,unit_id,organization_id
    )
    and status in ('draft','completed')
  );

create policy move_out_bills_read on public.move_out_inspection_bills
  for select to authenticated using (
    exists (
      select 1 from public.move_out_inspections i
      where i.id = inspection_id
        and public.is_org_admin(i.organization_id)
    )
  );
create policy move_out_bills_insert on public.move_out_inspection_bills
  for insert to authenticated with check (
    exists (
      select 1 from public.move_out_inspections i
      where i.id = inspection_id and i.status = 'draft'
        and public.is_org_admin(i.organization_id)
    )
  );
create policy move_out_bills_update on public.move_out_inspection_bills
  for update to authenticated using (
    exists (
      select 1 from public.move_out_inspections i
      where i.id = inspection_id and i.status = 'draft'
        and public.is_org_admin(i.organization_id)
    )
  ) with check (
    exists (
      select 1 from public.move_out_inspections i
      where i.id = inspection_id and i.status = 'draft'
        and public.is_org_admin(i.organization_id)
    )
  );
create policy move_out_bills_delete on public.move_out_inspection_bills
  for delete to authenticated using (
    exists (
      select 1 from public.move_out_inspections i
      where i.id = inspection_id and i.status = 'draft'
        and public.is_org_admin(i.organization_id)
    )
  );

-- Prevent clients from editing link/ownership fields directly.
revoke all on public.move_out_inspections from anon, authenticated;
revoke all on public.move_out_inspection_bills from anon, authenticated;
grant select, insert on public.move_out_inspections to authenticated;
grant update (inspected_at,notes,status,completed_at,updated_at)
  on public.move_out_inspections to authenticated;
grant select,insert,update,delete on public.move_out_inspection_bills to authenticated;

revoke all on function public.move_out_inspection_matches_property(uuid,uuid,uuid,uuid)
  from public,anon;
grant execute on function public.move_out_inspection_matches_property(uuid,uuid,uuid,uuid)
  to authenticated;
revoke all on function public.guard_move_out_inspection() from public,anon;
revoke all on function public.guard_move_out_inspection_charge() from public,anon;

commit;
