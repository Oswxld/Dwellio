-- Dwellio V1: tenant move-out requests with landlord-only decisions.
-- Run in Supabase SQL Editor (entire file). Review existing data first.
-- No invoice/payment/billing function is changed by this migration.
-- A request is not itself a change to the lease or a legally effective notice.

begin;

create table if not exists public.move_out_requests (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references public.leases(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  proposed_move_out_date date not null,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now(),
  constraint move_out_requests_reason_length
    check (reason is null or length(reason) <= 1000),
  constraint move_out_requests_decision_reason_length
    check (decision_reason is null or length(decision_reason) <= 1000),
  constraint move_out_requests_review_state check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null
      and decision_reason is null)
    or
    (status in ('accepted', 'declined')
      and reviewed_by is not null and reviewed_at is not null
      and (status = 'accepted' or nullif(btrim(decision_reason), '') is not null))
  )
);

create unique index if not exists move_out_requests_one_pending_per_lease
  on public.move_out_requests (lease_id)
  where status = 'pending';

create index if not exists move_out_requests_tenant_history_idx
  on public.move_out_requests (tenant_id, submitted_at desc);

create index if not exists move_out_requests_lease_history_idx
  on public.move_out_requests (lease_id, submitted_at desc);

-- A unit with active OR notice_given tenancy is occupied; do not vacate on notice.
-- Keep pending_confirmation handling aligned with the LIVE lease_status enum.
create or replace function public.sync_unit_status_from_leases(p_unit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if exists (
    select 1 from public.leases l
    where l.unit_id = p_unit_id
      and l.status in ('active', 'notice_given')
      and l.deleted_at is null
  ) then
    update public.units set status = 'occupied' where id = p_unit_id;
  elsif exists (
    select 1 from public.leases l
    where l.unit_id = p_unit_id
      and l.status = 'pending_confirmation'
      and l.deleted_at is null
  ) then
    update public.units set status = 'reserved' where id = p_unit_id;
  else
    update public.units
       set status = 'vacant'
     where id = p_unit_id and status in ('reserved', 'occupied');
  end if;
end;
$function$;

-- Prevent a second occupant being leased while a previous lease is notice_given.
-- If historical data already has conflicting occupying leases, resolve them
-- before applying this index (the migration will otherwise roll back).
create unique index if not exists leases_one_occupying_lease_per_unit
  on public.leases (unit_id)
  where status in ('active', 'notice_given') and deleted_at is null;

-- Tenant's own records are readable, never directly editable by this migration.
alter table public.tenants enable row level security;
drop policy if exists tenants_own_profile_read on public.tenants;
create policy tenants_own_profile_read on public.tenants
  for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.tenants to authenticated;

alter table public.tenant_emergency_contacts enable row level security;
drop policy if exists tenant_contacts_own_read on public.tenant_emergency_contacts;
create policy tenant_contacts_own_read on public.tenant_emergency_contacts
  for select to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  );
grant select on public.tenant_emergency_contacts to authenticated;

alter table public.leases enable row level security;
drop policy if exists leases_own_tenant_read on public.leases;
create policy leases_own_tenant_read on public.leases
  for select to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  );
grant select on public.leases to authenticated;

alter table public.move_out_requests enable row level security;
revoke all on public.move_out_requests from public, anon, authenticated;
grant select on public.move_out_requests to authenticated;
grant select, insert, update, delete on public.move_out_requests to service_role;

drop policy if exists move_out_requests_tenant_read on public.move_out_requests;
create policy move_out_requests_tenant_read on public.move_out_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.tenants t
      where t.id = tenant_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists move_out_requests_management_read on public.move_out_requests;
create policy move_out_requests_management_read on public.move_out_requests
  for select to authenticated
  using (
    public.is_org_admin(
      (select l.organization_id from public.leases l where l.id = lease_id)
    )
  );

-- Ensure tenant accounts can read their own in-app decision notifications.
alter table public.notifications enable row level security;
drop policy if exists notifications_own_read_v1 on public.notifications;
create policy notifications_own_read_v1 on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.notifications to authenticated;

-- Tenant submits a request without modifying the lease or lease_events.
create or replace function public.submit_move_out_request(
  p_lease_id uuid,
  p_proposed_move_out_date date,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lease record;
  v_request_id uuid;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if p_proposed_move_out_date is null
     or p_proposed_move_out_date <= current_date then
    raise exception 'Proposed move-out date must be in the future';
  end if;

  if length(coalesce(p_reason, '')) > 1000 then
    raise exception 'Reason cannot exceed 1000 characters';
  end if;

  select l.id, l.tenant_id, l.organization_id, l.status, l.end_date
    into v_lease
    from public.leases l
    join public.tenants t on t.id = l.tenant_id
   where l.id = p_lease_id
     and l.deleted_at is null
     and t.deleted_at is null
     and t.user_id = v_actor
   for update of l;

  if not found then
    raise exception 'Lease not found or not linked to your tenant account';
  end if;

  if v_lease.status <> 'active' then
    raise exception 'Only active leases can request move-out';
  end if;

  -- V1 supports move-out on or before the current lease end date.
  -- Extensions past lease end require a separate lease/renewal workflow.
  if p_proposed_move_out_date > v_lease.end_date then
    raise exception 'Proposed move-out date cannot exceed lease end date';
  end if;

  if exists (
    select 1 from public.move_out_requests r
    where r.lease_id = v_lease.id and r.status = 'pending'
  ) then
    raise exception 'A move-out request is already pending for this lease';
  end if;

  insert into public.move_out_requests (
    lease_id, tenant_id, proposed_move_out_date, reason
  ) values (
    v_lease.id, v_lease.tenant_id, p_proposed_move_out_date,
    nullif(btrim(p_reason), '')
  )
  returning id into v_request_id;

  insert into public.notifications (
    user_id, type, reference_type, reference_id, title, body
  )
  select distinct
    om.user_id,
    'move_out_request_submitted',
    'move_out_request',
    v_request_id,
    'Move-out request submitted',
    'A tenant requested to move out on ' ||
      p_proposed_move_out_date::text || '. Review the request in Dwellio.'
  from public.organization_members om
  where om.organization_id = v_lease.organization_id
    and om.status = 'active'
    and om.role in ('owner', 'admin', 'manager')
    and om.user_id <> v_actor;

  return v_request_id;
end;
$function$;

-- Accept/decline is owner/admin/manager-only, with all writes atomic.
-- Lock order is LEASE then REQUEST to avoid conflicting concurrent reviews.
create or replace function public.review_move_out_request(
  p_request_id uuid,
  p_decision text,
  p_decision_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_lease_id uuid;
  v_lease record;
  v_request record;
  v_tenant_user_id uuid;
  v_reason text := nullif(btrim(p_decision_reason), '');
  v_notice_date date;
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  if p_decision is null or p_decision not in ('accepted', 'declined') then
    raise exception 'Decision must be accepted or declined';
  end if;

  if length(coalesce(p_decision_reason, '')) > 1000 then
    raise exception 'Decision reason cannot exceed 1000 characters';
  end if;

  if p_decision = 'declined' and v_reason is null then
    raise exception 'A reason is required when declining a request';
  end if;

  select r.lease_id into v_lease_id
    from public.move_out_requests r where r.id = p_request_id;
  if not found then
    raise exception 'Move-out request not found';
  end if;

  select l.id, l.tenant_id, l.organization_id, l.status, l.notice_date,
         l.start_date, l.end_date
    into v_lease
    from public.leases l
   where l.id = v_lease_id and l.deleted_at is null
   for update;

  if not found then
    raise exception 'Associated lease not found';
  end if;

  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = v_lease.organization_id
      and om.user_id = v_actor
      and om.status = 'active'
      and om.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'Only an authorized landlord or manager can review move-out requests';
  end if;

  select * into v_request
    from public.move_out_requests r
   where r.id = p_request_id and r.lease_id = v_lease.id
   for update;

  if not found or v_request.status <> 'pending' then
    raise exception 'Request is no longer pending';
  end if;

  if p_decision = 'accepted' then
    if v_lease.status <> 'active' then
      raise exception 'Only an active lease can enter notice_given';
    end if;
    if v_request.proposed_move_out_date < current_date
       or v_request.proposed_move_out_date > v_lease.end_date then
      raise exception 'Proposed move-out date is no longer valid; decline this request and ask the tenant to resubmit';
    end if;

    -- The request submission date records when the tenant asked for notice.
    -- Use the Kenya-local date instead of relying on server/session timezone.
    v_notice_date := (v_request.submitted_at at time zone 'Africa/Nairobi')::date;

    update public.leases
       set notice_date = v_notice_date,
           move_out_date = v_request.proposed_move_out_date,
           status = 'notice_given',
           updated_at = now()
     where id = v_lease.id;

    insert into public.lease_events (
      lease_id, event_type, effective_date, actor_id,
      previous_status, new_status, previous_notice_date,
      reason, metadata
    ) values (
      v_lease.id, 'notice_given', v_notice_date, v_actor,
      v_lease.status, 'notice_given', v_lease.notice_date,
      'Tenant move-out request accepted',
      pg_catalog.jsonb_build_object(
        'source', 'tenant_move_out_request',
        'move_out_request_id', v_request.id,
        'proposed_move_out_date', v_request.proposed_move_out_date,
        'reviewed_at', now()
      )
    );
  end if;

  update public.move_out_requests
     set status = p_decision,
         reviewed_by = v_actor,
         reviewed_at = now(),
         decision_reason = v_reason
   where id = v_request.id;

  select t.user_id into v_tenant_user_id
    from public.tenants t where t.id = v_lease.tenant_id;

  if v_tenant_user_id is not null then
    insert into public.notifications (
      user_id, type, reference_type, reference_id, title, body
    ) values (
      v_tenant_user_id,
      'move_out_request_reviewed',
      'move_out_request',
      v_request.id,
      case when p_decision = 'accepted'
        then 'Move-out request accepted'
        else 'Move-out request declined' end,
      case when p_decision = 'accepted'
        then 'Your proposed move-out date of ' ||
          v_request.proposed_move_out_date::text || ' was accepted.'
        else 'Your move-out request was declined. Reason: ' ||
          left(v_reason, 300) end
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'request_id', v_request.id,
    'status', p_decision,
    'lease_id', v_lease.id,
    'lease_status', case when p_decision = 'accepted'
      then 'notice_given' else v_lease.status::text end
  );
end;
$function$;

-- Preserve original issue_lease_notice(uuid,date DEFAULT CURRENT_DATE)
-- for LANDLORD-INITIATED notice; no tenant can use it to bypass review.
create or replace function public.issue_lease_notice(
  p_lease_id uuid,
  p_notice_date date default current_date
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_lease record;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;
  if p_notice_date is null then
    raise exception 'Notice date is required';
  end if;

  select l.id, l.organization_id, l.status, l.notice_date, l.end_date
    into v_lease
    from public.leases l
   where l.id = p_lease_id and l.deleted_at is null
   for update;
  if not found then
    raise exception 'Lease not found';
  end if;

  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = v_lease.organization_id
      and om.user_id = v_actor
      and om.status = 'active'
      and om.role in ('owner', 'admin', 'manager')
  ) then
    raise exception 'Only an authorized landlord or manager can issue lease notice';
  end if;
  if v_lease.status <> 'active' then
    raise exception 'Only an active lease can be put on notice';
  end if;
  if exists (
    select 1 from public.move_out_requests r
    where r.lease_id = p_lease_id and r.status = 'pending'
  ) then
    raise exception 'Review the pending tenant move-out request before issuing separate notice';
  end if;

  update public.leases
     set notice_date = p_notice_date,
         move_out_date = v_lease.end_date,
         status = 'notice_given',
         updated_at = now()
   where id = p_lease_id;

  insert into public.lease_events (
    lease_id, event_type, effective_date, actor_id,
    previous_status, new_status, previous_notice_date, reason, metadata
  ) values (
    p_lease_id, 'notice_given', p_notice_date, v_actor,
    v_lease.status, 'notice_given', v_lease.notice_date,
    'Landlord-issued lease notice',
    pg_catalog.jsonb_build_object('source', 'landlord')
  );
end;
$function$;

-- Functions, not client table writes, control all move-out transitions.
revoke all on function public.submit_move_out_request(uuid, date, text) from public, anon;
grant execute on function public.submit_move_out_request(uuid, date, text) to authenticated;
revoke all on function public.review_move_out_request(uuid, text, text) from public, anon;
grant execute on function public.review_move_out_request(uuid, text, text) to authenticated;
revoke all on function public.issue_lease_notice(uuid, date) from public, anon;
grant execute on function public.issue_lease_notice(uuid, date) to authenticated;

-- Reconcile already-noticed occupied units to the corrected unit status logic.
do $do$
declare
  v_unit_id uuid;
begin
  for v_unit_id in
    select distinct l.unit_id
    from public.leases l
    where l.status = 'notice_given' and l.deleted_at is null
  loop
    perform public.sync_unit_status_from_leases(v_unit_id);
  end loop;
end;
$do$;

commit;
