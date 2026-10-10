-- Dwellio V1: securely claim registered tenants by VERIFIED Supabase Auth email.
-- Run in Supabase SQL Editor BEFORE pulling/testing the updated tenant sign-in.
-- No client-supplied email or user ID is trusted.
-- Replaces any older, less-restrictive claim_tenant_account() implementation.

create or replace function public.claim_tenant_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_email_confirmed_at timestamptz;
  v_tenant_ids uuid[];
begin
  if v_actor is null then
    raise exception 'Authentication required';
  end if;

  -- Read trusted identity from auth.users, never from a form or user_metadata.
  select pg_catalog.lower(pg_catalog.btrim(u.email)), u.email_confirmed_at
    into v_email, v_email_confirmed_at
    from auth.users u
   where u.id = v_actor;

  if v_email is null or v_email = '' then
    return pg_catalog.jsonb_build_object(
      'status', 'email_missing',
      'linked_user_id', null,
      'tenant_ids', '[]'::jsonb
    );
  end if;

  if v_email_confirmed_at is null then
    return pg_catalog.jsonb_build_object(
      'status', 'email_unverified',
      'linked_user_id', null,
      'tenant_ids', '[]'::jsonb
    );
  end if;

  -- Never transfer tenancy already linked to a different Auth user.
  if exists (
    select 1
      from public.tenants t
     where pg_catalog.lower(pg_catalog.btrim(t.email)) = v_email
       and t.deleted_at is null
       and t.status = 'active'
       and t.user_id is not null
       and t.user_id <> v_actor
  ) then
    return pg_catalog.jsonb_build_object(
      'status', 'already_linked',
      'linked_user_id', null,
      'tenant_ids', '[]'::jsonb
    );
  end if;

  -- A verified email may be registered with more than one organization.
  -- Claim all matching unlinked ACTIVE records, preserving already-linked ones.
  update public.tenants t
     set user_id = v_actor,
         updated_at = now()
   where pg_catalog.lower(pg_catalog.btrim(t.email)) = v_email
     and t.deleted_at is null
     and t.status = 'active'
     and t.user_id is null;

  select pg_catalog.coalesce(pg_catalog.array_agg(t.id), '{}'::uuid[])
    into v_tenant_ids
    from public.tenants t
   where pg_catalog.lower(pg_catalog.btrim(t.email)) = v_email
     and t.deleted_at is null
     and t.status = 'active'
     and t.user_id = v_actor;

  if pg_catalog.cardinality(v_tenant_ids) = 0 then
    return pg_catalog.jsonb_build_object(
      'status', 'not_registered',
      'linked_user_id', null,
      'tenant_ids', '[]'::jsonb
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'linked',
    'linked_user_id', v_actor,
    'tenant_ids', pg_catalog.to_jsonb(v_tenant_ids)
  );
end;
$function$;

revoke all on function public.claim_tenant_account() from public, anon;
grant execute on function public.claim_tenant_account() to authenticated;
