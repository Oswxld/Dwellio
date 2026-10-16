import { supabase } from '../../../lib/supabase'

export type PropertyBuilding = {
  id: string
  property_id: string
  name: string
  sort_order: number
}

export type PropertyFloor = {
  id: string
  building_id: string
  name: string
  floor_number: number
  sort_order: number
}

export type PropertyUnit = {
  id: string
  floor_id: string
  name: string
  position: number
  status: 'vacant' | 'occupied' | 'reserved' | 'under_maintenance' | 'unavailable' | 'deleted'
  default_rent_amount: number | null
}

export type PropertyStructure = {
  buildings: PropertyBuilding[]
  floors: PropertyFloor[]
  units: PropertyUnit[]
}

const emptyStructure: PropertyStructure = {
  buildings: [],
  floors: [],
  units: [],
}

export async function fetchPropertyStructure(propertyId: string): Promise<PropertyStructure> {
  const { data: buildings, error: buildingsError } = await supabase
    .from('buildings')
    .select('id, property_id, name, sort_order')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('sort_order')
    .order('name')

  if (buildingsError) throw buildingsError
  if (!buildings?.length) return { ...emptyStructure }

  const buildingIds = buildings.map(building => building.id)
  const { data: floors, error: floorsError } = await supabase
    .from('floors')
    .select('id, building_id, name, floor_number, sort_order')
    .in('building_id', buildingIds)
    .is('deleted_at', null)
    .order('sort_order')
    .order('floor_number')

  if (floorsError) throw floorsError
  if (!floors?.length) {
    return { buildings: buildings as PropertyBuilding[], floors: [], units: [] }
  }

  const floorIds = floors.map(floor => floor.id)
  const { data: units, error: unitsError } = await supabase
    .from('units')
    .select('id, floor_id, name, position, status, default_rent_amount')
    .in('floor_id', floorIds)
    .is('deleted_at', null)
    .neq('status', 'deleted')
    .order('position')

  if (unitsError) throw unitsError

  return {
    buildings: buildings as PropertyBuilding[],
    floors: floors as PropertyFloor[],
    units: (units ?? []) as PropertyUnit[],
  }
}

export async function addPropertyBuilding(propertyId: string, name: string): Promise<void> {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('Building name is required.')

  const { data: last, error: indexError } = await supabase
    .from('buildings')
    .select('sort_order')
    .eq('property_id', propertyId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (indexError) throw indexError

  const { error } = await supabase
    .from('buildings')
    .insert({ property_id: propertyId, name: cleanName, sort_order: (last?.sort_order ?? -1) + 1 })

  if (error) throw error
}

export async function addPropertyFloor(
  propertyId: string,
  buildingId: string,
  name: string,
  floorNumber: number,
): Promise<void> {
  if (!name.trim()) throw new Error('Floor name is required.')
  if (!Number.isSafeInteger(floorNumber)) throw new Error('Enter a valid floor number.')

  const { data: building, error: buildingError } = await supabase
    .from('buildings')
    .select('id')
    .eq('id', buildingId)
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (buildingError) throw buildingError
  if (!building) throw new Error('Selected building does not belong to this property.')

  const { error } = await supabase.from('floors').insert({
    building_id: buildingId,
    name: name.trim(),
    floor_number: floorNumber,
    sort_order: floorNumber,
  })
  if (error) throw error
}

export async function addPropertyUnit(
  propertyId: string,
  floorId: string,
  name: string,
  defaultRent: number | null,
): Promise<void> {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('Unit name is required.')
  if (defaultRent !== null && (!Number.isFinite(defaultRent) || defaultRent < 0)) {
    throw new Error('The default rent must be zero or greater.')
  }

  const { data: floor, error: floorError } = await supabase
    .from('floors')
    .select('building_id')
    .eq('id', floorId)
    .is('deleted_at', null)
    .maybeSingle()

  if (floorError) throw floorError
  if (!floor) throw new Error('Selected floor was not found.')

  const { data: building, error: buildingError } = await supabase
    .from('buildings')
    .select('id')
    .eq('id', floor.building_id)
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (buildingError) throw buildingError
  if (!building) throw new Error('Selected floor does not belong to this property.')

  // Deleted unit positions remain reserved by the unique constraint.
  const { data: last, error: positionError } = await supabase
    .from('units')
    .select('position')
    .eq('floor_id', floorId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (positionError) throw positionError

  const { error } = await supabase.from('units').insert({
    floor_id: floorId,
    name: cleanName,
    position: (last?.position ?? -1) + 1,
    status: 'vacant',
    default_rent_amount: defaultRent,
  })
  if (error) throw error
}

