-- DWELLIO MOVE-OUT CLOSEOUT (corrected, rerunnable)
-- Run AFTER move_out_inspections_v1.sql and after your invoice tables exist.
-- Does not generate invoices or apply a deposit: it requires an actual,
-- non-void invoice of type 'move_out' before ending the lease.
-- Authenticated landlord/manager confirmation is required.
--
-- Property ownership resolution:
-- units.floor_id -> floors.building_id ->
-- buildings.property_id -> properties.organization_id
-- units.property_id is nullable; use floor/building ancestry instead.
--
-- FINALIZE MOVE-OUT is independent of whether a notice was submitted.
-- Does not send SMS or make B2C payments.

begin;

create table if not exists public.move_out_closures (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null unique references public.leases(id) on delete restrict,
  invoice_id uuid not null unique references public.invoices(id) on delete restrict,
  inspection_id uuid not null unique references public.move_out_inspections(id) on delete restrict,
  confirmed_move_out_date date not null,
  closed_by uuid not null references auth.users(id),
  closed_at timestamptz not null default now()
);

create unique index if not exists move_out_closures_lease_unique
  on public.move_out_closures(lease_id);

alter table public.move_out_closures enable row level security;
drop policy if exists move_out_closures_staff_read on public.move_out_closures;

create policy move_out_closures_staff_read
on public.move_out_closures for select to authenticated using (
  exists (
    select 1 from public.leases l
    where l.id = lease_id and public.is_org_admin(l.organization_id)
  )
);
revoke all on public.move_out_closures from anon, authenticated;
grant select on public.move_out_closures to authenticated;

create or replace function public.finalize_move_out(
  p_lease_id uuid,
  p_invoice_id uuid,
  p_move_out_date date,
  p_keys_returned boolean,
  p_unit_vacated boolean
)
returns jsonb language plpgsql security definer set search_path = ''
as $closeout$
declare
  v_actor uuid := auth.uid();
  v_lease record;
  v_inspection record;
  v_invoice record;
  v_unit record;
  v_closure_id uuid;
begin
  if v_actor is null then
    raise exception 'Authentication is required';
  end if;
  if p_lease_id is null or p_invoice_id is null or p_move_out_date is null then
    raise exception 'The lease, move-out invoice and handover date are required';
  end if;
  if p_keys_returned is distinct from true
     or p_unit_vacated is distinct from true then
    raise exception 'Confirm keys returned and physical vacancy before closing';
  end if;
  if p_move_out_date > (now() at time zone 'Africa/Nairobi')::date then
    raise exception 'Confirmed move-out date cannot be in the future';
  end if;

  -- Lock the lease so two closeout attempts cannot both proceed.
  select l.id, l.organization_id, l.tenant_id, l.unit_id,
         l.status, l.start_date
    into v_lease
    from public.leases l
   where l.id = p_lease_id
     and l.deleted_at is null
   for update;
  if not found then
    raise exception 'Lease not found';
  end if;

  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = v_lease.organization_id
      and om.user_id = v_actor
      and om.status = 'active'
      and om.role in ('owner','admin','manager')
  ) then
    raise exception 'Only an authorized landlord or manager may finalize move-out';
  end if;

  -- A re-submission with the SAME final invoice returns the existing closure;
  -- do not allow a second termination or a different invoice after closeout.
  if v_lease.status = 'terminated' then
    select mc.id into v_closure_id
      from public.move_out_closures mc
     where mc.lease_id = v_lease.id
       and mc.invoice_id = p_invoice_id;
    if v_closure_id is null then
      raise exception 'This tenancy was terminated under a different settlement';
    end if;
    return pg_catalog.jsonb_build_object(
      'status','terminated',
      'unit_status','vacant',
      'lease_id',v_lease.id,
      'invoice_id',p_invoice_id,
      'closure_id',v_closure_id
    );
  end if;

  if v_lease.status not in ('active','notice_given','expired') then
    raise exception 'The lease must be active, notice given, or expired to close';
  end if;
  if p_move_out_date < v_lease.start_date then
    raise exception 'Move-out date cannot precede the lease start date';
  end if;

  -- Lease/tenant/unit must belong to the property in this organization.
  -- There is NO units.organization_id, floors.organization_id,
  -- or buildings.organization_id.
  select u.id, u.status, p.id as actual_property_id
    into v_unit
    from public.units u
    join public.floors f on f.id = u.floor_id
    join public.buildings b on b.id = f.building_id
    join public.properties p on p.id = b.property_id
    join public.tenants t on t.id = v_lease.tenant_id
   where u.id = v_lease.unit_id
     and t.organization_id = v_lease.organization_id
     and p.organization_id = v_lease.organization_id
     and u.deleted_at is null
     and f.deleted_at is null
     and b.deleted_at is null
     and p.deleted_at is null
     and t.deleted_at is null
   for update of u;
  if not found then
    raise exception 'The unit, tenant or property hierarchy does not match the lease organization';
  end if;

  if v_unit.status in ('deleted','unavailable','under_maintenance') then
    raise exception 'Unit has a restricted status. Resolve that status before marking vacant';
  end if;

  select mi.id,mi.status,mi.organization_id
    into v_inspection
    from public.move_out_inspections mi
   where mi.lease_id = v_lease.id
     and mi.tenant_id = v_lease.tenant_id
     and mi.unit_id = v_lease.unit_id
   for update;
  if not found
     or v_inspection.status::text <> 'completed'
     or v_inspection.organization_id <> v_lease.organization_id then
    raise exception 'A completed, organization-matched inspection is required';
  end if;

  select i.id, i.invoice_type::text as invoice_type, i.status::text as status
    into v_invoice
    from public.invoices i
   where i.id = p_invoice_id
     and i.lease_id = v_lease.id
     and i.tenant_id = v_lease.tenant_id
     and i.unit_id = v_lease.unit_id
   for update;
  if not found
     or v_invoice.status = 'void'
     or v_invoice.invoice_type <> 'move_out' then
    raise exception 'A non-void processed move-out invoice for this lease is required';
  end if;

  -- A mere invoice of type move_out is not sufficient: require the
  -- finalized, immutable financial settlement snapshot for this inspection.
  if not exists (
    select 1 from public.move_out_settlements ms
    where ms.invoice_id = v_invoice.id
      and ms.lease_id = v_lease.id
      and ms.inspection_id = v_inspection.id
  ) then
    raise exception 'The official move-out settlement must be processed before termination';
  end if;

  -- A unit cannot be vacated if another active or reserved tenancy exists.
  if exists (
    select 1
      from public.leases other
     where other.unit_id = v_lease.unit_id
       and other.id <> v_lease.id
       and other.deleted_at is null
       and other.status::text in (
         'active','notice_given','not_moved_in_yet','pending_confirmation',
         'pending_acceptance'
       )
  ) then
    raise exception 'A different active or reserved lease exists for this unit';
  end if;

  insert into public.move_out_closures (
    lease_id,invoice_id,inspection_id,confirmed_move_out_date,closed_by
  ) values (
    v_lease.id,v_invoice.id,v_inspection.id,p_move_out_date,v_actor
  ) returning id into v_closure_id;

  update public.leases
     set status = 'terminated',
         terminated_at = now(),
         move_out_date = p_move_out_date,
         updated_at = now()
   where id = v_lease.id;

  update public.units
     set status = 'vacant',
         updated_at = now()
   where id = v_lease.unit_id;

  return pg_catalog.jsonb_build_object(
    'status','terminated',
    'unit_status','vacant',
    'lease_id',v_lease.id,
    'invoice_id',v_invoice.id,
    'closure_id',v_closure_id,
    'move_out_date',p_move_out_date
  );
end;
$closeout$;

revoke all on function public.finalize_move_out(uuid,uuid,date,boolean,boolean)
  from public,anon;
grant execute on function public.finalize_move_out(uuid,uuid,date,boolean,boolean)
  to authenticated;

commit;
