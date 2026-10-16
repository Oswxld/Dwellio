-- Dwellio monthly financial dashboard — verified against live October 2026 schema.
-- Function-only migration: NO table, column, index, trigger or RLS changes.
--
-- Same invoice set as Billing > Finalized invoices:
--   active property -> billing cycle in selected month -> bill draft ->
--   non-void finalized invoice.
--
-- Billing's "Total invoiced" reads bill_drafts.total_payable for this
-- deployed invoice schema. Outstanding reads invoices.outstanding_amount.
-- Collected = Expected - Outstanding, NOT calendar-month cash deposits.
--
-- SECURITY INVOKER preserves the existing table RLS policies, in addition
-- to requiring the caller to be an active owner/admin/manager of the
-- requested organization. Tenant accounts cannot use this RPC to fetch
-- landlord financial aggregates.
create or replace function public.get_landlord_dashboard_financials(
  p_organization_id uuid,
  p_period_start date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_month date;
  v_invoice_count bigint := 0;
  v_expected numeric := 0;
  v_outstanding numeric := 0;
begin
  if auth.uid() is null
     or p_organization_id is null
     or not coalesce(public.is_org_admin(p_organization_id), false)
  then
    raise exception 'Only an authorized landlord or manager can view these financials'
      using errcode = '42501';
  end if;

  if p_period_start is null then
    raise exception 'Select a billing month' using errcode = '22023';
  end if;

  v_month := date_trunc('month', p_period_start::timestamp)::date;

  select
    count(i.id),
    coalesce(sum(bd.total_payable), 0),
    coalesce(sum(i.outstanding_amount), 0)
  into v_invoice_count, v_expected, v_outstanding
  from public.properties p
  join public.billing_cycles bc on bc.property_id = p.id
  join public.bill_drafts bd on bd.billing_cycle_id = bc.id
  join public.invoices i on i.bill_draft_id = bd.id
  where p.organization_id = p_organization_id
    and p.status = 'active'
    and p.deleted_at is null
    and bc.period_start >= v_month
    and bc.period_start < (v_month + interval '1 month')::date
    and i.status::text <> 'void';

  return jsonb_build_object(
    'period_start', v_month,
    'invoice_count', v_invoice_count,
    'expected', v_expected,
    'outstanding', v_outstanding,
    'collected', v_expected - v_outstanding
  );
end;
$function$;

revoke all on function public.get_landlord_dashboard_financials(uuid, date)
  from public, anon;
grant execute on function public.get_landlord_dashboard_financials(uuid, date)
  to authenticated;

-- Force PostgREST to recognize the new RPC signature immediately.
notify pgrst, 'reload schema';
