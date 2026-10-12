import { supabase } from '../../../lib/supabase'

export type OrganizationProperty = {
  id: string
  organization_id: string
  name: string
  address: string | null
  city: string | null
  county: string | null
  status: 'active' | 'inactive' | 'under_maintenance' | 'deleted'
  created_at: string
}

const propertyColumns =
  'id, organization_id, name, address, city, county, status, created_at'

export async function fetchOrganizationProperties(
  organizationId: string,
): Promise<OrganizationProperty[]> {
  const { data, error } = await supabase
    .from('properties')
    .select(propertyColumns)
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .neq('status', 'deleted')
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []) as OrganizationProperty[]
}

export async function fetchOrganizationProperty(
  organizationId: string,
  propertyId: string,
): Promise<OrganizationProperty | null> {
  const { data, error } = await supabase
    .from('properties')
    .select(propertyColumns)
    .eq('organization_id', organizationId)
    .eq('id', propertyId)
    .is('deleted_at', null)
    .neq('status', 'deleted')
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as OrganizationProperty | null
}

export async function fetchOrganizationName(
  organizationId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', organizationId)
    .single()

  if (error) throw error
  return data.name
}
