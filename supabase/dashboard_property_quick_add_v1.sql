-- Dashboard quick add: 3 separate, atomic, RLS-protected RPCs.
-- Table structure, triggers, policies and existing RPCs stay untouched.
-- The existing sync_unit_property_id_trigger populates units.property_id.
create or replace function public.dashboard_add_building_with_floor_units(p_property_id uuid,p_building_name text,p_floor_name text,p_floor_number integer,p_units jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare v_floor_id uuid; v_unit jsonb; v_name text; v_rent numeric;
v_pos integer; v_count integer; v_names text[]:=array[]::text[]; v_building_id uuid; v_sort integer;
begin
if auth.uid() is null or not coalesce(public.can_manage_property(p_property_id),false) then
raise exception 'Only an authorized landlord or manager can configure this property' using errcode='42501'; end if;

  perform 1 from public.properties p where p.id=p_property_id and p.deleted_at is null
    and p.status='active' for update;
  if not found then raise exception 'Select an active property' using errcode='22023'; end if;
  if nullif(btrim(p_building_name),'') is null or length(btrim(p_building_name))>100 then
     raise exception 'Enter a valid building name (1–100 characters)' using errcode='22023'; end if;
  if nullif(btrim(p_floor_name),'') is null or length(btrim(p_floor_name))>100
then raise exception 'Enter a valid floor name (1–100 characters)' using errcode='22023'; end if;
if p_floor_number is null then raise exception 'Enter a floor number' using errcode='22023'; end if;
  if exists(select 1 from public.buildings b where b.property_id=p_property_id
     and b.deleted_at is null and lower(b.name)=lower(btrim(p_building_name))) then
      raise exception 'A building with that name already exists in this property' using errcode='23505'; end if;
  select coalesce(max(sort_order),-1)+1 into v_sort from public.buildings where property_id=p_property_id;
  insert into public.buildings(property_id,name,sort_order) values(p_property_id,btrim(p_building_name),v_sort)
    returning id into v_building_id;
  insert into public.floors(building_id,name,floor_number,sort_order)
    values(v_building_id,btrim(p_floor_name),p_floor_number,p_floor_number) returning id into v_floor_id;
  v_pos:=-1;

if p_units is null or jsonb_typeof(p_units)<>'array'
then raise exception 'Provide a list of units' using errcode='22023'; end if;
v_count:=jsonb_array_length(p_units);
if v_count<1 or v_count>150 then raise exception 'Enter between 1 and 150 units' using errcode='22023'; end if;
for v_unit in select value from jsonb_array_elements(p_units)
loop
  if jsonb_typeof(v_unit)<>'object' then raise exception 'Each unit must be an object' using errcode='22023'; end if;
  v_name:=nullif(btrim(v_unit->>'name'),'');
  if v_name is null or length(v_name)>100 then
    raise exception 'Unit names must be 1–100 characters' using errcode='22023'; end if;
  if lower(v_name)=any(v_names) or exists(select 1 from public.units u
      where u.floor_id=v_floor_id and lower(u.name)=lower(v_name)) then
    raise exception 'Unit % already exists on this floor',v_name using errcode='23505'; end if;
  v_names:=array_append(v_names,lower(v_name));
  if nullif(btrim(v_unit->>'default_rent_amount'),'') is null then v_rent:=null;
  else
    v_rent:=(v_unit->>'default_rent_amount')::numeric;
    if v_rent<0 or v_rent>9999999999.99 or scale(v_rent)>2 then
      raise exception 'Invalid default rent for unit %',v_name using errcode='22023'; end if;
  end if;
  v_pos:=v_pos+1;
  insert into public.units(floor_id,name,position,default_rent_amount)
    values(v_floor_id,v_name,v_pos,v_rent);
end loop;
return jsonb_build_object('property_id',p_property_id,'building_id',v_building_id,'floor_id',v_floor_id,'units_created',v_count);
end;$fn$;
create or replace function public.dashboard_add_floor_with_units(p_property_id uuid,p_building_id uuid,p_floor_name text,p_floor_number integer,p_units jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare v_floor_id uuid; v_unit jsonb; v_name text; v_rent numeric;
v_pos integer; v_count integer; v_names text[]:=array[]::text[]; 
begin
if auth.uid() is null or not coalesce(public.can_manage_property(p_property_id),false) then
raise exception 'Only an authorized landlord or manager can configure this property' using errcode='42501'; end if;

  if p_building_id is null then raise exception 'Choose a building' using errcode='22023'; end if;
  if nullif(btrim(p_floor_name),'') is null or length(btrim(p_floor_name))>100
then raise exception 'Enter a valid floor name (1–100 characters)' using errcode='22023'; end if;
if p_floor_number is null then raise exception 'Enter a floor number' using errcode='22023'; end if;
  perform 1 from public.buildings b join public.properties p on p.id=b.property_id
   where b.id=p_building_id and b.property_id=p_property_id and b.deleted_at is null
     and p.deleted_at is null and p.status='active' for update of b;
  if not found then raise exception 'Building does not belong to this property' using errcode='22023'; end if;
  if exists(select 1 from public.floors f where f.building_id=p_building_id and f.floor_number=p_floor_number) then
    raise exception 'This floor number is already used in the building' using errcode='23505'; end if;
  insert into public.floors(building_id,name,floor_number,sort_order)
    values(p_building_id,btrim(p_floor_name),p_floor_number,p_floor_number) returning id into v_floor_id;
  v_pos:=-1;

if p_units is null or jsonb_typeof(p_units)<>'array'
then raise exception 'Provide a list of units' using errcode='22023'; end if;
v_count:=jsonb_array_length(p_units);
if v_count<1 or v_count>150 then raise exception 'Enter between 1 and 150 units' using errcode='22023'; end if;
for v_unit in select value from jsonb_array_elements(p_units)
loop
  if jsonb_typeof(v_unit)<>'object' then raise exception 'Each unit must be an object' using errcode='22023'; end if;
  v_name:=nullif(btrim(v_unit->>'name'),'');
  if v_name is null or length(v_name)>100 then
    raise exception 'Unit names must be 1–100 characters' using errcode='22023'; end if;
  if lower(v_name)=any(v_names) or exists(select 1 from public.units u
      where u.floor_id=v_floor_id and lower(u.name)=lower(v_name)) then
    raise exception 'Unit % already exists on this floor',v_name using errcode='23505'; end if;
  v_names:=array_append(v_names,lower(v_name));
  if nullif(btrim(v_unit->>'default_rent_amount'),'') is null then v_rent:=null;
  else
    v_rent:=(v_unit->>'default_rent_amount')::numeric;
    if v_rent<0 or v_rent>9999999999.99 or scale(v_rent)>2 then
      raise exception 'Invalid default rent for unit %',v_name using errcode='22023'; end if;
  end if;
  v_pos:=v_pos+1;
  insert into public.units(floor_id,name,position,default_rent_amount)
    values(v_floor_id,v_name,v_pos,v_rent);
end loop;
return jsonb_build_object('property_id',p_property_id,'building_id',p_building_id,'floor_id',v_floor_id,'units_created',v_count);
end;$fn$;
create or replace function public.dashboard_add_units(p_property_id uuid,p_building_id uuid,p_floor_id uuid,p_units jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $fn$
declare v_floor_id uuid; v_unit jsonb; v_name text; v_rent numeric;
v_pos integer; v_count integer; v_names text[]:=array[]::text[]; 
begin
if auth.uid() is null or not coalesce(public.can_manage_property(p_property_id),false) then
raise exception 'Only an authorized landlord or manager can configure this property' using errcode='42501'; end if;

  if p_building_id is null or p_floor_id is null then
    raise exception 'Select a building and a floor' using errcode='22023'; end if;
  perform 1 from public.floors f join public.buildings b on b.id=f.building_id
    join public.properties p on p.id=b.property_id
  where f.id=p_floor_id and b.id=p_building_id and b.property_id=p_property_id
    and f.deleted_at is null and b.deleted_at is null and p.deleted_at is null
    and p.status='active'
  for update of f;
  if not found then raise exception 'Floor does not belong to the chosen property/building' using errcode='22023'; end if;
  v_floor_id:=p_floor_id;
  select coalesce(max(position),-1) into v_pos from public.units where floor_id=v_floor_id;

if p_units is null or jsonb_typeof(p_units)<>'array'
then raise exception 'Provide a list of units' using errcode='22023'; end if;
v_count:=jsonb_array_length(p_units);
if v_count<1 or v_count>150 then raise exception 'Enter between 1 and 150 units' using errcode='22023'; end if;
for v_unit in select value from jsonb_array_elements(p_units)
loop
  if jsonb_typeof(v_unit)<>'object' then raise exception 'Each unit must be an object' using errcode='22023'; end if;
  v_name:=nullif(btrim(v_unit->>'name'),'');
  if v_name is null or length(v_name)>100 then
    raise exception 'Unit names must be 1–100 characters' using errcode='22023'; end if;
  if lower(v_name)=any(v_names) or exists(select 1 from public.units u
      where u.floor_id=v_floor_id and lower(u.name)=lower(v_name)) then
    raise exception 'Unit % already exists on this floor',v_name using errcode='23505'; end if;
  v_names:=array_append(v_names,lower(v_name));
  if nullif(btrim(v_unit->>'default_rent_amount'),'') is null then v_rent:=null;
  else
    v_rent:=(v_unit->>'default_rent_amount')::numeric;
    if v_rent<0 or v_rent>9999999999.99 or scale(v_rent)>2 then
      raise exception 'Invalid default rent for unit %',v_name using errcode='22023'; end if;
  end if;
  v_pos:=v_pos+1;
  insert into public.units(floor_id,name,position,default_rent_amount)
    values(v_floor_id,v_name,v_pos,v_rent);
end loop;
return jsonb_build_object('property_id',p_property_id,'building_id',p_building_id,'floor_id',v_floor_id,'units_created',v_count);
end;$fn$;
revoke all on function public.dashboard_add_building_with_floor_units(uuid,text,text,integer,jsonb) from public,anon;
revoke all on function public.dashboard_add_floor_with_units(uuid,uuid,text,integer,jsonb) from public,anon;
revoke all on function public.dashboard_add_units(uuid,uuid,uuid,jsonb) from public,anon;
grant execute on function public.dashboard_add_building_with_floor_units(uuid,text,text,integer,jsonb) to authenticated;
grant execute on function public.dashboard_add_floor_with_units(uuid,uuid,text,integer,jsonb) to authenticated;
grant execute on function public.dashboard_add_units(uuid,uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
