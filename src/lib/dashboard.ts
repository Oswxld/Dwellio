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
    .neq('status', 'deleted')
    .is('deleted_at', null)
    .order('name')

  if (error) throw error
  return (data ?? []) as DashboardProperty[]
}

export type DashboardFinancials = {
  period_start: string
  invoice_count: number
  expected: number
  outstanding: number
  collected: number
}

/** Same finalized monthly billing-cycle basis as Billing > Total invoiced. */
export async function getDashboardFinancials(
  organizationId: string,
  month: string,
): Promise<DashboardFinancials> {
  const { data, error } = await supabase.rpc('get_landlord_dashboard_financials', {
    p_organization_id: organizationId,
    p_period_start: `${month}-01`,
  })
  if (error) throw error
  if (!data) throw new Error('The financial dashboard returned no data.')
  const result = data as DashboardFinancials
  return {
    ...result,
    invoice_count: Number(result.invoice_count),
    expected: Number(result.expected),
    outstanding: Number(result.outstanding),
    collected: Number(result.collected),
  }
}
