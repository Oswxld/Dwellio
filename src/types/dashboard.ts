export type DashboardPendingAcceptance = {
  lease_id: string
  tenant_name: string
  unit_name: string
  start_date: string
  end_date: string
  created_at: string
}

export type DashboardExpiringLease = {
  lease_id: string
  tenant_name: string
  unit_name: string
  end_date: string
  days_remaining: number
}

export type DashboardRenewalPending = {
  request_id: string
  tenant_name: string
  unit_name: string
  proposed_end_date: string
  proposed_rent_amount: number
  requested_at: string
}

export type DashboardSummary = {
  organization_id: string
  organization_name: string

  property_count: number
  building_count: number
  floor_count: number
  unit_count: number

  occupied_units: number
  vacant_units: number
  reserved_units: number
  maintenance_units: number
  unavailable_units: number

  staff_count: number

  pending_acceptance_count: number
  expiring_soon_count: number
  renewal_pending_count: number

  pending_confirmation: DashboardPendingAcceptance[]
  expiring_soon: DashboardExpiringLease[]
  renewal_pending: DashboardRenewalPending[]
}

export type DashboardProperty = {
  id: string
  name: string
  address: string | null
  city: string | null
  county: string | null
}