-- Final move-out invoice posting: apply AFTER move_out_inspections_v1.sql,
-- move_out_sms_v1.sql, and the existing full billing/deposit SQL.
--
-- Accounting invariant:
--   Historical receivables stay on their ORIGINAL invoices.
--   The new move_out invoice has itemized INSPECTION charges as receivables.
--   Carried-forward arrears are non-receivable lines with source links.
--   Deposit deductions are allocated via the EXISTING
--   apply_deposit_deduction(security_deposit_id, invoice_id, amount, description)
--   RPC, oldest debt first, then to inspection charges.
--   This prevents a second receivable for old arrears.
--
-- No B2C payments; any unused deposit is recorded as refundable.
-- No SMS is sent automatically.
begin;

create or replace function public.process_move_out_invoice(
  p_inspection_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_inspection record;
  v_lease record;
  v_tenant record;
  v_security_deposit_id uuid;
  v_security_deposit_amount numeric(14,2);
  v_other_deposit_allocations numeric(14,2);
  v_deposit_available numeric(14,2);
  v_deposit_remaining numeric(14,2);
  v_applied numeric(14,2) := 0;
  v_amount numeric(14,2);
  v_arrears numeric(14,2) := 0;
  v_charges numeric(14,2) := 0;
  v_obligations numeric(14,2);
  v_payable numeric(14,2);
  v_refundable numeric(14,2);
  v_invoice_id uuid;
  v_invoice_number text;
  v_settlement_id uuid;
  v_copy_line_id uuid;
  v_charge_type text;
  v_cf_type text;
  v_source record;
  v_charge record;
  v_deposits record;
  v_deposit_candidates integer := 0;
  v_existing uuid;
  v_receivable numeric(14,2);
  v_payments numeric(14,2);
  v_allocated_deposit numeric(14,2);
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  -- Lock inspection and lease; these prevent duplicate submissions.
  select * into v_inspection
    from public.move_out_inspections
   where id = p_inspection_id for update;
  if not found then raise exception 'Inspection does not exist'; end if;

  select l.id, l.organization_id, l.tenant_id, l.unit_id, l.status,
         l.deposit_amount, l.start_date, l.end_date
    into v_lease
    from public.leases l
   where l.id = v_inspection.lease_id and l.deleted_at is null
   for update;
  if not found then raise exception 'Lease not found'; end if;

  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = v_lease.organization_id
      and m.user_id = v_actor and m.status='active'
      and m.role in ('owner','admin','manager')
  ) then raise exception 'Only an authorized landlord or manager can process the final invoice'; end if;
  if v_lease.status::text not in ('active','notice_given','expired') then
    raise exception 'Lease is not eligible for final move-out invoicing';
  end if;
  if v_inspection.status::text <> 'completed' then
    raise exception 'Complete the inspection first';
  end if;
  if v_inspection.tenant_id <> v_lease.tenant_id
     or v_inspection.unit_id <> v_lease.unit_id
     or v_inspection.organization_id <> v_lease.organization_id
     or not public.move_out_inspection_matches_property(
       v_lease.id,v_lease.tenant_id,v_lease.unit_id,v_lease.organization_id
     )
  then raise exception 'Inspection, lease, unit and organization do not match'; end if;

  select id into v_existing from public.move_out_settlements
    where lease_id = v_lease.id;
  if v_existing is not null then
    return (
      select jsonb_build_object(
        'already_processed',true,'invoice_id',s.invoice_id,
        'settlement_id',s.id,'tenant_payable',s.tenant_payable,
        'deposit_refundable',s.deposit_refundable
      ) from public.move_out_settlements s where s.id = v_existing
    );
  end if;
  if exists (
    select 1 from public.invoices i where i.lease_id=v_lease.id
      and i.invoice_type::text='move_out' and i.status::text <> 'void'
  ) then
    raise exception 'An unlinked move-out invoice already exists. Resolve it before processing again';
  end if;

  select t.id,t.full_name,t.phone into v_tenant
    from public.tenants t
   where t.id=v_lease.tenant_id and t.organization_id=v_lease.organization_id
     and t.deleted_at is null;
  if not found then raise exception 'Tenant does not match lease organization'; end if;

  if to_regclass('public.security_deposits') is null
     or to_regclass('public.deposit_allocations') is null
     or to_regprocedure('public.apply_deposit_deduction(uuid,uuid,numeric,text)') is null
     or to_regprocedure('public.refresh_invoice_balance(uuid)') is null then
    raise exception 'Required billing/deposit tables or RPC functions are missing. Deploy the existing deposit accounting migrations first';
  end if;

  -- Fail early if expected enum labels are not in the real schema.
  if not exists (
    select 1 from pg_catalog.pg_enum e
    join pg_catalog.pg_attribute a on a.atttypid=e.enumtypid
    join pg_catalog.pg_class c on c.oid=a.attrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='invoices'
      and a.attname='invoice_type' and e.enumlabel='move_out'
  ) then raise exception 'invoice_type enum needs a move_out label'; end if;

  select e.enumlabel into v_charge_type
    from pg_catalog.pg_enum e
    join pg_catalog.pg_attribute a on a.atttypid=e.enumtypid
    join pg_catalog.pg_class c on c.oid=a.attrelid
   where c.oid='public.invoice_lines'::regclass
     and a.attname='line_type'
     and e.enumlabel in ('move_out_inspection','inspection','adjustment','other')
   order by case e.enumlabel
       when 'move_out_inspection' then 1
       when 'inspection' then 2
       when 'adjustment' then 3 else 4 end
   limit 1;
  select e.enumlabel into v_cf_type
    from pg_catalog.pg_enum e
    join pg_catalog.pg_attribute a on a.atttypid=e.enumtypid
    join pg_catalog.pg_class c on c.oid=a.attrelid
   where c.oid='public.invoice_lines'::regclass
     and a.attname='line_type' and e.enumlabel='carried_forward'
   limit 1;
  if v_charge_type is null or v_cf_type is null then
    raise exception 'invoice_lines.line_type must support an inspection/adjustment label and carried_forward';
  end if;

  -- Lock historic invoices. Every unpaid amount must represent actual
  -- RECEIVABLE lines, not copies from is_receivable=false carry-forwards.
  for v_source in
    select i.id,i.invoice_number,i.outstanding_amount,i.created_at,
           i.due_date,i.issued_at
      from public.invoices i
     where i.tenant_id=v_lease.tenant_id
       and i.status::text <> 'void'
       and i.outstanding_amount > 0
     order by i.due_date nulls last,i.issued_at,i.created_at,i.id
     for update
  loop
    select coalesce(sum(il.amount),0) into v_receivable
      from public.invoice_lines il
     where il.invoice_id=v_source.id and il.is_receivable=true;
    select coalesce(sum(pa.amount),0) into v_payments
      from public.payment_allocations pa
      join public.payments p on p.id=pa.payment_id
     where pa.invoice_id=v_source.id and p.status='completed';
    select coalesce(sum(da.amount),0) into v_allocated_deposit
      from public.deposit_allocations da
     where da.invoice_id=v_source.id;

    -- Cannot safely settle a ledger whose outstanding has duplicate
    -- carried debt or unrecognized balance components.
    if abs(v_source.outstanding_amount -
      greatest(0,v_receivable-v_payments-v_allocated_deposit)) > 0.01 then
      raise exception 'Invoice % does not reconcile with its receivable lines and allocations; final move-out cannot proceed',
        v_source.invoice_number;
    end if;
    v_arrears := v_arrears + v_source.outstanding_amount;
  end loop;

  select coalesce(sum(c.amount),0) into v_charges
    from public.move_out_inspection_bills c
   where c.inspection_id=p_inspection_id;
  v_obligations:=v_arrears+v_charges;

  -- Select ONE actual deposit associated with this tenant and lease.
  -- to_jsonb() supports older live deposit tables with optional lease_id.
  for v_deposits in
    select sd.id, sd.amount, to_jsonb(sd) as raw
    from public.security_deposits sd
    where (to_jsonb(sd)->>'tenant_id')=v_tenant.id::text
      and (
        (to_jsonb(sd)->>'lease_id') is null
        or (to_jsonb(sd)->>'lease_id')=v_lease.id::text
      )
    for update
  loop
    v_deposit_candidates:=v_deposit_candidates+1;
    v_security_deposit_id:=v_deposits.id;
    v_security_deposit_amount:=v_deposits.amount;
  end loop;

  if v_deposit_candidates>1 then
    raise exception 'Multiple security deposit records exist for this tenant/lease; reconcile them before settlement';
  end if;
  if v_deposit_candidates=0 and v_lease.deposit_amount > 0 then
    raise exception 'No recorded security deposit exists. Do not treat the lease agreement as proof that funds were held';
  end if;
  if v_deposit_candidates=0 then
    v_deposit_available:=0;
  else
    select coalesce(sum(amount),0) into v_other_deposit_allocations
      from public.deposit_allocations where security_deposit_id=v_security_deposit_id;
    if v_other_deposit_allocations > 0 then
      raise exception 'Security deposit has already been applied outside this move-out. Review the allocations';
    end if;
    if v_security_deposit_amount is distinct from v_lease.deposit_amount then
      raise exception 'Held security deposit does not match the signed lease amount';
    end if;
    v_deposit_available:=v_security_deposit_amount;
  end if;
  v_deposit_remaining:=v_deposit_available;
  v_applied:=least(v_deposit_available,v_obligations);
  v_payable:=greatest(0,v_obligations-v_deposit_available);
  v_refundable:=greatest(0,v_deposit_available-v_obligations);

  if to_regprocedure('public.generate_invoice_number()') is not null then
    v_invoice_number:=public.generate_invoice_number();
  else
    v_invoice_number:='MO-'||to_char(now() at time zone 'Africa/Nairobi','YYYYMMDD')||
      '-'||left(gen_random_uuid()::text,8);
  end if;

  -- Insert invoice with type label as SQL literal, not a text-to-enum cast.
  execute format(
    'insert into public.invoices (
      bill_draft_id,lease_id,tenant_id,unit_id,invoice_number,invoice_type,
      billing_period_start,billing_period_end,current_charges,previous_balance,
      total_payable,paid_amount,outstanding_amount,status,issued_at,due_date,phone
    ) values (
      null,$1,$2,$3,$4,%L,$5,$5,$6,$7,$8,0,$6,''issued'',now(),$5,$9
    ) returning id','move_out')
  using v_lease.id,v_tenant.id,v_lease.unit_id,v_invoice_number,
        (now() at time zone 'Africa/Nairobi')::date,
        v_charges,v_arrears,v_obligations,v_tenant.phone
    into v_invoice_id;

  for v_charge in
    select c.title,c.description,c.amount
      from public.move_out_inspection_bills c
     where c.inspection_id=p_inspection_id
     order by c.created_at,c.id
  loop
    execute format(
      'insert into public.invoice_lines (
        invoice_id,line_type,description,quantity,unit_rate,amount,is_receivable
      ) values ($1,%L,$2,1,$3,$3,true)',v_charge_type)
    using v_invoice_id,
      v_charge.title||case when nullif(btrim(v_charge.description),'') is null
        then '' else ' - '||v_charge.description end,
      v_charge.amount;
  end loop;

  if v_arrears>0 then
    execute format(
      'insert into public.invoice_lines (
        invoice_id,line_type,description,quantity,unit_rate,amount,is_receivable
      ) values ($1,%L,''Historical unpaid invoices (informational)'',1,$2,$2,false)
      returning id',v_cf_type)
    using v_invoice_id,v_arrears into v_copy_line_id;
  end if;

  insert into public.move_out_settlements(
    invoice_id,lease_id,inspection_id,arrears_total,inspection_total,
    additional_total,deposit_held,deposit_applied,tenant_payable,deposit_refundable
  ) values (
    v_invoice_id,v_lease.id,p_inspection_id,v_arrears,v_charges,
    0,v_deposit_available,v_applied,v_payable,v_refundable
  ) returning id into v_settlement_id;

  -- Snapshot origins BEFORE deducting the security deposit from source invoices.
  for v_source in
    select i.id,i.invoice_number,i.outstanding_amount
      from public.invoices i
     where i.tenant_id=v_lease.tenant_id
       and i.id<>v_invoice_id and i.status::text<>'void'
       and i.outstanding_amount>0
     order by i.due_date nulls last,i.issued_at,i.created_at,i.id
  loop
    insert into public.move_out_settlement_arrears(
      settlement_id,source_invoice_id,amount
    ) values(v_settlement_id,v_source.id,v_source.outstanding_amount);
    if v_copy_line_id is not null then
      insert into public.invoice_line_sources(
        invoice_line_id,source_invoice_id,amount
      ) values(v_copy_line_id,v_source.id,v_source.outstanding_amount);
    end if;
  end loop;

  -- Invoice balances follow EXISTING ledger functions. Do not subtract
  -- deposits by directly rewriting outstanding_amount or paid_amount.
  perform public.refresh_invoice_balance(v_invoice_id);

  -- Apply held deposit FIRST to original outstanding invoices, oldest first.
  -- Original invoices retain accurate balances and payment-allocation paths.
  -- Move-out invoice contains only NEW receivable inspection charges.
  if v_deposit_remaining>0 then
    for v_source in
      select i.id,i.outstanding_amount,i.invoice_number
        from public.invoices i
       where i.tenant_id=v_lease.tenant_id
         and i.id<>v_invoice_id and i.status::text<>'void'
         and i.outstanding_amount>0
       order by i.due_date nulls last,i.issued_at,i.created_at,i.id
    loop
      exit when v_deposit_remaining<=0;
      v_amount:=least(v_deposit_remaining,v_source.outstanding_amount);
      perform public.apply_deposit_deduction(
        v_security_deposit_id,v_source.id,v_amount,
        'Final move-out settlement '||v_invoice_number
      );
      v_deposit_remaining:=v_deposit_remaining-v_amount;
    end loop;
  end if;

  if v_deposit_remaining>0 and v_charges>0 then
    v_amount:=least(v_deposit_remaining,v_charges);
    perform public.apply_deposit_deduction(
      v_security_deposit_id,v_invoice_id,v_amount,
      'Final move-out inspection '||v_invoice_number
    );
    v_deposit_remaining:=v_deposit_remaining-v_amount;
  end if;

  return pg_catalog.jsonb_build_object(
    'already_processed',false,'invoice_id',v_invoice_id,
    'invoice_number',v_invoice_number,'settlement_id',v_settlement_id,
    'arrears_total',v_arrears,'inspection_total',v_charges,
    'deposit_applied',v_applied,'tenant_payable',v_payable,
    'deposit_refundable',v_refundable
  );
end;
$function$;

revoke all on function public.process_move_out_invoice(uuid) from public,anon;
grant execute on function public.process_move_out_invoice(uuid) to authenticated;
commit;
