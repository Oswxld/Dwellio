import { supabase } from './supabase'
import type { DashboardProperty, DashboardSummary } from '../types/dashboard'

export async function getDashboardSummary(organizationId: string): Promise<DashboardSummary> {
  const { data, error } = await supabase.rpc('get_landlord_dashboard_summary', {
    p_organization_id: organizationId,
  })


  if (error) throw error
  return data as DashboardSummary
}

export async function getDashboardProperties(organizationId: string): Promise<DashboardProperty[]> {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, address, city, county')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return (data ?? []) as DashboardProperty[]
}
