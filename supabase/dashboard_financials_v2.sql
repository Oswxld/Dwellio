-- Dwellio dashboard financial KPIs: SAME billing-period and invoice basis
-- as Billing > Finalized invoices > Total invoiced.
-- Install in Supabase SQL Editor after existing billing tables are present.
-- Read-only, organization-scoped. Excludes void invoices and standalone
-- move-out invoices that have no bill_draft_id / billing cycle.
--
-- For a given month, each finalized invoice contributes the total_payable
-- on its approved bill draft (BillingPage.fetchFinalizedInvoices falls back
-- to draft.total_payable on this project's real invoices schema).
-- Outstanding uses that invoice's stored outstanding_amount.
-- Collected is, per requested dashboard convention, invoiced minus outstanding.
-- This is a snapshot of this month's invoices, NOT gross cash receipts in the
-- calendar month (which could pay older invoices).
begin;

create or replace function public.get_landlord_dashboard_financials(
  p_organization_id uuid, p_period_start date
) returns jsonb
language plpgsql stable security definer set search_path = ''
as $dashboard$
declare
  v_start date;
  v_invoiced numeric := 0;
  v_outstanding numeric := 0;
  v_count bigint := 0;
begin
  if auth.uid() is null or
     not public.is_org_member(p_organization_id) then
    raise exception 'Not authorized to view this organization dashboard';
  end if;
  if p_period_start is null then
    raise exception 'A billing month is required';
  end if;

  v_start := date_trunc('month',p_period_start::timestamp)::date;

  select coalesce(sum(bd.total_payable),0),
         coalesce(sum(i.outstanding_amount),0),count(*)
    into v_invoiced,v_outstanding,v_count
  from public.invoices i
  join public.bill_drafts bd on bd.id=i.bill_draft_id
  join public.billing_cycles bc on bc.id=bd.billing_cycle_id
  join public.properties p on p.id=bc.property_id
  where p.organization_id=p_organization_id
    and p.deleted_at is null
    and i.status::text <> 'void'
    and bc.period_start>=v_start
    and bc.period_start<(v_start+interval '1 month')::date;

  return jsonb_build_object(
    'period_start',v_start,
    'invoice_count',v_count,
    'expected',v_invoiced,
    'outstanding',v_outstanding,
    'collected',v_invoiced-v_outstanding
  );
end;
$dashboard$;

revoke all on function public.get_landlord_dashboard_financials(uuid,date)
  from public,anon;
grant execute on function public.get_landlord_dashboard_financials(uuid,date)
  to authenticated;
commit;
