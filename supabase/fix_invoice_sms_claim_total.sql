-- Fix Dwellio invoice SMS claim error: "column i.total_receivable does not exist".
-- Safe to run against the existing deployed database.
-- Replaces only public.claim_invoice_sms_delivery; does not modify invoice amounts.
-- Invoice SMS total comes from the approved bill draft's total_payable.

create or replace function public.claim_invoice_sms_delivery(
  p_invoice_id uuid,
  p_environment text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice record;
  v_claimed uuid;
  v_existing_status text;
  v_allowed boolean;
begin
  if p_environment not in ('sandbox', 'production') then
    raise exception 'Invalid SMS environment';
  end if;

  select
    i.id,
    i.invoice_number,
    i.phone,
    bd.total_payable AS total_receivable,
    i.due_date,
    i.status as invoice_status,
    bd.billing_cycle_id,
    bc.property_id,
    p.organization_id,
    bc.status as billing_status,
    p.name as property_name
  into v_invoice
  from public.invoices i
  join public.bill_drafts bd on bd.id = i.bill_draft_id
  join public.billing_cycles bc on bc.id = bd.billing_cycle_id
  join public.properties p on p.id = bc.property_id
  where i.id = p_invoice_id
  for update of i;

  if not found then
    raise exception 'Invoice not found';
  end if;

  -- This RPC is service-role-only; verify the authenticated actor explicitly.
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = v_invoice.organization_id
      and om.user_id = p_actor_id
      and om.status = 'active'
      and om.role in ('owner', 'admin', 'manager')
  )
  into v_allowed;

  if v_allowed is not true then
    raise exception 'Not authorized to send invoices for this property';
  end if;

  if v_invoice.invoice_status = 'void'
     or v_invoice.billing_status not in ('invoiced', 'sent') then
    raise exception 'Only finalized, non-void invoices can be sent';
  end if;

  if nullif(btrim(v_invoice.phone), '') is null then
    return jsonb_build_object('claimed', false, 'reason', 'missing_phone');
  end if;

  insert into public.invoice_sms_deliveries (
    invoice_id, billing_cycle_id, phone, status, environment
  )
  values (
    v_invoice.id,
    v_invoice.billing_cycle_id,
    btrim(v_invoice.phone),
    'sending',
    p_environment
  )
  on conflict (invoice_id) do update
  set
    phone = excluded.phone,
    status = 'sending',
    environment = excluded.environment,
    provider_message_id = null,
    provider_status = null,
    cost = null,
    error_message = null,
    accepted_at = null,
    attempt_count = public.invoice_sms_deliveries.attempt_count + 1,
    attempted_at = now(),
    updated_at = now()
  where public.invoice_sms_deliveries.status = 'failed'
  returning invoice_id into v_claimed;

  if v_claimed is null then
    select d.status into v_existing_status
    from public.invoice_sms_deliveries d
    where d.invoice_id = p_invoice_id;

    return jsonb_build_object(
      'claimed', false,
      'reason', 'already_' || coalesce(v_existing_status, 'processed')
    );
  end if;

  return jsonb_build_object(
    'claimed', true,
    'invoice_id', v_invoice.id,
    'phone', btrim(v_invoice.phone),
    'invoice_number', v_invoice.invoice_number,
    'total_receivable', v_invoice.total_receivable,
    'due_date', v_invoice.due_date,
    'property_name', v_invoice.property_name
  );
end;
$$;

revoke all on function public.claim_invoice_sms_delivery(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_invoice_sms_delivery(uuid, text, uuid) to service_role;
