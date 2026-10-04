-- Dwellio landlord dashboard extension
-- Run this AFTER the base schema.sql.
-- It does not create tenants, leases, invoices or maintenance tables yet.
-- Those modules will supply their own live dashboard metrics later.

create index if not exists organization_members_org_status_idx
  on public.organization_members(organization_id, status);

create index if not exists units_status_idx
  on public.units(status)
  where deleted_at is null;

create or replace function public.get_landlord_dashboard_summary(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'You are not a member of this organization';
  end if;

  select jsonb_build_object(
    'organization_id', o.id,
    'organization_name', o.name,
    'property_count', (
      select count(*) from public.properties p
      where p.organization_id = o.id
        and p.status <> 'deleted'
        and p.deleted_at is null
    ),
    'building_count', (
      select count(*)
      from public.buildings b
      join public.properties p on p.id = b.property_id
      where p.organization_id = o.id
        and p.status <> 'deleted'
        and p.deleted_at is null
        and b.deleted_at is null
    ),
    'floor_count', (
      select count(*)
      from public.floors f
      join public.buildings b on b.id = f.building_id
      join public.properties p on p.id = b.property_id
      where p.organization_id = o.id
        and p.status <> 'deleted'
        and p.deleted_at is null
        and b.deleted_at is null
        and f.deleted_at is null
    ),
    'unit_count', (
      select count(*)
      from public.units u
      join public.floors f on f.id = u.floor_id
      join public.buildings b on b.id = f.building_id
      join public.properties p on p.id = b.property_id
      where p.organization_id = o.id
        and p.status <> 'deleted'
        and p.deleted_at is null
        and b.deleted_at is null
        and f.deleted_at is null
        and u.status <> 'deleted'
        and u.deleted_at is null
    ),
    'occupied_units', (
      select count(*)
      from public.units u
      join public.floors f on f.id = u.floor_id
      join public.buildings b on b.id = f.building_id
      join public.properties p on p.id = b.property_id
      where p.organization_id = o.id
        and u.status = 'occupied'
        and u.deleted_at is null
        and f.deleted_at is null
        and b.deleted_at is null
        and p.deleted_at is null
    ),
    'vacant_units', (
      select count(*)
      from public.units u
      join public.floors f on f.id = u.floor_id
      join public.buildings b on b.id = f.building_id
      join public.properties p on p.id = b.property_id
      where p.organization_id = o.id
        and u.status = 'vacant'
        and u.deleted_at is null
        and f.deleted_at is null
        and b.deleted_at is null
        and p.deleted_at is null
    ),
    'reserved_units', (
      select count(*)
      from public.units u
      join public.floors f on f.id = u.floor_id
      join public.buildings b on b.id = f.building_id
      join public.properties p on p.id = b.property_id
      where p.organization_id = o.id
        and u.status = 'reserved'
        and u.deleted_at is null
        and f.deleted_at is null
        and b.deleted_at is null
        and p.deleted_at is null
    ),
    'maintenance_units', (
      select count(*)
      from public.units u
      join public.floors f on f.id = u.floor_id
      join public.buildings b on b.id = f.building_id
      join public.properties p on p.id = b.property_id
      where p.organization_id = o.id
        and u.status = 'under_maintenance'
        and u.deleted_at is null
        and f.deleted_at is null
        and b.deleted_at is null
        and p.deleted_at is null
    ),
    'unavailable_units', (
      select count(*)
      from public.units u
      join public.floors f on f.id = u.floor_id
      join public.buildings b on b.id = f.building_id
      join public.properties p on p.id = b.property_id
      where p.organization_id = o.id
        and u.status = 'unavailable'
        and u.deleted_at is null
        and f.deleted_at is null
        and b.deleted_at is null
        and p.deleted_at is null
    ),
    'staff_count', (
      select count(*)
      from public.organization_members m
      where m.organization_id = o.id
        and m.status = 'active'
    )
  ) into result
  from public.organizations o
  where o.id = p_organization_id
    and o.status <> 'deleted'
    and o.deleted_at is null;

  if result is null then
    raise exception 'Organization not found';
  end if;

  return result;
end;
$$;

revoke all on function public.get_landlord_dashboard_summary(uuid) from public;
grant execute on function public.get_landlord_dashboard_summary(uuid) to authenticated;

-- Useful direct selects for testing in Supabase SQL Editor.
-- Replace the UUID below with an organization id you own.
--
-- select * from public.properties
-- where organization_id = 'YOUR-ORG-UUID'
-- order by name;
--
-- select p.name as property, count(b.id) as buildings
-- from public.properties p
-- left join public.buildings b on b.property_id = p.id and b.deleted_at is null
-- where p.organization_id = 'YOUR-ORG-UUID' and p.deleted_at is null
-- group by p.id, p.name
-- order by p.name;
--
-- select public.get_landlord_dashboard_summary('YOUR-ORG-UUID');
