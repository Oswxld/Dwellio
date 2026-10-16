import { supabase } from '../../../lib/supabase'

/**
 * These are the THREE installed, verified quick-add RPCs. Each call is
 * atomic and uses existing RLS; none modifies table definitions.
 */
export type QuickAddKind = 'building' | 'floor' | 'units'

export type QuickAddProperty = {
  id: string
  name: string
  address: string | null
  city: string | null
  county: string | null
}
export type QuickAddBuilding = { id: string; name: string; property_id: string }
export type QuickAddFloor = {
  id: string
  name: string
  building_id: string
  floor_number: number
}
export type NewUnit = { name: string; defaultRent: number | null }
export type CreationResult = {
  property_id: string
  building_id: string
  floor_id: string
  units_created: number
}

function showError(error: unknown): never {
  console.error('[Dwellio property quick add] Supabase operation failed', error)
  const details = error && typeof error === 'object'
    ? error as { message?: string; details?: string; hint?: string; code?: string }
    : null
  throw new Error(
    [details?.message, details?.details, details?.hint].filter(Boolean).join(' · ')
      || 'The property operation failed. Check the browser console.',
  )
}

export async function listQuickAddProperties(
  organizationId: string,
): Promise<QuickAddProperty[]> {
  const { data, error } = await supabase.from('properties')
    .select('id,name,address,city,county')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name')
  if (error) showError(error)
  return (data ?? []) as QuickAddProperty[]
}

export async function listQuickAddBuildings(
  propertyId: string,
): Promise<QuickAddBuilding[]> {
  const { data, error } = await supabase.from('buildings')
    .select('id,name,property_id')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('sort_order')
    .order('name')
  if (error) showError(error)
  return (data ?? []) as QuickAddBuilding[]
}

export async function listQuickAddFloors(
  buildingId: string,
): Promise<QuickAddFloor[]> {
  const { data, error } = await supabase.from('floors')
    .select('id,name,building_id,floor_number')
    .eq('building_id', buildingId)
    .is('deleted_at', null)
    .order('sort_order')
    .order('floor_number')
  if (error) showError(error)
  return (data ?? []) as QuickAddFloor[]
}

function serialize(units: NewUnit[]) {
  return units.map(unit => ({
    name: unit.name.trim(),
    default_rent_amount: unit.defaultRent,
  }))
}

function checked(data: unknown): CreationResult {
  if (!data || typeof data !== 'object') {
    throw new Error('The database operation returned no confirmation.')
  }
  const result = data as CreationResult
  if (!result.property_id || !result.building_id || !result.floor_id
    || !Number.isSafeInteger(Number(result.units_created))) {
    throw new Error('The database returned an incomplete creation result.')
  }
  return result
}

/** Select PROPERTY → enter BUILDING + FLOOR → enter one or more UNITS. */
export async function createBuildingFloorUnits(input: {
  propertyId: string
  buildingName: string
  floorName: string
  floorNumber: number
  units: NewUnit[]
}): Promise<CreationResult> {
  const { data, error } = await supabase.rpc('dashboard_add_building_with_floor_units', {
    p_property_id: input.propertyId,
    p_building_name: input.buildingName,
    p_floor_name: input.floorName,
    p_floor_number: input.floorNumber,
    p_units: serialize(input.units),
  })
  if (error) showError(error)
  return checked(data)
}

/** Select PROPERTY → BUILDING → enter FLOOR → enter one or more UNITS. */
export async function createFloorUnits(input: {
  propertyId: string
  buildingId: string
  floorName: string
  floorNumber: number
  units: NewUnit[]
}): Promise<CreationResult> {
  const { data, error } = await supabase.rpc('dashboard_add_floor_with_units', {
    p_property_id: input.propertyId,
    p_building_id: input.buildingId,
    p_floor_name: input.floorName,
    p_floor_number: input.floorNumber,
    p_units: serialize(input.units),
  })
  if (error) showError(error)
  return checked(data)
}

/** Select PROPERTY → BUILDING → FLOOR → enter one or more UNITS. */
export async function createUnits(input: {
  propertyId: string
  buildingId: string
  floorId: string
  units: NewUnit[]
}): Promise<CreationResult> {
  const { data, error } = await supabase.rpc('dashboard_add_units', {
    p_property_id: input.propertyId,
    p_building_id: input.buildingId,
    p_floor_id: input.floorId,
    p_units: serialize(input.units),
  })
  if (error) showError(error)
  return checked(data)
}
