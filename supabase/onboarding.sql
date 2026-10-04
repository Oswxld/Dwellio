-- Dwellio onboarding transaction
-- Creates the organization, membership, property, buildings, floors and units
-- atomically in one database transaction.

create or replace function public.complete_onboarding(
  p_org_name text,
  p_org_slug text,
  p_property_name text,
  p_address text,
  p_buildings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_property_id uuid;
  v_building_id uuid;
  v_floor_id uuid;

  v_building jsonb;
  v_floor jsonb;
  v_unit jsonb;

  v_building_index integer := 0;
  v_floor_index integer;
  v_unit_index integer;
begin
  -- Make sure somebody is actually authenticated.
  if v_user_id is null then
    raise exception 'You must be signed in to complete onboarding.';
  end if;

  -- Make sure the profile exists.
  if not exists (
    select 1
    from public.profiles
    where id = v_user_id
  ) then
    raise exception 'User profile does not exist.';
  end if;

  -- Basic validation.
  if length(trim(p_org_name)) < 2 then
    raise exception 'Organization name is required.';
  end if;

  if length(trim(p_property_name)) < 1 then
    raise exception 'Property name is required.';
  end if;

  if p_buildings is null
     or jsonb_typeof(p_buildings) <> 'array'
     or jsonb_array_length(p_buildings) < 1 then
    raise exception 'At least one building is required.';
  end if;

  -- Prevent accidentally creating a second organization
  -- during a retry of the same onboarding flow.
  if exists (
    select 1
    from public.organization_members
    where user_id = v_user_id
      and status = 'active'
  ) then
    raise exception 'This user already belongs to an active organization.';
  end if;

  /*
    Everything below happens inside ONE PostgreSQL transaction.

    If any INSERT fails, PostgreSQL rolls back everything:
      organization
      membership
      property
      buildings
      floors
      units
  */

  insert into public.organizations (
    name,
    slug,
    created_by,
    status,
    setup_completed
  )
  values (
    trim(p_org_name),
    trim(p_org_slug),
    v_user_id,
    'active',
    false
  )
  returning id into v_org_id;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    joined_at
  )
  values (
    v_org_id,
    v_user_id,
    'owner',
    'active',
    now()
  );

  insert into public.properties (
    organization_id,
    name,
    address,
    status
  )
  values (
    v_org_id,
    trim(p_property_name),
    nullif(trim(coalesce(p_address, '')), ''),
    'active'
  )
  returning id into v_property_id;

  /*
    Create buildings.
  */
  for v_building in
    select value
    from jsonb_array_elements(p_buildings)
  loop

    insert into public.buildings (
      property_id,
      name,
      sort_order
    )
    values (
      v_property_id,
      trim(v_building->>'name'),
      v_building_index
    )
    returning id into v_building_id;

    /*
      Create floors for this building.
    */
    v_floor_index := 0;

    for v_floor in
      select value
      from jsonb_array_elements(
        coalesce(v_building->'floors', '[]'::jsonb)
      )
    loop

      insert into public.floors (
        building_id,
        name,
        floor_number,
        sort_order
      )
      values (
        v_building_id,
        trim(v_floor->>'name'),
        coalesce(
          (v_floor->>'floorNumber')::integer,
          v_floor_index
        ),
        v_floor_index
      )
      returning id into v_floor_id;

      /*
        Create units for this floor.
      */
      v_unit_index := 0;

      for v_unit in
        select value
        from jsonb_array_elements(
          coalesce(v_floor->'units', '[]'::jsonb)
        )
      loop

        insert into public.units (
          floor_id,
          name,
          position,
          status
        )
        values (
          v_floor_id,
          trim(v_unit->>'name'),
          v_unit_index,
          'vacant'
        );

        v_unit_index := v_unit_index + 1;
      end loop;

      v_floor_index := v_floor_index + 1;
    end loop;

    v_building_index := v_building_index + 1;
  end loop;

  /*
    Only mark onboarding complete after the entire hierarchy
    has successfully been created.
  */
  update public.organizations
  set setup_completed = true
  where id = v_org_id;

  return v_org_id;
end;
$$;

revoke all on function public.complete_onboarding(
  text,
  text,
  text,
  text,
  jsonb
) from public;

grant execute on function public.complete_onboarding(
  text,
  text,
  text,
  text,
  jsonb
) to authenticated;