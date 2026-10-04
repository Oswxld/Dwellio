1. Database — run this migration

Create:

supabase/tenant_leases.sql

The complete migration is the foundation for the whole feature:

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

Then the helper functions:

create or replace function public.tenant_org_id(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.tenants
  where id = p_tenant_id;
$$;

create or replace function public.lease_org_id(p_lease_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.leases
  where id = p_lease_id;
$$;

create or replace function public.unit_org_id(p_unit_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.property_org_id(
    public.floor_property_id(u.floor_id)
  )
  from public.units u
  where u.id = p_unit_id;
$$;
2. Automatically synchronize unit status

This is important.

We don't want React deciding:

"Lease accepted? Better update unit to occupied."

The database should guarantee it.

create or replace function public.sync_unit_status_from_leases(
  p_unit_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin

  -- Active lease = occupied
  if exists (
    select 1
    from public.leases
    where unit_id = p_unit_id
      and status = 'active'
      and deleted_at is null
  ) then

    update public.units
    set status = 'occupied'
    where id = p_unit_id;

  -- Pending lease, but no active lease = reserved
  elsif exists (
    select 1
    from public.leases
    where unit_id = p_unit_id
      and status = 'pending_acceptance'
      and deleted_at is null
  ) then

    update public.units
    set status = 'reserved'
    where id = p_unit_id;

  -- No active/pending lease = vacant
  else

    update public.units
    set status = 'vacant'
    where id = p_unit_id
      and status in ('reserved','occupied');

  end if;

end;
$$;

Then:

create or replace function public.handle_lease_unit_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin

  if tg_op = 'DELETE' then
    perform public.sync_unit_status_from_leases(old.unit_id);
    return old;
  end if;

  perform public.sync_unit_status_from_leases(new.unit_id);

  if tg_op = 'UPDATE'
     and old.unit_id <> new.unit_id then

    perform public.sync_unit_status_from_leases(old.unit_id);

  end if;

  return new;
end;
$$;

create trigger leases_sync_unit_status
after insert
or update of unit_id, status, deleted_at
or delete
on public.leases
for each row
execute function public.handle_lease_unit_status();

So now:

INSERT lease pending_acceptance
          ↓
      unit = reserved

and:

lease → active
          ↓
      unit = occupied

and:

lease → expired/declined/terminated
          ↓
      no other active/pending lease?
          ↓
      unit = vacant
Renewal is handled correctly too.

If:

Current lease = ACTIVE
Renewal = PENDING

the unit stays:

OCCUPIED

because there is still an active lease.

3. RLS

Add:

alter table public.tenants enable row level security;
alter table public.tenant_emergency_contacts enable row level security;
alter table public.leases enable row level security;

create policy tenants_select_admin
on public.tenants
for select
to authenticated
using (
  public.is_org_member(organization_id)
);

create policy tenants_insert_admin
on public.tenants
for insert
to authenticated
with check (
  public.is_org_admin(organization_id)
);

create policy tenants_update_admin
on public.tenants
for update
to authenticated
using (
  public.is_org_admin(organization_id)
)
with check (
  public.is_org_admin(organization_id)
);

create policy tenant_emergency_contacts_select_member
on public.tenant_emergency_contacts
for select
to authenticated
using (
  public.is_org_member(organization_id)
);

create policy tenant_emergency_contacts_insert_admin
on public.tenant_emergency_contacts
for insert
to authenticated
with check (
  public.is_org_admin(organization_id)
);

create policy tenant_emergency_contacts_update_admin
on public.tenant_emergency_contacts
for update
to authenticated
using (
  public.is_org_admin(organization_id)
)
with check (
  public.is_org_admin(organization_id)
);

create policy leases_select_member
on public.leases
for select
to authenticated
using (
  public.is_org_member(organization_id)
);

create policy leases_insert_admin
on public.leases
for insert
to authenticated
with check (
  public.is_org_admin(organization_id)
  and public.tenant_org_id(tenant_id) = organization_id
  and public.unit_org_id(unit_id) = organization_id
);

create policy leases_update_admin
on public.leases
for update
to authenticated
using (
  public.is_org_admin(organization_id)
)
with check (
  public.is_org_admin(organization_id)
  and public.tenant_org_id(tenant_id) = organization_id
  and public.unit_org_id(unit_id) = organization_id
);

And tenant-facing policies:

create policy tenants_select_own
on public.tenants
for select
to authenticated
using (
  user_id = auth.uid()
);

create policy tenant_emergency_contacts_select_own
on public.tenant_emergency_contacts
for select
to authenticated
using (
  tenant_id in (
    select id
    from public.tenants
    where user_id = auth.uid()
  )
);

create policy leases_select_own
on public.leases
for select
to authenticated
using (
  tenant_id in (
    select id
    from public.tenants
    where user_id = auth.uid()
  )
);

This means the future tenant app won't need to be an organization member.

4. The landlord's "Create Tenant + Lease" must be one transaction

This is probably the most important backend function we're adding.

The frontend will make one RPC call.

React
  ↓
create_tenant_with_lease()
  ↓
Tenant
Emergency contact
Lease
  ↓
ALL succeed

If something fails:

Tenant ❌
Emergency ❌
Lease ❌

Everything rolls back.

Here's the RPC:

create or replace function public.create_tenant_with_lease(
  p_organization_id uuid,
  p_tenant jsonb,
  p_emergency_contact jsonb,
  p_lease jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_tenant_id uuid;
  v_lease_id uuid;
  v_user_id uuid;
  v_existing_tenant uuid;
  v_existing_active uuid;
  v_existing_pending uuid;

  v_email text;
  v_unit_id uuid;

  v_lease_status public.lease_status := 'pending_acceptance';
begin

  if not public.is_org_admin(p_organization_id) then
    raise exception
      'You are not authorized to add tenants to this organization';
  end if;

  v_email := lower(trim(p_tenant->>'email'));
  v_unit_id := (p_lease->>'unit_id')::uuid;

  if v_email is null or v_email = '' then
    raise exception 'Tenant email is required';
  end if;

  if v_unit_id is null then
    raise exception 'A unit is required';
  end if;

  if public.unit_org_id(v_unit_id) <> p_organization_id then
    raise exception
      'The selected unit does not belong to this organization';
  end if;

  -- New tenant cannot duplicate an existing tenant in this organization.
  select t.id
  into v_existing_tenant
  from public.tenants t
  where t.organization_id = p_organization_id
    and lower(t.email) = v_email
    and t.deleted_at is null
  limit 1;

  if v_existing_tenant is not null then
    raise exception
      'A tenant with this email already exists in this organization';
  end if;

  -- If the person already has a Dwellio account, link it immediately.
  select u.id
  into v_user_id
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_user_id is not null
     and exists (
       select 1
       from public.tenants t
       where t.organization_id = p_organization_id
         and t.user_id = v_user_id
         and t.deleted_at is null
     ) then

    raise exception
      'This Dwellio account is already linked to a tenant in this organization';

  end if;

  -- A unit cannot receive a new initial lease if it is already occupied.
  if exists (
    select 1
    from public.units u
    where u.id = v_unit_id
      and u.status <> 'vacant'
      and u.status <> 'deleted'
  ) then

    raise exception 'The selected unit is not vacant';

  end if;

  select l.id
  into v_existing_active
  from public.leases l
  where l.unit_id = v_unit_id
    and l.status = 'active'
    and l.deleted_at is null
  limit 1;

  if v_existing_active is not null then
    raise exception 'This unit already has an active lease';
  end if;

  select l.id
  into v_existing_pending
  from public.leases l
  where l.unit_id = v_unit_id
    and l.status = 'pending_acceptance'
    and l.deleted_at is null
  limit 1;

  if v_existing_pending is not null then
    raise exception
      'This unit already has a lease waiting for tenant acceptance';
  end if;

  if (p_lease->>'end_date')::date
     <= (p_lease->>'start_date')::date then

    raise exception
      'Lease end date must be after the start date';

  end if;

  insert into public.tenants (
    organization_id,
    user_id,
    full_name,
    email,
    phone,
    identification_type,
    identification_number,
    date_of_birth
  )
  values (
    p_organization_id,
    v_user_id,
    trim(p_tenant->>'full_name'),
    v_email,
    trim(p_tenant->>'phone'),
    (p_tenant->>'identification_type')
      ::public.tenant_identification_type,
    trim(p_tenant->>'identification_number'),
    nullif(
      p_tenant->>'date_of_birth',
      ''
    )::date
  )
  returning id into v_tenant_id;

  insert into public.tenant_emergency_contacts (
    organization_id,
    tenant_id,
    full_name,
    relationship,
    phone
  )
  values (
    p_organization_id,
    v_tenant_id,
    trim(p_emergency_contact->>'full_name'),
    trim(p_emergency_contact->>'relationship'),
    trim(p_emergency_contact->>'phone')
  );

  insert into public.leases (
    organization_id,
    tenant_id,
    unit_id,
    start_date,
    end_date,
    rent_amount,
    deposit_amount,
    due_day,
    grace_period_days,
    billing_frequency,
    status,
    created_by,
    notes
  )
  values (
    p_organization_id,
    v_tenant_id,
    v_unit_id,
    (p_lease->>'start_date')::date,
    (p_lease->>'end_date')::date,
    (p_lease->>'rent_amount')::numeric,
    coalesce(
      nullif(p_lease->>'deposit_amount','')::numeric,
      0
    ),
    (p_lease->>'due_day')::smallint,
    coalesce(
      nullif(p_lease->>'grace_period_days','')::smallint,
      0
    ),
    coalesce(
      nullif(p_lease->>'billing_frequency',''),
      'monthly'
    ),
    v_lease_status,
    auth.uid(),
    nullif(trim(p_lease->>'notes'),'')
  )
  returning id into v_lease_id;

  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'lease_id', v_lease_id,
    'linked_user_id', v_user_id,
    'lease_status', v_lease_status,
    'unit_status', 'reserved'
  );

end;
$$;

revoke all
on function public.create_tenant_with_lease(uuid, jsonb, jsonb, jsonb)
from public;

grant execute
on function public.create_tenant_with_lease(uuid, jsonb, jsonb, jsonb)
to authenticated;

Notice the important bit:

v_lease_status := 'pending_acceptance';

There is no way for the landlord onboarding form to accidentally create an active lease.

5. Future tenant acceptance

We're also preparing for the tenant app now.

When John eventually logs in, this function will be called:

create or replace function public.accept_lease(
  p_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_lease public.leases%rowtype;
begin

  select l.*
  into v_lease
  from public.leases l
  join public.tenants t
    on t.id = l.tenant_id
  where l.id = p_lease_id
    and t.user_id = auth.uid()
    and l.deleted_at is null
  for update;

  if not found then
    raise exception
      'Lease not found or it does not belong to this account';
  end if;

  if v_lease.status <> 'pending_acceptance' then
    raise exception
      'Only leases waiting for acceptance can be accepted';
  end if;

  if exists (
    select 1
    from public.leases l
    where l.unit_id = v_lease.unit_id
      and l.status = 'active'
      and l.deleted_at is null
      and l.id <> v_lease.id
  ) then
    raise exception
      'This unit already has another active lease';
  end if;

  update public.leases
  set status = 'active',
      accepted_at = now(),
      accepted_by = auth.uid(),
      declined_at = null
  where id = p_lease_id;

  return jsonb_build_object(
    'lease_id', p_lease_id,
    'status', 'active'
  );

end;
$$;

And decline:

create or replace function public.decline_lease(
  p_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_lease_status public.lease_status;
begin

  select l.status
  into v_lease_status
  from public.leases l
  join public.tenants t
    on t.id = l.tenant_id
  where l.id = p_lease_id
    and t.user_id = auth.uid()
    and l.deleted_at is null
  for update;

  if not found then
    raise exception
      'Lease not found or it does not belong to this account';
  end if;

  if v_lease_status <> 'pending_acceptance' then
    raise exception
      'Only leases waiting for acceptance can be declined';
  end if;

  update public.leases
  set status = 'declined',
      declined_at = now()
  where id = p_lease_id;

  return jsonb_build_object(
    'lease_id', p_lease_id,
    'status', 'declined'
  );

end;
$$;

Then:

revoke all on function public.accept_lease(uuid) from public;
revoke all on function public.decline_lease(uuid) from public;

grant execute on function public.accept_lease(uuid) to authenticated;
grant execute on function public.decline_lease(uuid) to authenticated;

So the future tenant app literally does:

[Accept Lease]
      ↓
accept_lease()
      ↓
lease = ACTIVE
      ↓
DB trigger
      ↓
unit = OCCUPIED
6. Account linking

We also need the thing we discussed earlier.

If John doesn't have an account:

tenant.user_id = NULL

If he later creates a Dwellio account using that verified email:

Auth user
   ↓
claim_tenant_account()
   ↓
tenant.user_id = auth.uid()

Use:

create or replace function public.claim_tenant_account()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
  v_claimed_ids uuid[];
begin

  select lower(email)
  into v_email
  from auth.users
  where id = auth.uid();

  if v_email is null then
    raise exception 'Authenticated user has no email address';
  end if;

  update public.tenants
  set user_id = auth.uid()
  where lower(email) = v_email
    and user_id is null
    and deleted_at is null;

  select coalesce(
    array_agg(t.id),
    '{}'::uuid[]
  )
  into v_claimed_ids
  from public.tenants t
  where t.user_id = auth.uid()
    and t.deleted_at is null;

  return jsonb_build_object(
    'claimed', cardinality(v_claimed_ids) > 0,
    'tenant_ids', to_jsonb(v_claimed_ids)
  );

end;
$$;

revoke all
on function public.claim_tenant_account()
from public;

grant execute
on function public.claim_tenant_account()
to authenticated;

I made this claim across organizations, intentionally. If the same person rents from two Dwellio landlords, one Dwellio account can represent both tenant records.

7. Renewal foundation

I'm also putting this in the database now because the dashboard needs to know about renewal requests.

create type public.lease_renewal_status as enum (
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired'
);

create table public.lease_renewal_requests (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null references public.organizations(id) on delete cascade,

  lease_id uuid not null references public.leases(id) on delete restrict,

  proposed_start_date date not null,
  proposed_end_date date not null,

  duration_months smallint not null
    check (duration_months between 1 and 120),

  proposed_rent_amount numeric(12,2) not null
    check (proposed_rent_amount >= 0),

  proposed_deposit_amount numeric(12,2) not null default 0
    check (proposed_deposit_amount >= 0),

  status public.lease_renewal_status not null default 'pending',

  requested_by uuid not null references auth.users(id),

  requested_at timestamptz not null default now(),
  responded_at timestamptz,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (proposed_end_date > proposed_start_date)
);

create index lease_renewals_org_idx
on public.lease_renewal_requests(organization_id, status);

create index lease_renewals_lease_idx
on public.lease_renewal_requests(lease_id, status);

create unique index lease_renewals_one_pending_per_lease
on public.lease_renewal_requests(lease_id)
where status = 'pending';

create trigger lease_renewal_requests_updated_at
before update on public.lease_renewal_requests
for each row
execute function public.set_updated_at();

The important architecture is:

CURRENT LEASE
ACTIVE
   │
   └──── Renewal Request
             │
             ├── pending
             ├── accepted
             └── declined

We don't deactivate the current lease just because renewal was requested.

8. Dashboard attention feed

Now the dashboard can actually know:

G10 hasn't accepted yet.

A204 expires in 18 days.

B103 has a renewal waiting for tenant response.

Create:

create or replace function public.get_landlord_dashboard_attention(
  p_organization_id uuid,
  p_expiring_within_days integer default 21
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  result jsonb;
begin

  if not public.is_org_member(p_organization_id) then
    raise exception
      'You are not a member of this organization';
  end if;

  select jsonb_build_object(

    'pending_acceptance_count', (
      select count(*)
      from public.leases l
      where l.organization_id = p_organization_id
        and l.status = 'pending_acceptance'
        and l.deleted_at is null
    ),

    'expiring_soon_count', (
      select count(*)
      from public.leases l
      where l.organization_id = p_organization_id
        and l.status = 'active'
        and l.deleted_at is null
        and l.end_date between
          current_date
          and current_date + p_expiring_within_days
    ),

    'renewal_pending_count', (
      select count(*)
      from public.lease_renewal_requests r
      where r.organization_id = p_organization_id
        and r.status = 'pending'
    ),

    'pending_acceptance', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'lease_id', l.id,
          'tenant_name', t.full_name,
          'unit_name', u.name,
          'start_date', l.start_date,
          'end_date', l.end_date,
          'created_at', l.created_at
        )
        order by l.created_at asc
      )
      from public.leases l
      join public.tenants t
        on t.id = l.tenant_id
      join public.units u
        on u.id = l.unit_id
      where l.organization_id = p_organization_id
        and l.status = 'pending_acceptance'
        and l.deleted_at is null
    ), '[]'::jsonb),

    'expiring_soon', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'lease_id', l.id,
          'tenant_name', t.full_name,
          'unit_name', u.name,
          'end_date', l.end_date,
          'days_remaining',
            (l.end_date - current_date)
        )
        order by l.end_date asc
      )
      from public.leases l
      join public.tenants t
        on t.id = l.tenant_id
      join public.units u
        on u.id = l.unit_id
      where l.organization_id = p_organization_id
        and l.status = 'active'
        and l.deleted_at is null
        and l.end_date between
          current_date
          and current_date + p_expiring_within_days
    ), '[]'::jsonb),

    'renewal_pending', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'request_id', r.id,
          'tenant_name', t.full_name,
          'unit_name', u.name,
          'proposed_end_date', r.proposed_end_date,
          'proposed_rent_amount', r.proposed_rent_amount,
          'requested_at', r.requested_at
        )
        order by r.requested_at asc
      )
      from public.lease_renewal_requests r
      join public.leases l
        on l.id = r.lease_id
      join public.tenants t
        on t.id = l.tenant_id
      join public.units u
        on u.id = l.unit_id
      where r.organization_id = p_organization_id
        and r.status = 'pending'
    ), '[]'::jsonb)

  )
  into result;

  return result;
end;
$$;

revoke all
on function public.get_landlord_dashboard_attention(uuid, integer)
from public;

grant execute
on function public.get_landlord_dashboard_attention(uuid, integer)
to authenticated;
9. Tenant onboarding page

Your existing landlord onboarding has that nice:

1/5
2/5
3/5
...

experience.

We're going to use the same philosophy.

I created:

src/pages/TenantOnboardingPage.tsx

The flow is:

1/6  Who are we adding?
       ↓
2/6  Identification details
       ↓
3/6  Emergency contact
       ↓
4/6  Where will they live?
       ↓
5/6  Lease terms
       ↓
6/6  Review
       ↓
Create & send lease

The important UX copy is:

This creates a lease proposal. It will be waiting for tenant acceptance; it will not be billed as an active lease yet.

And on the final screen:

Waiting for tenant acceptance · Unit reserved

So the landlord understands exactly what's happening.

src/lib/tenantLeases.ts

Add this file:

import { supabase } from './supabase'

export type PropertyOption = {
  id: string
  name: string
}

export type BuildingOption = {
  id: string
  name: string
  property_id: string
}

export type FloorOption = {
  id: string
  name: string
  building_id: string
  floor_number: number
}

export type UnitOption = {
  id: string
  name: string
  floor_id: string
  status: string
  default_rent_amount: number | null
}

export type TenantOnboardingInput = {
  tenant: {
    full_name: string
    email: string
    phone: string
    identification_type:
      | 'national_id'
      | 'passport'
      | 'other'
    identification_number: string
    date_of_birth: string
  }

  emergency_contact: {
    full_name: string
    relationship: string
    phone: string
  }

  lease: {
    unit_id: string
    start_date: string
    end_date: string
    rent_amount: number
    deposit_amount: number
    due_day: number
    grace_period_days: number
    billing_frequency:
      | 'monthly'
      | 'quarterly'
      | 'yearly'
    notes: string
  }
}

export async function getTenantSetupProperties(
  organizationId: string,
) {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .eq('status', 'active')
    .order('name')

  if (error) throw error

  return data as PropertyOption[]
}

export async function getTenantSetupBuildings(
  propertyId: string,
) {
  const { data, error } = await supabase
    .from('buildings')
    .select('id, name, property_id')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('sort_order')

  if (error) throw error

  return data as BuildingOption[]
}

export async function getTenantSetupFloors(
  buildingId: string,
) {
  const { data, error } = await supabase
    .from('floors')
    .select(
      'id, name, building_id, floor_number',
    )
    .eq('building_id', buildingId)
    .is('deleted_at', null)
    .order('floor_number')

  if (error) throw error

  return data as FloorOption[]
}

export async function getTenantSetupUnits(
  floorId: string,
) {
  const { data, error } = await supabase
    .from('units')
    .select(
      'id, name, floor_id, status, default_rent_amount',
    )
    .eq('floor_id', floorId)
    .is('deleted_at', null)
    .neq('status', 'deleted')
    .order('position')

  if (error) throw error

  return data as UnitOption[]
}

export async function createTenantWithLease(
  organizationId: string,
  input: TenantOnboardingInput,
) {
  const { data, error } = await supabase.rpc(
    'create_tenant_with_lease',
    {
      p_organization_id: organizationId,
      p_tenant: input.tenant,
      p_emergency_contact:
        input.emergency_contact,
      p_lease: input.lease,
    },
  )

  if (error) throw error

  return data as {
    tenant_id: string
    lease_id: string
    linked_user_id: string | null
    lease_status: 'pending_acceptance'
    unit_status: 'reserved'
  }
}
10. TenantOnboardingPage.tsx

Add:

src/pages/TenantOnboardingPage.tsx

The page should contain these six screens:

import { useEffect, useMemo, useState } from 'react'
import {
  createTenantWithLease,
  getTenantSetupBuildings,
  getTenantSetupFloors,
  getTenantSetupProperties,
  getTenantSetupUnits,
  type BuildingOption,
  type FloorOption,
  type PropertyOption,
  type TenantOnboardingInput,
  type UnitOption,
} from '../lib/tenantLeases'

type Step = 1 | 2 | 3 | 4 | 5 | 6

const initialForm: TenantOnboardingInput = {
  tenant: {
    full_name: '',
    email: '',
    phone: '',
    identification_type: 'national_id',
    identification_number: '',
    date_of_birth: '',
  },

  emergency_contact: {
    full_name: '',
    relationship: '',
    phone: '',
  },

  lease: {
    unit_id: '',
    start_date: '',
    end_date: '',
    rent_amount: 0,
    deposit_amount: 0,
    due_day: 5,
    grace_period_days: 0,
    billing_frequency: 'monthly',
    notes: '',
  },
}

export default function TenantOnboardingPage({
  organizationId,
  onComplete,
  onCancel,
}: {
  organizationId: string
  onComplete: () => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<Step>(1)

  const [form, setForm] =
    useState<TenantOnboardingInput>(initialForm)

  const [properties, setProperties] =
    useState<PropertyOption[]>([])

  const [buildings, setBuildings] =
    useState<BuildingOption[]>([])

  const [floors, setFloors] =
    useState<FloorOption[]>([])

  const [units, setUnits] =
    useState<UnitOption[]>([])

  const [propertyId, setPropertyId] = useState('')
  const [buildingId, setBuildingId] = useState('')
  const [floorId, setFloorId] = useState('')

  const [loadingOptions, setLoadingOptions] =
    useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const progress = useMemo(
    () => `${Math.round((step / 6) * 100)}%`,
    [step],
  )

  const selectedProperty =
    properties.find(x => x.id === propertyId)

  const selectedBuilding =
    buildings.find(x => x.id === buildingId)

  const selectedFloor =
    floors.find(x => x.id === floorId)

  const selectedUnit =
    units.find(x => x.id === form.lease.unit_id)

  useEffect(() => {
    getTenantSetupProperties(organizationId)
      .then(setProperties)
      .catch(err => {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not load properties.',
        )
      })
  }, [organizationId])

  async function chooseProperty(id: string) {
    setPropertyId(id)
    setBuildingId('')
    setFloorId('')

    setForm(prev => ({
      ...prev,
      lease: {
        ...prev.lease,
        unit_id: '',
      },
    }))

    setBuildings([])
    setFloors([])
    setUnits([])

    if (!id) return

    setLoadingOptions(true)

    try {
      setBuildings(
        await getTenantSetupBuildings(id),
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load buildings.',
      )
    } finally {
      setLoadingOptions(false)
    }
  }

  async function chooseBuilding(id: string) {
    setBuildingId(id)
    setFloorId('')

    setForm(prev => ({
      ...prev,
      lease: {
        ...prev.lease,
        unit_id: '',
      },
    }))

    setFloors([])
    setUnits([])

    if (!id) return

    setLoadingOptions(true)

    try {
      setFloors(
        await getTenantSetupFloors(id),
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load floors.',
      )
    } finally {
      setLoadingOptions(false)
    }
  }

  async function chooseFloor(id: string) {
    setFloorId(id)

    setForm(prev => ({
      ...prev,
      lease: {
        ...prev.lease,
        unit_id: '',
      },
    }))

    setUnits([])

    if (!id) return

    setLoadingOptions(true)

    try {
      setUnits(
        await getTenantSetupUnits(id),
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load units.',
      )
    } finally {
      setLoadingOptions(false)
    }
  }

  function setTenant(
    key: keyof TenantOnboardingInput['tenant'],
    value: string,
  ) {
    setForm(prev => ({
      ...prev,
      tenant: {
        ...prev.tenant,
        [key]: value,
      },
    }))
  }

  function setEmergency(
    key: keyof TenantOnboardingInput['emergency_contact'],
    value: string,
  ) {
    setForm(prev => ({
      ...prev,
      emergency_contact: {
        ...prev.emergency_contact,
        [key]: value,
      },
    }))
  }

  function setLease(
    key: keyof TenantOnboardingInput['lease'],
    value: string | number,
  ) {
    setForm(prev => ({
      ...prev,
      lease: {
        ...prev.lease,
        [key]: value,
      },
    }))
  }

  function validateStep(): string | null {
    if (step === 1) {
      if (!form.tenant.full_name.trim()) {
        return 'Enter the tenant’s full name.'
      }

      if (
        !form.tenant.email.trim() ||
        !form.tenant.email.includes('@')
      ) {
        return 'Enter a valid email address.'
      }

      if (!form.tenant.phone.trim()) {
        return 'Enter the tenant’s phone number.'
      }
    }

    if (step === 2) {
      if (
        !form.tenant.identification_number.trim()
      ) {
        return 'Enter the identification number.'
      }
    }

    if (step === 3) {
      if (
        !form.emergency_contact.full_name.trim()
      ) {
        return 'Enter the emergency contact’s name.'
      }

      if (
        !form.emergency_contact.relationship.trim()
      ) {
        return 'Enter the relationship.'
      }

      if (
        !form.emergency_contact.phone.trim()
      ) {
        return 'Enter the emergency contact’s phone number.'
      }
    }

    if (step === 4) {
      if (
        !propertyId ||
        !buildingId ||
        !floorId ||
        !form.lease.unit_id
      ) {
        return 'Select the property, building, floor and unit.'
      }

      if (selectedUnit?.status !== 'vacant') {
        return 'Only vacant units can receive a new lease.'
      }
    }

    if (step === 5) {
      if (
        !form.lease.start_date ||
        !form.lease.end_date
      ) {
        return 'Choose the lease start and end dates.'
      }

      if (
        form.lease.end_date <=
        form.lease.start_date
      ) {
        return 'The lease end date must be after the start date.'
      }

      if (form.lease.rent_amount <= 0) {
        return 'Enter a rent amount greater than zero.'
      }

      if (form.lease.deposit_amount < 0) {
        return 'Deposit cannot be negative.'
      }

      if (
        form.lease.due_day < 1 ||
        form.lease.due_day > 31
      ) {
        return 'Due day must be between 1 and 31.'
      }
    }

    return null
  }

  function next() {
    setError('')

    const validationError = validateStep()

    if (validationError) {
      setError(validationError)
      return
    }

    setStep(
      prev => Math.min(6, prev + 1) as Step,
    )
  }

  function back() {
    setError('')

    setStep(
      prev => Math.max(1, prev - 1) as Step,
    )
  }

  async function finish() {
    setError('')
    setSaving(true)

    try {
      const result =
        await createTenantWithLease(
          organizationId,
          form,
        )

      setSuccess(
        result.linked_user_id
          ? 'Tenant created and linked to their existing Dwellio account. The lease is waiting for their acceptance.'
          : 'Tenant created. The lease is waiting for tenant acceptance and the unit is now reserved.',
      )

      setTimeout(onComplete, 1000)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not create the tenant and lease.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header">
        <div className="brand">
          dwellio<span>.</span>
        </div>

        <div className="progress-wrap">
          <span>Tenant {step}/6</span>

          <div className="progress">
            <i style={{ width: progress }} />
          </div>
        </div>
      </header>

      <section className="setup-card tenant-setup-card">
        <p className="eyebrow">ADD TENANT</p>

        {step === 1 && (
          <>
            <h1>Who are we adding?</h1>

            <p className="muted">
              Start with the tenant’s basic contact
              details. If they already have a Dwellio
              account, we’ll link it automatically.
            </p>

            <div className="form-grid">
              <label>
                Full name
                <input
                  autoFocus
                  value={form.tenant.full_name}
                  onChange={e =>
                    setTenant(
                      'full_name',
                      e.target.value,
                    )
                  }
                  placeholder="John Kamau"
                />
              </label>

              <label>
                Email
                <input
                  type="email"
                  value={form.tenant.email}
                  onChange={e =>
                    setTenant(
                      'email',
                      e.target.value,
                    )
                  }
                  placeholder="john@example.com"
                />
              </label>

              <label>
                Phone
                <input
                  value={form.tenant.phone}
                  onChange={e =>
                    setTenant(
                      'phone',
                      e.target.value,
                    )
                  }
                  placeholder="0712 345 678"
                />
              </label>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>Identification details.</h1>

            <p className="muted">
              Keep identity information with the
              tenant rather than the lease so it
              remains part of their rental history.
            </p>

            <div className="form-grid">
              <label>
                Identification type
                <select
                  value={
                    form.tenant.identification_type
                  }
                  onChange={e =>
                    setTenant(
                      'identification_type',
                      e.target.value,
                    )
                  }
                >
                  <option value="national_id">
                    National ID
                  </option>

                  <option value="passport">
                    Passport
                  </option>

                  <option value="other">
                    Other
                  </option>
                </select>
              </label>

              <label>
                Identification number
                <input
                  autoFocus
                  value={
                    form.tenant
                      .identification_number
                  }
                  onChange={e =>
                    setTenant(
                      'identification_number',
                      e.target.value,
                    )
                  }
                  placeholder="12345678"
                />
              </label>

              <label>
                Date of birth
                <span className="optional">
                  optional
                </span>

                <input
                  type="date"
                  value={
                    form.tenant.date_of_birth
                  }
                  onChange={e =>
                    setTenant(
                      'date_of_birth',
                      e.target.value,
                    )
                  }
                />
              </label>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1>Emergency contact.</h1>

            <p className="muted">
              Who should the property manager
              contact if there’s an emergency?
            </p>

            <div className="form-grid">
              <label>
                Full name
                <input
                  autoFocus
                  value={
                    form.emergency_contact
                      .full_name
                  }
                  onChange={e =>
                    setEmergency(
                      'full_name',
                      e.target.value,
                    )
                  }
                  placeholder="Jane Kamau"
                />
              </label>

              <label>
                Relationship
                <input
                  value={
                    form.emergency_contact
                      .relationship
                  }
                  onChange={e =>
                    setEmergency(
                      'relationship',
                      e.target.value,
                    )
                  }
                  placeholder="Sister"
                />
              </label>

              <label>
                Phone
                <input
                  value={
                    form.emergency_contact.phone
                  }
                  onChange={e =>
                    setEmergency(
                      'phone',
                      e.target.value,
                    )
                  }
                  placeholder="0722 345 678"
                />
              </label>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1>Where will they live?</h1>

            <p className="muted">
              Choose the exact unit. Creating the
              lease will reserve the unit until the
              tenant accepts.
            </p>

            <div className="form-grid four-columns">
              <label>
                Property

                <select
                  autoFocus
                  value={propertyId}
                  onChange={e =>
                    chooseProperty(e.target.value)
                  }
                >
                  <option value="">
                    Select property
                  </option>

                  {properties.map(item => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Building

                <select
                  value={buildingId}
                  onChange={e =>
                    chooseBuilding(e.target.value)
                  }
                  disabled={!propertyId}
                >
                  <option value="">
                    Select building
                  </option>

                  {buildings.map(item => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Floor

                <select
                  value={floorId}
                  onChange={e =>
                    chooseFloor(e.target.value)
                  }
                  disabled={!buildingId}
                >
                  <option value="">
                    Select floor
                  </option>

                  {floors.map(item => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Unit

                <select
                  value={form.lease.unit_id}
                  onChange={e => {
                    const unit =
                      units.find(
                        item =>
                          item.id ===
                          e.target.value,
                      )

                    setLease(
                      'unit_id',
                      e.target.value,
                    )

                    if (
                      unit?.default_rent_amount
                    ) {
                      setLease(
                        'rent_amount',
                        Number(
                          unit.default_rent_amount,
                        ),
                      )
                    }
                  }}
                  disabled={!floorId}
                >
                  <option value="">
                    Select unit
                  </option>

                  {units.map(item => (
                    <option
                      key={item.id}
                      value={item.id}
                      disabled={
                        item.status !== 'vacant'
                      }
                    >
                      {item.name}
                      {item.status !== 'vacant'
                        ? ` — ${item.status}`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {loadingOptions && (
              <p className="builder-note">
                Loading available options…
              </p>
            )}
          </>
        )}

        {step === 5 && (
          <>
            <h1>Set the lease terms.</h1>

            <p className="muted">
              This creates a lease proposal. It
              will be <strong>waiting for tenant
              acceptance</strong>; it will not be
              billed as an active lease yet.
            </p>

            <div className="form-grid">
              <label>
                Start date
                <input
                  autoFocus
                  type="date"
                  value={
                    form.lease.start_date
                  }
                  onChange={e =>
                    setLease(
                      'start_date',
                      e.target.value,
                    )
                  }
                />
              </label>

              <label>
                End date
                <input
                  type="date"
                  value={
                    form.lease.end_date
                  }
                  onChange={e =>
                    setLease(
                      'end_date',
                      e.target.value,
                    )
                  }
                />
              </label>

              <label>
                Monthly rent
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    form.lease.rent_amount
                  }
                  onChange={e =>
                    setLease(
                      'rent_amount',
                      Number(e.target.value),
                    )
                  }
                />
              </label>

              <label>
                Deposit
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    form.lease.deposit_amount
                  }
                  onChange={e =>
                    setLease(
                      'deposit_amount',
                      Number(e.target.value),
                    )
                  }
                />
              </label>

              <label>
                Rent due day
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={form.lease.due_day}
                  onChange={e =>
                    setLease(
                      'due_day',
                      Number(e.target.value),
                    )
                  }
                />
              </label>

              <label>
                Grace period
                <input
                  type="number"
                  min="0"
                  max="90"
                  value={
                    form.lease
                      .grace_period_days
                  }
                  onChange={e =>
                    setLease(
                      'grace_period_days',
                      Number(e.target.value),
                    )
                  }
                />
              </label>

              <label>
                Billing frequency

                <select
                  value={
                    form.lease
                      .billing_frequency
                  }
                  onChange={e =>
                    setLease(
                      'billing_frequency',
                      e.target.value,
                    )
                  }
                >
                  <option value="monthly">
                    Monthly
                  </option>

                  <option value="quarterly">
                    Quarterly
                  </option>

                  <option value="yearly">
                    Yearly
                  </option>
                </select>
              </label>

              <label>
                Notes
                <span className="optional">
                  optional
                </span>

                <input
                  value={form.lease.notes}
                  onChange={e =>
                    setLease(
                      'notes',
                      e.target.value,
                    )
                  }
                  placeholder="Any lease notes"
                />
              </label>
            </div>
          </>
        )}

        {step === 6 && (
          <>
            <h1>Review before sending.</h1>

            <p className="muted">
              Dwellio will create the tenant and
              a <strong>pending acceptance</strong>
              lease in one transaction.
            </p>

            <div className="review-list">
              <ReviewRow
                label="Tenant"
                value={
                  form.tenant.full_name
                }
              />

              <ReviewRow
                label="Email"
                value={form.tenant.email}
              />

              <ReviewRow
                label="Phone"
                value={form.tenant.phone}
              />

              <ReviewRow
                label="Unit"
                value={`${selectedProperty?.name ?? '—'} / ${selectedBuilding?.name ?? '—'} / ${selectedFloor?.name ?? '—'} / ${selectedUnit?.name ?? '—'}`}
              />

              <ReviewRow
                label="Lease"
                value={`${form.lease.start_date} → ${form.lease.end_date}`}
              />

              <ReviewRow
                label="Rent"
                value={`KSh ${form.lease.rent_amount.toLocaleString()}`}
              />

              <ReviewRow
                label="Deposit"
                value={`KSh ${form.lease.deposit_amount.toLocaleString()}`}
              />

              <ReviewRow
                label="Status"
                value="Waiting for tenant acceptance · Unit reserved"
              />
            </div>
          </>
        )}

        {error && (
          <div className="alert error">
            {error}
          </div>
        )}

        {success && (
          <div className="alert success">
            {success}
          </div>
        )}

        <div className="actions">
          {step === 1 && (
            <button
              className="secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}

          {step > 1 && (
            <button
              className="secondary"
              onClick={back}
            >
              Back
            </button>
          )}

          {step < 6 ? (
            <button
              className="primary"
              onClick={next}
            >
              Continue
            </button>
          ) : (
            <button
              className="primary"
              onClick={finish}
              disabled={saving}
            >
              {saving
                ? 'Creating tenant…'
                : 'Create & send lease'}
            </button>
          )}
        </div>
      </section>
    </main>
  )
}

function ReviewRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="review-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
11. Add the styling

At the bottom of your existing:

src/styles/global.css

add:

.dashboard-actions{
  display:flex;
  gap:8px;
}

.attention-section{
  margin-top:38px;
}

.section-heading h2{
  margin:0;
  font-size:24px;
  letter-spacing:-.6px;
}

.attention-grid{
  display:grid;
  grid-template-columns:
    repeat(3,minmax(0,1fr));
  gap:14px;
  margin-top:18px;
}

.attention-card{
  background:#fff;
  border:1px solid #e4e8ec;
  border-radius:16px;
  padding:20px;
  min-height:245px;
  display:flex;
  flex-direction:column;
}

.attention-card-top{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
}

.attention-count{
  font-size:28px;
  font-weight:850;
}

.attention-card h3{
  margin:2px 0 0;
  font-size:16px;
}

.attention-card p{
  color:#697582;
  font-size:13px;
  line-height:1.5;
  margin:12px 0 14px;
}

.attention-dot{
  width:9px;
  height:9px;
  border-radius:50%;
  background:#15202b;
  margin-top:7px;
}

.attention-items{
  display:grid;
  gap:7px;
  font-size:12px;
  color:#4f5d69;
}

.attention-items div{
  padding:8px 9px;
  background:#f7f8fa;
  border-radius:8px;
}

.text-action{
  border:0;
  background:none;
  padding:14px 0 0;
  margin-top:auto;
  text-align:left;
  font-size:12px;
  font-weight:800;
  color:#3f4d5a;
}

.tenant-setup-card{
  width:min(1050px,calc(100% - 40px));
}

.form-grid{
  display:grid;
  grid-template-columns:
    repeat(2,minmax(0,1fr));
  gap:18px;
  margin-top:28px;
  max-width:850px;
}

.form-grid label{
  margin:0;
}

.four-columns{
  grid-template-columns:
    repeat(4,minmax(0,1fr));
  max-width:none;
}

.review-list{
  margin-top:28px;
  border:1px solid #e4e8ec;
  border-radius:14px;
  overflow:hidden;
  max-width:850px;
}

.review-row{
  display:grid;
  grid-template-columns:180px 1fr;
  gap:16px;
  padding:14px 16px;
  border-bottom:1px solid #edf0f2;
  font-size:13px;
}

.review-row:last-child{
  border-bottom:0;
}

.review-row span{
  color:#78838e;
}

.review-row strong{
  font-weight:750;
}

.tenant-setup-card .alert{
  margin-top:20px;
}

@media(max-width:900px){
  .attention-grid{
    grid-template-columns:1fr;
  }

  .four-columns{
    grid-template-columns:1fr 1fr;
  }
}

@media(max-width:700px){
  .dashboard-header{
    padding:0 18px;
  }

  .dashboard-content{
    width:calc(100% - 28px);
    margin:32px auto;
  }

  .form-grid,
  .four-columns{
    grid-template-columns:1fr;
  }

  .review-row{
    grid-template-columns:1fr;
    gap:5px;
  }

  .tenant-setup-card{
    width:calc(100% - 20px);
  }
}
12. Connect the new page to App.tsx

Your current app only knows:

Auth
 ↓
Landlord onboarding
 ↓
Dashboard

We now add:

Dashboard
 ↓
/tenants/new
 ↓
Tenant onboarding

Replace your current App.tsx with the updated version:

import { useEffect, useState } from 'react'
import type {
  Session,
  User,
} from '@supabase/supabase-js'

import { supabase } from './lib/supabase'

import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import DashboardPage from './pages/DashboardPage'
import TenantOnboardingPage
  from './pages/TenantOnboardingPage'

export default function App() {
  const [session, setSession] =
    useState<Session | null>(null)

  const [user, setUser] =
    useState<User | null>(null)

  const [loading, setLoading] =
    useState(true)

  const [hasOrganization, setHasOrganization] =
    useState(false)

  const [setupCompleted, setSetupCompleted] =
    useState(false)

  const [organizationId, setOrganizationId] =
    useState<string | null>(null)

  async function loadContext(
    currentUser: User,
  ) {
    const { data } = await supabase
      .from('organization_members')
      .select(
        'organization_id, organizations!inner(id, name, setup_completed)',
      )
      .eq('user_id', currentUser.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle()

    const organization =
      Array.isArray(data?.organizations)
        ? data.organizations[0]
        : data?.organizations

    setHasOrganization(Boolean(data))

    setOrganizationId(
      data?.organization_id ?? null,
    )

    setSetupCompleted(
      organization?.setup_completed === true,
    )
  }

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session)

        setUser(
          data.session?.user ?? null,
        )

        if (data.session?.user) {
          loadContext(data.session.user)
            .finally(() =>
              setLoading(false),
            )
        } else {
          setLoading(false)
        }
      })

    const {
      data: listener,
    } =
      supabase.auth.onAuthStateChange(
        (_event, nextSession) => {
          setSession(nextSession)

          setUser(
            nextSession?.user ?? null,
          )

          if (nextSession?.user) {
            loadContext(nextSession.user)
          } else {
            setHasOrganization(false)
            setSetupCompleted(false)
            setOrganizationId(null)
          }
        },
      )

    return () =>
      listener.subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" />
      </div>
    )
  }

  if (!session || !user) {
    return <AuthPage />
  }

  if (
    !hasOrganization ||
    !setupCompleted ||
    !organizationId
  ) {
    return (
      <OnboardingPage
        user={user}
        onComplete={() =>
          loadContext(user)
        }
      />
    )
  }

  if (
    window.location.pathname ===
    '/tenants/new'
  ) {
    return (
      <TenantOnboardingPage
        organizationId={organizationId}
        onCancel={() => {
          window.location.href = '/'
        }}
        onComplete={() => {
          window.location.href = '/'
        }}
      />
    )
  }

  return (
    <DashboardPage
      user={user}
      organizationId={organizationId}
    />
  )
}
13. Dashboard attention

Now replace your placeholder DashboardPage.tsx.

The dashboard will have:

NEEDS ATTENTION

┌──────────────────┐
│ 2                │
│ Awaiting         │
│ acceptance       │
│                  │
│ G10 · John       │
│ A12 · Mary       │
│                  │
│ Remind tenant →  │
└──────────────────┘

┌──────────────────┐
│ 3                │
│ Expiring within  │
│ 21 days          │
│                  │
│ G03 · 18d left   │
│ A204 · 12d left  │
│                  │
│ Review leases →  │
└──────────────────┘

┌──────────────────┐
│ 1                │
│ Renewal awaiting │
│ response         │
│                  │
│ B12 · John       │
│                  │
│ Review renewals→ │
└──────────────────┘

And the RPC means these aren't fake dashboard cards — they're live database information.

One thing before you run it

Your current project ZIP has the old floor/unit RLS policies in its schema.sql, while you already fixed those policies in your actual Supabase database.

So do not rerun the old entire schema.sql over your working database.

Run the new tenant migration after your current working schema.

Also, the migration uses the corrected hierarchy:

unit
 ↓
floor
 ↓
building
 ↓
property
 ↓
organization

so we don't recreate that property-ID-vs-organization-ID bug we just killed. 😭

14. Your manual testing plan

Since the tenant app doesn't exist yet, your idea of manually creating the 8 users is perfectly fine.

For each test tenant:

Auth user
     ↓
email = john@example.com
     ↓
tenant
user_id = that Auth user's UUID
     ↓
lease
status = active
accepted_at = now()
accepted_by = user's UUID
     ↓
unit
occupied

You can manually do that after the landlord creates the pending leases.

For example:

update public.tenants t
set user_id = u.id
from auth.users u
where t.email = u.email
  and t.email = 'john@example.com';

Then accept that particular lease:

update public.leases
set
  status = 'active',
  accepted_at = now(),
  accepted_by = (
    select user_id
    from public.tenants
    where id = tenant_id
  )
where tenant_id = (
  select id
  from public.tenants
  where email = 'john@example.com'
)
and status = 'pending_acceptance';

The lease trigger will automatically turn the unit:

reserved → occupied

So you're essentially simulating the future tenant app without compromising the architecture.

And this gives us the foundation we're after

We're now at:

                 DWELLIO
                    │
                    ▼
               ORGANIZATION
                    │
                    ▼
                 PROPERTY
                    │
                    ▼
                 BUILDING
                    │
                    ▼
                  FLOOR
                    │
                    ▼
                  UNIT
                    │
        ┌───────────┴───────────┐
        │                       │
      VACANT                 RESERVED
                                │
                                │ pending lease
                                ▼
                             TENANT
                                │
                                ▼
                              LEASE
                                │
                    ┌───────────┴───────────┐
                    │                       │
              PENDING ACCEPTANCE          ACTIVE
                                            │
                                            ▼
                                         OCCUPIED
                                            │
                                            ├── BILLING
                                            ├── PAYMENTS
                                            ├── MAINTENANCE
                                            └── RENEWAL

That's the correct point to stop and test.

Once you run the migration and get the tenant wizard working, the next vertical slice should be Tenant Management itself: tenant list → tenant profile → current lease → lease history → pending acceptance → expiring leases → renewal actions. Then billing can finally sit on top of a reliable lease foundation instead of us having to retrofit it later.