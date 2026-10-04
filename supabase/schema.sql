-- Dwellio base onboarding schema
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create type public.organization_status as enum ('active','suspended','deleted');
create type public.member_status as enum ('invited','active','suspended','removed');
create type public.profile_status as enum ('active','suspended','deleted');
create type public.property_status as enum ('active','inactive','under_maintenance','deleted');
create type public.unit_status as enum ('vacant','occupied','reserved','under_maintenance','unavailable','deleted');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  avatar_url text,
  status public.profile_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by uuid not null references public.profiles(id),
  status public.organization_status not null default 'active',
  setup_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','admin','manager','staff')),
  status public.member_status not null default 'active',
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 150),
  description text,
  address text,
  city text,
  county text,
  latitude double precision,
  longitude double precision,
  status public.property_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.floors (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  floor_number integer not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (building_id, floor_number)
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  position integer not null check (position >= 0),
  status public.unit_status not null default 'vacant',
  default_rent_amount numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (floor_id, position),
  unique (floor_id, name)
);

create index properties_org_idx on public.properties(organization_id);
create index buildings_property_idx on public.buildings(property_id, sort_order);
create index floors_building_idx on public.floors(building_id, sort_order);
create index units_floor_idx on public.units(floor_id, position);
create index members_user_idx on public.organization_members(user_id, status);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger organizations_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger properties_updated_at before update on public.properties for each row execute function public.set_updated_at();
create trigger buildings_updated_at before update on public.buildings for each row execute function public.set_updated_at();
create trigger floors_updated_at before update on public.floors for each row execute function public.set_updated_at();
create trigger units_updated_at before update on public.units for each row execute function public.set_updated_at();

-- Keep a public profile row in sync with Supabase Auth user creation.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- SECURITY DEFINER helpers avoid recursive RLS checks.
create or replace function public.is_org_member(org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.is_org_admin(org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role in ('owner','admin','manager')
  );
$$;

create or replace function public.property_org_id(p_property_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.properties where id = p_property_id;
$$;

create or replace function public.building_property_id(p_building_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select property_id from public.buildings where id = p_building_id;
$$;

create or replace function public.floor_property_id(p_floor_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select b.property_id
  from public.floors f join public.buildings b on b.id = f.building_id
  where f.id = p_floor_id;
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.properties enable row level security;
alter table public.buildings enable row level security;
alter table public.floors enable row level security;
alter table public.units enable row level security;

-- Profiles: users can read/update their own profile.
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Organizations: authenticated users can create an organization for themselves.
create policy organizations_select_member on public.organizations for select to authenticated using (public.is_org_member(id) or created_by = auth.uid());
create policy organizations_insert_owner on public.organizations for insert to authenticated with check (created_by = auth.uid());
create policy organizations_update_admin on public.organizations for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));

-- Membership: user can see their own memberships and org admins can see members.
create policy members_select on public.organization_members for select to authenticated using (user_id = auth.uid() or public.is_org_admin(organization_id));
create policy members_insert_owner on public.organization_members for insert to authenticated
with check (
  user_id = auth.uid()
  and (
    exists (select 1 from public.organizations o where o.id = organization_id and o.created_by = auth.uid())
    or public.is_org_admin(organization_id)
  )
);
create policy members_update_admin on public.organization_members for update to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

-- Property hierarchy.
create policy properties_select_member on public.properties for select to authenticated using (public.is_org_member(organization_id) or exists (select 1 from public.organizations o where o.id = organization_id and o.created_by = auth.uid()));
create policy properties_insert_member on public.properties for insert to authenticated with check (public.is_org_admin(organization_id) or exists (select 1 from public.organizations o where o.id = organization_id and o.created_by = auth.uid()));
create policy properties_update_admin on public.properties for update to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create policy buildings_select_member on public.buildings for select to authenticated using (public.is_org_member(public.property_org_id(property_id)));
create policy buildings_insert_admin on public.buildings for insert to authenticated with check (public.is_org_admin(public.property_org_id(property_id)));
create policy buildings_update_admin on public.buildings for update to authenticated using (public.is_org_admin(public.property_org_id(property_id))) with check (public.is_org_admin(public.property_org_id(property_id)));

create policy floors_select_member on public.floors for select to authenticated using (public.is_org_member(public.building_property_id(building_id)));
create policy floors_insert_admin on public.floors for insert to authenticated with check (public.is_org_admin(public.building_property_id(building_id)));
create policy floors_update_admin on public.floors for update to authenticated using (public.is_org_admin(public.building_property_id(building_id))) with check (public.is_org_admin(public.building_property_id(building_id)));

create policy units_select_member on public.units for select to authenticated using (public.is_org_member(public.floor_property_id(floor_id)));
create policy units_insert_admin on public.units for insert to authenticated with check (public.is_org_admin(public.floor_property_id(floor_id)));
create policy units_update_admin on public.units for update to authenticated using (public.is_org_admin(public.floor_property_id(floor_id))) with check (public.is_org_admin(public.floor_property_id(floor_id)));

-- Do not expose these helpers to API clients beyond what is needed for policy evaluation.
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.is_org_admin(uuid) from public;
revoke all on function public.property_org_id(uuid) from public;
revoke all on function public.building_property_id(uuid) from public;
revoke all on function public.floor_property_id(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_admin(uuid) to authenticated;
grant execute on function public.property_org_id(uuid) to authenticated;
grant execute on function public.building_property_id(uuid) to authenticated;
grant execute on function public.floor_property_id(uuid) to authenticated;

-- Dashboard SQL extension is in supabase/dashboard.sql. Run it after this schema.
