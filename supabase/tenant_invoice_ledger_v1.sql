-- Dwellio V1: authenticated, tenant-scoped invoice history & detailed ledger.
-- Apply in Supabase SQL Editor. Does NOT change invoice balances or payment state.
-- The existing backend calculates totals; this read-only API shows them as stored.

begin;

create or replace function public.get_my_tenant_invoices()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'invoice_number', i.invoice_number,
      'status', i.status,
      'issued_at', i.issued_at,
      'created_at', i.created_at,
      'due_date', i.due_date,
      'billing_context', bd.billing_context,
      'period_start', bc.period_start,
      'period_end', bc.period_end,
      'property_name', p.name,
      'unit_name', u.name,
      'current_charges', bd.current_charges,
      'previous_balance', bd.previous_balance,
      'total_payable', bd.total_payable,
      'total_receivable', coalesce(
        nullif(to_jsonb(i)->>'total_receivable', '')::numeric, bd.total_payable
      ),
      'total_paid', coalesce(nullif(to_jsonb(i)->>'total_paid','')::numeric, 0),
      'total_deposit_applied', coalesce(nullif(to_jsonb(i)->>'total_deposit_applied','')::numeric, 0),
      'total_credits', coalesce(nullif(to_jsonb(i)->>'total_credits','')::numeric, 0),
      'total_debits', coalesce(nullif(to_jsonb(i)->>'total_debits','')::numeric, 0),
      'outstanding_amount', i.outstanding_amount
    ) order by bc.period_start desc, i.created_at desc
  ), '[]'::jsonb)
    into v_result
    from public.invoices i
    join public.bill_drafts bd on bd.id = i.bill_draft_id
    join public.billing_cycles bc on bc.id = bd.billing_cycle_id
    join public.tenants t on t.id = bd.tenant_id
    join public.units u on u.id = bd.unit_id
    join public.floors f on f.id = u.floor_id
    join public.buildings b on b.id = f.building_id
    join public.properties p on p.id = b.property_id
   where t.user_id = v_actor
     and t.deleted_at is null
     and i.status <> 'void';

  return v_result;
end;
$function$;

create or replace function public.get_my_tenant_invoice_detail(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_invoice record;
  v_charges jsonb;
  v_sources jsonb;
  v_payments jsonb := '[]'::jsonb;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if p_invoice_id is null then raise exception 'Invoice ID required'; end if;

  select i.id, i.bill_draft_id, i.invoice_number, i.status,
         i.issued_at, i.created_at, i.due_date,
         i.outstanding_amount, to_jsonb(i) as raw_invoice,
         bd.id as draft_id, bd.tenant_id, bd.current_charges,
         bd.previous_balance, bd.total_payable, bd.billing_context,
         bc.period_start, bc.period_end,
         t.full_name as tenant_name, p.name as property_name, u.name as unit_name
    into v_invoice
    from public.invoices i
    join public.bill_drafts bd on bd.id = i.bill_draft_id
    join public.billing_cycles bc on bc.id = bd.billing_cycle_id
    join public.tenants t on t.id = bd.tenant_id
    join public.units u on u.id = bd.unit_id
    join public.floors f on f.id = u.floor_id
    join public.buildings b on b.id = f.building_id
    join public.properties p on p.id = b.property_id
   where i.id = p_invoice_id
     and i.status <> 'void'
     and t.deleted_at is null
     and t.user_id = v_actor;

  if not found then
    -- Do not distinguish nonexistent invoices from someone else's invoices.
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'charge_type', c.charge_type,
      'description', c.description,
      'amount', c.amount,
      'details', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', d.id, 'meter_id', d.meter_id,
          'previous_reading', d.previous_reading,
          'current_reading', d.current_reading,
          'consumption', d.consumption,
          'rate', d.rate
        ) order by d.id), '[]'::jsonb)
        from public.bill_charge_details d where d.bill_charge_id = c.id
      )
    ) order by c.created_at, c.id), '[]'::jsonb)
    into v_charges
    from public.bill_charges c
   where c.bill_draft_id = v_invoice.draft_id;

  -- Preserve the original balance snapshot, one item per source invoice.
  -- Only reveal source invoices belonging to the SAME authenticated tenant.
  select coalesce(jsonb_agg(jsonb_build_object(
    'source_invoice_id', bs.source_invoice_id,
    'invoice_number', source.invoice_number,
    'period_start', source_cycle.period_start,
    'amount', bs.amount
  ) order by source_cycle.period_start desc, source.invoice_number), '[]'::jsonb)
    into v_sources
    from public.bill_draft_balance_sources bs
    join public.invoices source on source.id = bs.source_invoice_id
    join public.bill_drafts source_draft on source_draft.id = source.bill_draft_id
    join public.billing_cycles source_cycle on source_cycle.id = source_draft.billing_cycle_id
   where bs.bill_draft_id = v_invoice.draft_id
     and source_draft.tenant_id = v_invoice.tenant_id;

  -- Only confirmed payments, and only each payment's allocation to this invoice.
  if to_regclass('public.payment_allocations') is not null
     and to_regclass('public.payments') is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'payment_id', p.id,
      'amount_allocated', pa.amount,
      'reference', p.reference,
      'paid_at', coalesce(to_jsonb(p)->>'paid_at', to_jsonb(p)->>'received_at'),
      'method', coalesce(to_jsonb(p)->>'payment_method', to_jsonb(p)->>'method')
    ) order by p.id), '[]'::jsonb)
      into v_payments
      from public.payment_allocations pa
      join public.payments p on p.id = pa.payment_id
     where pa.invoice_id = v_invoice.id
       and p.tenant_id = v_invoice.tenant_id
       and p.status = 'completed';
  end if;

  return jsonb_build_object(
    'invoice', jsonb_build_object(
      'id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'status', v_invoice.status,
      'issued_at', v_invoice.issued_at,
      'created_at', v_invoice.created_at,
      'due_date', v_invoice.due_date,
      'period_start', v_invoice.period_start,
      'period_end', v_invoice.period_end,
      'billing_context', v_invoice.billing_context,
      'property_name', v_invoice.property_name,
      'unit_name', v_invoice.unit_name,
      'tenant_name', v_invoice.tenant_name,
      'current_charges', v_invoice.current_charges,
      'previous_balance', v_invoice.previous_balance,
      'total_payable', v_invoice.total_payable,
      'total_receivable', coalesce(
        nullif(v_invoice.raw_invoice->>'total_receivable', '')::numeric,
        v_invoice.total_payable
      ),
      'total_paid', coalesce(nullif(v_invoice.raw_invoice->>'total_paid','')::numeric, 0),
      'total_deposit_applied', coalesce(nullif(v_invoice.raw_invoice->>'total_deposit_applied','')::numeric, 0),
      'total_credits', coalesce(nullif(v_invoice.raw_invoice->>'total_credits','')::numeric, 0),
      'total_debits', coalesce(nullif(v_invoice.raw_invoice->>'total_debits','')::numeric, 0),
      'outstanding_amount', v_invoice.outstanding_amount
    ),
    'charges', v_charges,
    'balance_sources', v_sources,
    'payments', v_payments
  );
end;
$function$;

revoke all on function public.get_my_tenant_invoices() from public, anon;
revoke all on function public.get_my_tenant_invoice_detail(uuid) from public, anon;
grant execute on function public.get_my_tenant_invoices() to authenticated;
grant execute on function public.get_my_tenant_invoice_detail(uuid) to authenticated;

commit;
