-- Dwellio tenant + lease foundation
-- Run AFTER the existing Dwellio base schema.

create type public.tenant_status as enum (
  'active',
  'inactive',
  'deleted'
);

create type public.tenant_identification_type as enum (
  'national_id',
  'passport',
  'other'
);

create type public.lease_status as enum (
  'draft',
  'pending_acceptance',
  'active',
  'expired',
  'terminated',
  'declined'
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- NULL until the tenant creates/claims their Dwellio account.
  user_id uuid references auth.users(id) on delete set null,

  full_name text not null
    check (length(trim(full_name)) between 2 and 150),

  email text not null
    check (length(trim(email)) between 3 and 320),

  phone text not null
    check (length(trim(phone)) between 7 and 30),

  identification_type public.tenant_identification_type not null,

  identification_number text not null
    check (length(trim(identification_number)) between 2 and 80),

  date_of_birth date,

  status public.tenant_status not null default 'active',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.tenant_emergency_contacts (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null references public.organizations(id) on delete cascade,

  tenant_id uuid not null references public.tenants(id) on delete cascade,

  full_name text not null
    check (length(trim(full_name)) between 2 and 150),

  relationship text not null
    check (length(trim(relationship)) between 2 and 80),

  phone text not null
    check (length(trim(phone)) between 7 and 30),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leases (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null references public.organizations(id) on delete cascade,

  tenant_id uuid not null references public.tenants(id) on delete restrict,

  unit_id uuid not null references public.units(id) on delete restrict,

  start_date date not null,
  end_date date not null,

  rent_amount numeric(12,2) not null
    check (rent_amount >= 0),

  deposit_amount numeric(12,2) not null default 0
    check (deposit_amount >= 0),

  due_day smallint not null
    check (due_day between 1 and 31),

  grace_period_days smallint not null default 0
    check (grace_period_days between 0 and 90),

  billing_frequency text not null default 'monthly'
    check (billing_frequency in ('monthly','quarterly','yearly')),

  status public.lease_status not null default 'pending_acceptance',

  accepted_at timestamptz,
  declined_at timestamptz,
  terminated_at timestamptz,
  expired_at timestamptz,

  created_by uuid not null references auth.users(id),
  accepted_by uuid references auth.users(id),

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  check (end_date > start_date),

  check (
    (status = 'active' and accepted_at is not null)
    or status <> 'active'
  ),

  check (
    status <> 'declined'
    or declined_at is not null
  )
);

create index tenants_org_idx
on public.tenants(organization_id);

create index tenants_user_idx
on public.tenants(user_id)
where user_id is not null;

create index tenant_emergency_contacts_tenant_idx
on public.tenant_emergency_contacts(tenant_id);

create index leases_org_idx
on public.leases(organization_id);

create index leases_tenant_idx
on public.leases(tenant_id);

create index leases_unit_idx
on public.leases(unit_id);

create index leases_status_idx
on public.leases(organization_id, status);

create index leases_end_date_idx
on public.leases(organization_id, end_date)
where status = 'active';

create unique index tenants_org_email_unique
on public.tenants(organization_id, lower(email))
where deleted_at is null;

create unique index tenants_org_user_unique
on public.tenants(organization_id, user_id)
where user_id is not null
and deleted_at is null;

create unique index leases_one_active_per_unit
on public.leases(unit_id)
where status = 'active'
and deleted_at is null;

create unique index leases_one_pending_per_unit
on public.leases(unit_id)
where status = 'pending_acceptance'
and deleted_at is null;