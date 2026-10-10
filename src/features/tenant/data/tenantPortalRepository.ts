import { supabase } from '../../../lib/supabase'

export type TenantPortalSnapshot = {
  tenant: {
    id: string
    full_name: string
    email: string
    phone: string
    identification_type: string
    masked_identification_number: string | null
    date_of_birth: string | null
    status: string
  }
  lease: {
    id: string
    status: string
    start_date: string
    end_date: string
    notice_date: string | null
    move_out_date: string | null
    rent_amount: number
    deposit_amount: number
    due_day: number
    billing_frequency: string
    grace_period_days: number
    property_name: string
    property_address: string | null
    property_city: string | null
    building_name: string
    floor_name: string
    floor_number: number
    unit_name: string
  } | null
  emergency_contact: {
    full_name: string
    relationship: string
    phone: string
  } | null
  outstanding_balance: number | null
}

export type TenantMoveOutRequest = {
  id: string
  lease_id: string
  proposed_move_out_date: string
  status: 'pending' | 'accepted' | 'declined'
  reason: string | null
  decision_reason: string | null
  submitted_at: string
  reviewed_at: string | null
}

export async function fetchTenantPortal(): Promise<TenantPortalSnapshot | null> {
  const { data, error } = await supabase.rpc('get_my_tenant_portal')
  if (error) {
    console.error('[TenantPortal] Failed to fetch tenant account', error)
    throw error
  }
  return (data ?? null) as TenantPortalSnapshot | null
}

export async function fetchTenantMoveOutRequests(
  leaseId: string,
): Promise<TenantMoveOutRequest[]> {
  const { data, error } = await supabase
    .from('move_out_requests')
    .select('id, lease_id, proposed_move_out_date, status, reason, decision_reason, submitted_at, reviewed_at')
    .eq('lease_id', leaseId)
    .order('submitted_at', { ascending: false })
  if (error) {
    console.error('[TenantPortal] Failed to fetch move-out requests', error)
    throw error
  }
  return (data ?? []) as TenantMoveOutRequest[]
}

export async function submitTenantMoveOutRequest(
  leaseId: string,
  proposedDate: string,
  reason: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('submit_move_out_request', {
    p_lease_id: leaseId,
    p_proposed_move_out_date: proposedDate,
    p_reason: reason.trim() || null,
  })
  if (error) {
    console.error('[TenantPortal] Move-out request failed', error)
    throw error
  }
  return String(data)
}
