-- Dwellio multi-landlord M-Pesa foundation (SANDBOX ONLY, no real money).
-- Run in Supabase SQL Editor. Configure a property PayBill for each organization.
-- Dwellio operators provision credentials in Supabase Vault after merchant approval.
-- Nothing here gives landlords access to Daraja secrets or payment write privileges.
begin;

create extension if not exists supabase_vault with schema vault;

create table if not exists public.mpesa_property_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  paybill_shortcode text not null check (paybill_shortcode ~ '^[0-9]{5,7}$'),
  setup_status text not null default 'pending'
    check (setup_status in ('pending','sandbox_ready','live_ready','disabled')),
  credential_secret_id uuid,
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz not null default now(),
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

-- The unique tenant PayBill account reference is not the PayBill shortcode.
-- DW + 10 characters from tenant UUID is stable and <= 12 chars. It may be
-- overridden later by an admin-controlled migration for a landlord's format.
create table if not exists public.mpesa_tenant_accounts (
  property_id uuid not null references public.properties(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  account_reference text not null check (account_reference ~ '^[A-Za-z0-9-]{1,12}$'),
  created_at timestamptz not null default now(),
  primary key (property_id, tenant_id),
  unique (property_id, account_reference)
);

create table if not exists public.mpesa_stk_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  property_id uuid not null references public.properties(id),
  tenant_id uuid not null references public.tenants(id),
  paybill_shortcode text not null,
  account_reference text not null,
  phone_number text not null check (phone_number ~ '^254[17][0-9]{8}$'),
  amount integer not null check (amount between 1 and 150000),
  status text not null default 'initiating'
    check (status in ('initiating','awaiting_callback','callback_received',
                     'initiation_failed','failed','needs_review','confirmed')),
  callback_token uuid not null default gen_random_uuid(),
  checkout_request_id text unique,
  merchant_request_id text,
  response_code text,
  response_description text,
  callback_result_code integer,
  callback_result_description text,
  mpesa_receipt text unique,
  callback_payload jsonb,
  payment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists mpesa_stk_requests_tenant_created_idx
  on public.mpesa_stk_requests(tenant_id, created_at desc);
create index if not exists mpesa_stk_requests_property_created_idx
  on public.mpesa_stk_requests(property_id, created_at desc);

alter table public.mpesa_property_settings enable row level security;
alter table public.mpesa_tenant_accounts enable row level security;
alter table public.mpesa_stk_requests enable row level security;

grant all on public.mpesa_property_settings, public.mpesa_tenant_accounts, public.mpesa_stk_requests to service_role;

-- No table-level grants/policies to browser roles; all browser reads/writes
-- are explicitly mediated through narrow, validated SECURITY DEFINER RPCs.
revoke all on public.mpesa_property_settings from anon, authenticated;
revoke all on public.mpesa_tenant_accounts from anon, authenticated;
revoke all on public.mpesa_stk_requests from anon, authenticated;

create or replace function public.get_my_property_mpesa_settings(p_property_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_organization uuid; v_settings public.mpesa_property_settings%rowtype;
begin
  select p.organization_id into v_organization from public.properties p where p.id = p_property_id and p.deleted_at is null;
  if v_organization is null or not exists (
    select 1 from public.organization_members m
    where m.organization_id = v_organization and m.user_id = auth.uid()
      and m.role in ('owner','admin','manager') and m.status = 'active'
  ) then raise exception 'Not authorized for this property'; end if;
  select * into v_settings from public.mpesa_property_settings where property_id = p_property_id;
  if not found then return jsonb_build_object('property_id',p_property_id,'setup_status','not_configured','paybill_shortcode',null); end if;
  return jsonb_build_object('property_id', p_property_id, 'paybill_shortcode',v_settings.paybill_shortcode,
    'setup_status',v_settings.setup_status,'submitted_at',v_settings.submitted_at, 'verified_at',v_settings.verified_at);
end;
$$;

create or replace function public.request_my_property_mpesa_setup(p_property_id uuid, p_paybill_shortcode text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_short text := btrim(p_paybill_shortcode);
begin
  select p.organization_id into v_org from public.properties p where p.id = p_property_id and p.deleted_at is null;
  if v_org is null or not exists (
    select 1 from public.organization_members m
    where m.organization_id = v_org and m.user_id = auth.uid()
      and m.role in ('owner','admin','manager') and m.status = 'active'
  ) then raise exception 'Not authorized for this property'; end if;
  if v_short !~ '^[0-9]{5,7}$' then raise exception 'Enter a valid numeric PayBill shortcode'; end if;

  insert into public.mpesa_property_settings(
    property_id,organization_id,paybill_shortcode,setup_status,submitted_by,submitted_at
  ) values (p_property_id,v_org,v_short,'pending',auth.uid(),now())
  on conflict (property_id) do update set
    paybill_shortcode = excluded.paybill_shortcode,
    setup_status = case when public.mpesa_property_settings.paybill_shortcode = excluded.paybill_shortcode
                          then public.mpesa_property_settings.setup_status else 'pending' end,
    credential_secret_id = case when public.mpesa_property_settings.paybill_shortcode = excluded.paybill_shortcode
                                 then public.mpesa_property_settings.credential_secret_id else null end,
    verified_at = case when public.mpesa_property_settings.paybill_shortcode = excluded.paybill_shortcode
                         then public.mpesa_property_settings.verified_at else null end,
    submitted_by = auth.uid(), submitted_at = now(), updated_at = now();
  return public.get_my_property_mpesa_settings(p_property_id);
end;
$$;

-- Authenticated tenant reserves an immutable STK attempt. No client-provided
-- PayBill, reference or tenant ID is accepted, and the debt ceiling is checked.
create or replace function public.reserve_my_mpesa_stk(
  p_property_id uuid, p_phone text, p_amount integer
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
 v_user uuid := auth.uid(); v_tenant uuid; v_org uuid;
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

 -- Resolves a tenant with a lease for this exact property, never another org.
 select t.id into v_tenant from public.tenants t
 join public.leases l on l.tenant_id = t.id and l.deleted_at is null
 join public.units u on u.id = l.unit_id
 join public.floors f on f.id = u.floor_id
 join public.buildings b on b.id = f.building_id
 where b.property_id = p_property_id and t.organization_id = v_org
   and t.user_id = v_user and t.deleted_at is null and t.status = 'active'
 order by l.start_date desc limit 1;
 if v_tenant is null then raise exception 'No linked tenancy for this property'; end if;

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

 insert into public.mpesa_tenant_accounts(property_id,tenant_id,account_reference)
 values(p_property_id,v_tenant,'DW' || left(replace(v_tenant::text,'-',''),10))
 on conflict (property_id,tenant_id) do nothing;
 select account_reference into v_reference from public.mpesa_tenant_accounts
 where property_id = p_property_id and tenant_id = v_tenant;

 insert into public.mpesa_stk_requests(
    organization_id,property_id,tenant_id,paybill_shortcode,account_reference,phone_number,amount
 ) values(v_org,p_property_id,v_tenant,v_config.paybill_shortcode,v_reference,v_phone,p_amount)
 returning id,callback_token into v_attempt,v_token;

 return jsonb_build_object('id',v_attempt,'property_id',p_property_id,'tenant_id',v_tenant,
   'amount',p_amount,'phone_number',v_phone,'paybill_shortcode',v_config.paybill_shortcode,
   'account_reference',v_reference, 'status','initiating');
end;
$$;

create or replace function public.get_my_mpesa_stk_status(p_attempt_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare r public.mpesa_stk_requests%rowtype;
begin
 select * into r from public.mpesa_stk_requests
 where id = p_attempt_id and tenant_id in (select id from public.tenants where user_id = auth.uid())
 limit 1;
 if not found then return null; end if;
 return jsonb_build_object('id',r.id,'status',r.status,'amount',r.amount,
   'paybill_shortcode',r.paybill_shortcode,'account_reference',r.account_reference,
   'created_at',r.created_at,'result_code',r.callback_result_code,
   'result_description',r.callback_result_description);
end;
$$;

-- Service-role-only: returns secret credentials to trusted Edge Functions.
-- The JSON is stored as ONE Supabase Vault secret per property.
create or replace function public.get_mpesa_stk_service_context(p_attempt_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_attempt public.mpesa_stk_requests%rowtype;
  v_setting public.mpesa_property_settings%rowtype;
  v_secret text;
begin
 if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
 select * into v_attempt from public.mpesa_stk_requests where id = p_attempt_id;
 if not found then raise exception 'STK request not found'; end if;
 select * into v_setting from public.mpesa_property_settings
 where property_id = v_attempt.property_id and organization_id = v_attempt.organization_id
   and paybill_shortcode = v_attempt.paybill_shortcode and setup_status = 'sandbox_ready';
 if not found then raise exception 'M-Pesa property is not approved for sandbox'; end if;
 select decrypted_secret into v_secret from vault.decrypted_secrets
 where id = v_setting.credential_secret_id;
 if v_secret is null then raise exception 'M-Pesa credentials not provisioned'; end if;
 return jsonb_build_object('attempt',to_jsonb(v_attempt),'credentials',v_secret::jsonb);
end;
$$;

revoke all on function public.get_my_property_mpesa_settings(uuid) from public,anon;
revoke all on function public.request_my_property_mpesa_setup(uuid,text) from public,anon;
revoke all on function public.reserve_my_mpesa_stk(uuid,text,integer) from public,anon;
revoke all on function public.get_my_mpesa_stk_status(uuid) from public,anon;
revoke all on function public.get_mpesa_stk_service_context(uuid) from public,anon,authenticated;
grant execute on function public.get_my_property_mpesa_settings(uuid) to authenticated;
grant execute on function public.request_my_property_mpesa_setup(uuid,text) to authenticated;
grant execute on function public.reserve_my_mpesa_stk(uuid,text,integer) to authenticated;
grant execute on function public.get_my_mpesa_stk_status(uuid) to authenticated;
grant execute on function public.get_mpesa_stk_service_context(uuid) to service_role;

commit;
