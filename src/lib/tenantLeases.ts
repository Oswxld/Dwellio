import { supabase } from './supabase'

export type PropertyOption = {
  id: string
  name: string
}

export type BuildingOption = {
  id: string
  name: string
  property_id: string
}

export type FloorOption = {
  id: string
  name: string
  building_id: string
  floor_number: number
}

export type UnitOption = {
  id: string
  name: string
  floor_id: string
  status: string
  default_rent_amount: number | null
}

export type TenantOnboardingInput = {
  tenant: {
    full_name: string
    email: string
    phone: string
    identification_type:
      | 'national_id'
      | 'passport'
      | 'other'
    identification_number: string
    date_of_birth: string
  }

  emergency_contact: {
    full_name: string
    relationship: string
    phone: string
  }

  lease: {
    unit_id: string
    start_date: string
    end_date: string
    rent_amount: number
    deposit_amount: number
    due_day: number
    grace_period_days: number
    billing_frequency:
      | 'monthly'
      | 'quarterly'
      | 'yearly'
    notes: string
  }
}

export async function getTenantSetupProperties(
  organizationId: string,
) {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .eq('status', 'active')
    .order('name')

  if (error) throw error

  return data as PropertyOption[]
}

export async function getTenantSetupBuildings(
  propertyId: string,
) {
  const { data, error } = await supabase
    .from('buildings')
    .select('id, name, property_id')
    .eq('property_id', propertyId)
    .is('deleted_at', null)
    .order('sort_order')

  if (error) throw error

  return data as BuildingOption[]
}

export async function getTenantSetupFloors(
  buildingId: string,
) {
  const { data, error } = await supabase
    .from('floors')
    .select(
      'id, name, building_id, floor_number',
    )
    .eq('building_id', buildingId)
    .is('deleted_at', null)
    .order('floor_number')

  if (error) throw error

  return data as FloorOption[]
}

export async function getTenantSetupUnits(
  floorId: string,
) {
  const { data, error } = await supabase
    .from('units')
    .select(
      'id, name, floor_id, status, default_rent_amount',
    )
    .eq('floor_id', floorId)
    .is('deleted_at', null)
    .neq('status', 'deleted')
    .order('position')

  if (error) throw error

  return data as UnitOption[]
}

export async function createTenantWithLease(
  organizationId: string,
  input: TenantOnboardingInput,
) {
  const { data, error } = await supabase.rpc(
    'create_tenant_with_lease',
    {
      p_organization_id: organizationId,
      p_tenant: input.tenant,
      p_emergency_contact:
        input.emergency_contact,
      p_lease: input.lease,
    },
  )

  if (error) {

  console.error
  ('create_tenant_with_lease failed:', error)
  throw error
}

  return data as {
    tenant_id: string
    lease_id: string
    linked_user_id: string | null
    lease_status: 'pending_acceptance'
    unit_status: 'reserved'
  }
}