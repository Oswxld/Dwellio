-- Dwellio property configuration: create a complete floor WITH units,
-- optionally creating its building in the same transaction.
-- Never leaves a new building without a floor or a new floor without units.
-- Does not affect existing buildings/floors/units and is safe to install twice.
--
-- Args:
--   p_building_id = NULL and p_building_name nonempty -> new building
--   p_building_id = existing UUID and p_building_name NULL -> add floor there
--   p_units = [{"name":"A01","default_rent_amount":12000}, ...]
begin;
create or replace function public.add_property_structure_bundle(
  p_property_id uuid,
  p_building_id uuid,
  p_building_name text,
  p_floor_name text,
  p_floor_number integer,
  p_units jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $bundle$
declare
  v_org uuid;
  v_building_id uuid := p_building_id;
  v_floor_id uuid;
  v_item jsonb;
  v_name text;
  v_rent numeric;
  v_idx integer := 0;
  v_building_name text := nullif(btrim(p_building_name),'');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in';
  end if;
  if p_property_id is null then
    raise exception 'Select a property';
  end if;
  if nullif(btrim(p_floor_name),'') is null or char_length(btrim(p_floor_name))>100 then
    raise exception 'Enter a valid floor name (1-100 characters)';
  end if;
  if p_floor_number is null then
    raise exception 'Enter a floor number';
  end if;
  if p_units is null or jsonb_typeof(p_units)<>'array'
     or jsonb_array_length(p_units)<1 or jsonb_array_length(p_units)>150 then
    raise exception 'Each new floor must have between 1 and 150 units';
  end if;

  -- Serializes building sort order; property is the owning organization.
  select p.organization_id into v_org
  from public.properties p where p.id=p_property_id
    and p.deleted_at is null and p.status::text<>'deleted'
  for update;
  if not found then raise exception 'Property is missing or deleted'; end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id=v_org and m.user_id=auth.uid()
      and m.status::text='active'
      and m.role in ('owner','admin','manager')
  ) then
    raise exception 'Only the landlord or authorized manager can configure properties';
  end if;

  if v_building_id is null then
    if v_building_name is null or char_length(v_building_name)>100 then
      raise exception 'Enter a building name (1-100 characters)';
    end if;
    insert into public.buildings(property_id,name,sort_order)
    select p_property_id,v_building_name,coalesce(max(sort_order),-1)+1
    from public.buildings where property_id=p_property_id
    returning id into v_building_id;
  else
    if v_building_name is not null then
      raise exception 'Choose either an existing building or a new building name';
    end if;
    perform 1 from public.buildings b
    where b.id=v_building_id and b.property_id=p_property_id and b.deleted_at is null
    for update;
    if not found then raise exception 'Selected building does not belong to this property'; end if;
  end if;

  insert into public.floors(building_id,name,floor_number,sort_order)
  values(v_building_id,btrim(p_floor_name),p_floor_number,p_floor_number)
  returning id into v_floor_id;

  for v_item in select value from jsonb_array_elements(p_units)
  loop
    if jsonb_typeof(v_item)<>'object' then
      raise exception 'Each unit must be an object with a name';
    end if;
    v_name := nullif(btrim(v_item->>'name'),'');
    if v_name is null or char_length(v_name)>100 then
      raise exception 'Each unit needs a name of 1-100 characters';
    end if;
    if v_item->>'default_rent_amount' is null
       or nullif(btrim(v_item->>'default_rent_amount'),'') is null then
      v_rent := null;
    else
      v_rent := (v_item->>'default_rent_amount')::numeric;
      if v_rent < 0 or v_rent > 9999999999.99 then
        raise exception 'Unit % has an invalid rent',v_name;
      end if;
    end if;
    insert into public.units(floor_id,name,position,status,default_rent_amount)
    values(v_floor_id,v_name,v_idx,'vacant',v_rent);
    v_idx:=v_idx+1;
  end loop;
  return jsonb_build_object(
    'building_id',v_building_id,'floor_id',v_floor_id,'units_created',v_idx
  );
end;
$bundle$;

revoke all on function public.add_property_structure_bundle(
  uuid,uuid,text,text,integer,jsonb
) from public,anon;
grant execute on function public.add_property_structure_bundle(
  uuid,uuid,text,text,integer,jsonb
) to authenticated;
commit;
