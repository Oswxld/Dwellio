-- Apply this patch INSTEAD OF rerunning the full move-out migration if
-- supabase/tenant_move_out_requests_v1.sql has already been applied.
-- Requires lease_status values: active, notice_given, pending_confirmation,
-- not_moved_in_yet. Does not change lease, invoice, or payment records.

begin;

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
      and l.status in ('pending_confirmation', 'not_moved_in_yet')
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

-- Update units already tied to an active, notice-given, pending-confirmation
-- or not-yet-moved-in lease; the existing lease trigger handles future changes.
do $do$
declare
  v_unit_id uuid;
begin
  for v_unit_id in
    select distinct l.unit_id
    from public.leases l
    where l.status in (
      'active', 'notice_given', 'pending_confirmation', 'not_moved_in_yet'
    )
      and l.deleted_at is null
  loop
    perform public.sync_unit_status_from_leases(v_unit_id);
  end loop;
end;
$do$;

commit;
