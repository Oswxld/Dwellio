-- Dwellio follow-up: use the actual unit number for M-Pesa PayBill account.
-- Run AFTER mpesa_multi_landlord_foundation_v1.sql; retains prior attempt history.
-- Unit names must be unique within each PayBill and 1-12 alphanumeric/hyphen chars.
-- New STK requests use units.name, rather than legacy mpesa_tenant_accounts.
-- SANDBOX ONLY; does NOT settle/allocate payments.
begin;

create or replace function public.reserve_my_mpesa_stk(
  p_property_id uuid, p_phone text, p_amount integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
 v_user uuid := auth.uid(); v_tenant uuid; v_org uuid; v_unit uuid; v_units integer;
 v_config public.mpesa_property_settings%rowtype;
 v_reference text; v_phone text := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
 v_due numeric; v_attempt uuid; v_token uuid;
begin
 if v_user is null then raise exception 'Sign in required'; end if;
 if v_phone ~ '^0[17][0-9]{8}$' then v_phone := '254' || substring(v_phone from 2); end if;
 if v_phone !~ '^254[17][0-9]{8}$' then raise exception 'Enter a valid Kenyan M-Pesa mobile number'; end if;
 if p_amount is null or p_amount < 1 or p_amount > 150000 then raise exception 'Invalid M-Pesa amount'; end if;

 select p.organization_id into v_org from public.properties p
 where p.id = p_property_id and p.deleted_at is null;
 if v_org is null then raise exception 'Property not found'; end if;


 -- Resolve exactly ONE currently linked unit for the property and tenant.
 -- The unit's actual name/number becomes the PayBill account reference.
 select count(distinct u.id) into v_units
 from public.tenants t
 join public.leases l on l.tenant_id = t.id and l.deleted_at is null
 join public.units u on u.id = l.unit_id and u.deleted_at is null
 join public.floors f on f.id = u.floor_id
 join public.buildings b on b.id = f.building_id
 where b.property_id = p_property_id and t.organization_id = v_org
   and t.user_id = v_user and t.deleted_at is null and t.status = 'active'
   and l.status::text in ('active','notice_given','not_moved_in_yet');

 if v_units <> 1 then
   raise exception 'One current tenant unit is required for M-Pesa; contact property management';
 end if;

 select t.id, u.id, btrim(u.name) into v_tenant, v_unit, v_reference
 from public.tenants t
 join public.leases l on l.tenant_id = t.id and l.deleted_at is null
 join public.units u on u.id = l.unit_id and u.deleted_at is null
 join public.floors f on f.id = u.floor_id
 join public.buildings b on b.id = f.building_id
 where b.property_id = p_property_id and t.organization_id = v_org
   and t.user_id = v_user and t.deleted_at is null and t.status = 'active'
   and l.status::text in ('active','notice_given','not_moved_in_yet')
 order by l.start_date desc limit 1;

 if v_reference is null or v_reference !~ '^[A-Za-z0-9-]{1,12}$' then
   raise exception 'Unit number must be 1-12 letters, digits or hyphens for M-Pesa';
 end if;

 select * into v_config from public.mpesa_property_settings
 where property_id = p_property_id and organization_id = v_org;
 if not found or v_config.setup_status <> 'sandbox_ready' or v_config.credential_secret_id is null
 then raise exception 'M-Pesa setup is not yet ready for this property'; end if;

 -- Existing auto_allocate_payment() allocates across all invoices for a
 -- tenant, not just this property's PayBill. Fail closed on cross-property
 -- arrears until property-scoped payment allocation is implemented.
 if exists (
   select 1 from public.invoices i
   join public.bill_drafts bd on bd.id = i.bill_draft_id
   join public.units u on u.id = bd.unit_id
   join public.floors f on f.id = u.floor_id
   join public.buildings b on b.id = f.building_id
   where i.tenant_id = v_tenant
     and i.status <> 'void' and i.outstanding_amount > 0
     and b.property_id <> p_property_id
 ) then
   raise exception 'Payments across multiple properties require separate allocation setup';
 end if;

 v_due := public.get_tenant_outstanding_balance(v_tenant);
 if v_due is null or v_due < p_amount then raise exception 'Amount exceeds unpaid tenant balance'; end if;

 -- One active request per tenant/property in a 2-minute guard window.
 perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || p_property_id::text, 0));
 if exists (select 1 from public.mpesa_stk_requests r
     where r.tenant_id = v_tenant and r.property_id = p_property_id
       and r.status in ('initiating','awaiting_callback','callback_received')
       and r.created_at > now() - interval '2 minutes')
 then raise exception 'An M-Pesa prompt is already in progress. Check its status before requesting another.'; end if;


 -- One PayBill account reference must resolve to one unit; even when the
 -- landlord shares a PayBill across several properties or buildings.
 if exists (
   select 1 from public.units other_u
   join public.floors other_f on other_f.id = other_u.floor_id
   join public.buildings other_b on other_b.id = other_f.building_id
   join public.properties other_p on other_p.id = other_b.property_id
   join public.mpesa_property_settings other_cfg on other_cfg.property_id = other_p.id
   where other_u.id <> v_unit
     and other_u.deleted_at is null and other_f.deleted_at is null
     and other_b.deleted_at is null and other_p.deleted_at is null
     and other_cfg.paybill_shortcode = v_config.paybill_shortcode
     and other_cfg.setup_status in ('sandbox_ready','live_ready')
     and lower(btrim(other_u.name)) = lower(v_reference)
 ) then
   raise exception 'Unit account reference is duplicated on this PayBill; ask property management to assign unique unit numbers';
 end if;

 insert into public.mpesa_stk_requests(
    organization_id,property_id,tenant_id,paybill_shortcode,account_reference,phone_number,amount
 ) values(v_org,p_property_id,v_tenant,v_config.paybill_shortcode,v_reference,v_phone,p_amount)
 returning id,callback_token into v_attempt,v_token;

 return jsonb_build_object('id',v_attempt,'property_id',p_property_id,'tenant_id',v_tenant,
   'amount',p_amount,'phone_number',v_phone,'paybill_shortcode',v_config.paybill_shortcode,
   'account_reference',v_reference, 'status','initiating');
end;
$$;

revoke all on function public.reserve_my_mpesa_stk(uuid,text,integer) from public,anon;
grant execute on function public.reserve_my_mpesa_stk(uuid,text,integer) to authenticated;

commit;
