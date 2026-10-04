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