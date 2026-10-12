-- Dwellio move-out closeout: apply after move_out_inspections_v1.sql.
-- IMPORTANT: This does not create the final invoice. It will only terminate a
-- tenancy after an independently created, non-void move_out invoice exists.
-- No SMS is sent and no B2C payment is made.
create table if not exists public.move_out_closures (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null unique references public.leases(id),
  invoice_id uuid not null unique references public.invoices(id),
  inspection_id uuid not null unique references public.move_out_inspections(id),
  confirmed_move_out_date date not null,
  closed_by uuid not null,
  closed_at timestamptz not null default now()
);

alter table public.move_out_closures enable row level security;
create policy move_out_closures_staff_read on public.move_out_closures
  for select to authenticated using (
    exists (
      select 1 from public.leases l where l.id = lease_id
        and public.is_org_admin(l.organization_id)
    )
  );
grant select on public.move_out_closures to authenticated;

create or replace function public.finalize_move_out(
  p_lease_id uuid,
  p_invoice_id uuid,
  p_move_out_date date,
  p_keys_returned boolean,
  p_unit_vacated boolean
) returns jsonb language plpgsql security definer set search_path = ''
as $body$
declare
  v_actor uuid := auth.uid();
  v_lease record;
  v_invoice record;
  v_inspection record;
  v_closed uuid;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_lease_id is null or p_invoice_id is null or p_move_out_date is null then
    raise exception 'Lease, final invoice and move-out date are required';
  end if;
  if p_keys_returned is not true or p_unit_vacated is not true then
    raise exception 'Confirm keys and physical handover before vacating the unit';
  end if;
  if p_move_out_date > (now() at time zone 'Africa/Nairobi')::date then
    raise exception 'Move-out date cannot be in the future';
  end if;

  select l.id,l.organization_id,l.tenant_id,l.unit_id,l.status,l.start_date
    into v_lease from public.leases l
   where l.id = p_lease_id and l.deleted_at is null for update;
  if not found then raise exception 'Lease not found'; end if;
  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = v_lease.organization_id
      and om.user_id = v_actor and om.status = 'active'
      and om.role in ('owner','admin','manager')
  ) then raise exception 'Not authorized to finalize this tenancy'; end if;

  if v_lease.status = 'terminated' then
    select id into v_closed from public.move_out_closures
     where lease_id = p_lease_id and invoice_id = p_invoice_id;
    if v_closed is null then raise exception 'This lease was already terminated under a different settlement'; end if;
    return jsonb_build_object('status','terminated','unit_status','vacant','closure_id',v_closed);
  end if;
  if v_lease.status not in ('active','notice_given','expired') then
    raise exception 'Lease is not eligible for move-out closure';
  end if;
  if p_move_out_date < v_lease.start_date then
    raise exception 'Move-out date cannot precede lease start';
  end if;

  select id,status into v_inspection from public.move_out_inspections
   where lease_id = p_lease_id for update;
  if not found or v_inspection.status <> 'completed' then
    raise exception 'The move-out inspection must be completed';
  end if;

  select i.id,i.invoice_type::text as invoice_type,i.status,i.tenant_id,i.unit_id
    into v_invoice from public.invoices i
   where i.id = p_invoice_id and i.lease_id = p_lease_id
     and i.tenant_id = v_lease.tenant_id and i.unit_id = v_lease.unit_id
   for update;
  if not found or v_invoice.status = 'void' or v_invoice.invoice_type <> 'move_out' then
    raise exception 'A processed non-void move-out invoice is required';
  end if;

  perform 1 from public.units where id = v_lease.unit_id for update;
  if exists (
    select 1 from public.leases other
     where other.unit_id = v_lease.unit_id and other.id <> v_lease.id
       and other.deleted_at is null
       and other.status in ('active','notice_given','not_moved_in_yet','pending_confirmation')
  ) then raise exception 'Unit cannot be released: another live or reserved lease exists'; end if;

  insert into public.move_out_closures
    (lease_id,invoice_id,inspection_id,confirmed_move_out_date,closed_by)
    values (v_lease.id,v_invoice.id,v_inspection.id,p_move_out_date,v_actor)
    returning id into v_closed;

  update public.leases
    set status = 'terminated', terminated_at = now(),
        move_out_date = p_move_out_date, updated_at = now()
    where id = v_lease.id;
  update public.units
    set status = 'vacant', updated_at = now()
    where id = v_lease.unit_id;

  return jsonb_build_object(
    'status','terminated','unit_status','vacant',
    'lease_id',v_lease.id,'invoice_id',v_invoice.id,
    'closure_id',v_closed,'move_out_date',p_move_out_date
  );
end;
$body$;

revoke all on function public.finalize_move_out(uuid,uuid,date,boolean,boolean)
  from public,anon;
grant execute on function public.finalize_move_out(uuid,uuid,date,boolean,boolean)
  to authenticated;
