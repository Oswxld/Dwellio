-- Move-out final settlement snapshots and full-detail SMS delivery.
-- Standalone from monthly billing cycles. Apply AFTER move_out_inspections_v1.sql.
-- Does not post invoices: the future atomic invoice RPC must write the
-- settlement row together with invoice rows / deposit allocations.
begin;

create table if not exists public.move_out_settlements (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null unique references public.invoices(id) on delete restrict,
  lease_id uuid not null unique references public.leases(id) on delete restrict,
  inspection_id uuid not null unique references public.move_out_inspections(id) on delete restrict,
  arrears_total numeric(14,2) not null check (arrears_total >= 0),
  inspection_total numeric(14,2) not null check (inspection_total >= 0),
  additional_total numeric(14,2) not null default 0 check (additional_total >= 0),
  deposit_held numeric(14,2) not null check (deposit_held >= 0),
  deposit_applied numeric(14,2) not null check (deposit_applied >= 0),
  tenant_payable numeric(14,2) not null check (tenant_payable >= 0),
  deposit_refundable numeric(14,2) not null check (deposit_refundable >= 0),
  created_at timestamptz not null default now(),
  constraint move_out_settlement_amounts_match check (
    deposit_applied = least(deposit_held, arrears_total + inspection_total + additional_total)
    and tenant_payable = greatest(0, arrears_total + inspection_total + additional_total - deposit_held)
    and deposit_refundable = greatest(0, deposit_held - arrears_total - inspection_total - additional_total)
  )
);

-- Snapshot original invoice references (not synthetic repeated carry-forwards).
create table if not exists public.move_out_settlement_arrears (
  settlement_id uuid not null references public.move_out_settlements(id) on delete restrict,
  source_invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  primary key (settlement_id, source_invoice_id)
);

create table if not exists public.move_out_sms_deliveries (
  invoice_id uuid primary key references public.invoices(id) on delete restrict,
  phone text not null,
  message_snapshot text not null,
  status text not null check(status in ('sending','accepted','failed','unknown')),
  environment text not null check(environment in ('sandbox','production')),
  attempt_count integer not null default 1 check(attempt_count > 0),
  provider_message_id text,
  provider_status text,
  provider_cost text,
  error_message text,
  attempted_at timestamptz not null default now(),
  accepted_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.move_out_settlements enable row level security;
alter table public.move_out_settlement_arrears enable row level security;
alter table public.move_out_sms_deliveries enable row level security;

drop policy if exists move_out_settlements_staff_read on public.move_out_settlements;
create policy move_out_settlements_staff_read on public.move_out_settlements
  for select to authenticated using (
    exists (select 1 from public.leases l where l.id = lease_id
      and public.is_org_admin(l.organization_id))
  );

drop policy if exists move_out_settlement_arrears_staff_read on public.move_out_settlement_arrears;
create policy move_out_settlement_arrears_staff_read on public.move_out_settlement_arrears
  for select to authenticated using (
    exists (
      select 1 from public.move_out_settlements s
      join public.leases l on l.id = s.lease_id
      where s.id = settlement_id and public.is_org_admin(l.organization_id)
    )
  );

drop policy if exists move_out_sms_deliveries_staff_read on public.move_out_sms_deliveries;
create policy move_out_sms_deliveries_staff_read on public.move_out_sms_deliveries
  for select to authenticated using (
    exists (
      select 1 from public.move_out_settlements s
      join public.leases l on l.id = s.lease_id
      where s.invoice_id = move_out_sms_deliveries.invoice_id
        and public.is_org_admin(l.organization_id)
    )
  );

revoke all on public.move_out_settlements,public.move_out_settlement_arrears,
  public.move_out_sms_deliveries from public,anon,authenticated;
grant select on public.move_out_settlements, public.move_out_settlement_arrears,
  public.move_out_sms_deliveries to authenticated;
grant select,insert,update on public.move_out_sms_deliveries to service_role;
grant select,insert on public.move_out_settlements,public.move_out_settlement_arrears
  to service_role;

-- Claim is service-role-only: authorization is performed for a signed-in
-- landlord passed by the Edge Function. Message content comes ONLY from the DB.
create or replace function public.claim_move_out_sms_delivery(
  p_invoice_id uuid, p_environment text, p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $claim$
declare
  v record;
  v_items text;
  v_arrears text;
  v_message text;
  v_phone text;
  v_claimed uuid;
  v_status text;
begin
  if p_environment not in ('sandbox','production') then
    raise exception 'Unsupported SMS environment';
  end if;
  select i.id, i.invoice_number, i.status::text as invoice_status,
         i.invoice_type::text as invoice_type,
         l.organization_id, t.full_name, t.phone as tenant_phone,
         p.name as property_name, u.name as unit_name,
         s.id as settlement_id, s.arrears_total, s.inspection_total,
         s.additional_total, s.deposit_held, s.deposit_applied,
         s.tenant_payable, s.deposit_refundable
    into v
    from public.invoices i
    join public.move_out_settlements s on s.invoice_id = i.id
    join public.leases l on l.id = s.lease_id and l.id = i.lease_id
    join public.tenants t on t.id = l.tenant_id and t.id = i.tenant_id
    join public.units u on u.id = l.unit_id and u.id = i.unit_id
    join public.floors f on f.id = u.floor_id
    join public.buildings b on b.id = f.building_id
    join public.properties p on p.id = b.property_id and p.organization_id = l.organization_id
   where i.id = p_invoice_id
   for update of i;
  if not found then raise exception 'Final move-out settlement not found'; end if;
  if v.invoice_type <> 'move_out' or v.invoice_status = 'void' then
    raise exception 'Only a finalized non-void move-out invoice can be sent';
  end if;
  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = v.organization_id and om.user_id = p_actor_id
      and om.status = 'active' and om.role in ('owner','admin','manager')
  ) then raise exception 'Not authorized to send this move-out statement'; end if;

  v_phone := nullif(btrim(v.tenant_phone), '');
  if v_phone is null then
    return jsonb_build_object('claimed',false,'reason','missing_phone');
  end if;

  select coalesce(string_agg(
    ' - ' || c.title || ': KSh ' || to_char(c.amount,'FM9999999990.00') ||
    case when nullif(btrim(c.description),'') is null then ''
      else ' (' || c.description || ')' end,
    E'\n' order by c.created_at,c.id), '(no inspection charges)')
    into v_items
    from public.move_out_inspection_bills c
    join public.move_out_settlements s on s.inspection_id = c.inspection_id
   where s.id = v.settlement_id;

  select coalesce(string_agg(
    ' - ' || orig.invoice_number || ': KSh ' ||
      to_char(a.amount,'FM9999999990.00') ||
      coalesce(
        (select ' (' || string_agg(il.description,
          '; ' order by il.created_at, il.id) || ')'
         from public.invoice_lines il
         where il.invoice_id = orig.id and il.is_receivable = true
           and nullif(btrim(il.description),'') is not null),
        ''
      ),
    E'\n' order by orig.created_at,orig.id), '(no previous arrears)')
    into v_arrears
    from public.move_out_settlement_arrears a
    join public.invoices orig on orig.id = a.source_invoice_id
   where a.settlement_id = v.settlement_id;

  v_message := 'DWELLIO FINAL MOVE-OUT STATEMENT' || E'\n' ||
    'Invoice: ' || v.invoice_number || E'\n' ||
    'Tenant: ' || v.full_name || E'\n' ||
    'Property: ' || v.property_name || ', Unit ' || v.unit_name || E'\n' ||
    'PREVIOUS ARREARS:' || E'\n' || v_arrears || E'\n' ||
    'INSPECTION CHARGES:' || E'\n' || v_items || E'\n' ||
    'Arrears total: KSh ' || to_char(v.arrears_total,'FM9999999990.00') || E'\n' ||
    'Inspection total: KSh ' || to_char(v.inspection_total,'FM9999999990.00') || E'\n' ||
    'Other final charges: KSh ' || to_char(v.additional_total,'FM9999999990.00') || E'\n' ||
    'Deposit held: KSh ' || to_char(v.deposit_held,'FM9999999990.00') || E'\n' ||
    'Deposit applied: KSh ' || to_char(v.deposit_applied,'FM9999999990.00') || E'\n' ||
    'Amount owed: KSh ' || to_char(v.tenant_payable,'FM9999999990.00') || E'\n' ||
    'Deposit refundable: KSh ' || to_char(v.deposit_refundable,'FM9999999990.00') || E'\n' ||
    'Refunds handled separately by property management.';

  -- Refuse omission if an SMS gateway's practical length limit is reached.
  if char_length(v_message) > 6000 then
    raise exception 'Final statement too long for SMS (6000 characters); use printed/PDF statement';
  end if;

  insert into public.move_out_sms_deliveries(
    invoice_id,phone,message_snapshot,status,environment
  ) values (v.id,v_phone,v_message,'sending',p_environment)
  on conflict(invoice_id) do update
    set phone=excluded.phone,message_snapshot=excluded.message_snapshot,
      status='sending',environment=excluded.environment,
      attempt_count=public.move_out_sms_deliveries.attempt_count+1,
      provider_message_id=null,provider_status=null,provider_cost=null,
      error_message=null,accepted_at=null,attempted_at=now(),updated_at=now()
    where public.move_out_sms_deliveries.status = 'failed'
  returning invoice_id into v_claimed;

  if v_claimed is null then
    select status into v_status from public.move_out_sms_deliveries
      where invoice_id = p_invoice_id;
    return jsonb_build_object('claimed',false,'reason','already_' ||
      coalesce(v_status,'processed'));
  end if;

  return jsonb_build_object(
    'claimed',true,'invoice_id',v.id,'phone',v_phone,'message',v_message
  );
end;
$claim$;

revoke all on function public.claim_move_out_sms_delivery(uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.claim_move_out_sms_delivery(uuid,text,uuid)
  to service_role;
commit;
