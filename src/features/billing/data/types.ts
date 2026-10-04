export type BillingMethod =
  | 'fixed'
  | 'usage'

export type BillingApplicability =
  | 'mandatory'
  | 'optional'
  | 'off'

export type BillingContext =
  | 'normal'
  | 'move_in'
  | 'move_out'
  | 'renewal'

export type BillDraftStatus =
  | 'draft'
  | 'reviewed'
  | 'approved'
  | 'cancelled'

export type BillingCycleStatus =
  | 'draft'
  | 'collecting_readings'
  | 'reviewing'
  | 'ready_to_invoice'
  | 'invoiced'
  | 'sent'
  | 'closed'

export interface BillingProperty {
  id: string
  organization_id: string
  name: string
}

export interface BillingCycle {
  id: string
  property_id: string
  period_start: string
  period_end: string
  status: BillingCycleStatus
  created_at: string
  updated_at?: string
}

export interface BillingServiceSummary {
  id: string
  name: string

  billingMethod: BillingMethod
  applicability: BillingApplicability

  currentRate: number | null

  targetCount: number
  meterCount: number
  subscriberCount: number
}

export interface BillDraftRow {
  id: string

  billing_cycle_id: string
  lease_id: string
  tenant_id: string
  unit_id: string

  tenantName: string
  unitName: string

  billing_context: BillingContext

  current_charges: number
  previous_balance: number
  total_payable: number

  status: BillDraftStatus

  created_at: string
}

export interface BillChargeDetail {
  id: string

  bill_charge_id: string

  meter_id: string | null

  previous_reading_id: string | null
  current_reading_id: string | null

  previous_reading: number | null
  current_reading: number | null

  consumption: number | null
  rate: number | null
}

export interface BillCharge {
  id: string

  bill_draft_id: string

  service_id: string | null

  charge_type: string

  description: string
  amount: number

  details: BillChargeDetail[]
}

export interface BalanceSource {
  source_invoice_id: string
  invoiceNumber: string
  amount: number
}

export interface DraftDetail {
  draft: BillDraftRow

  charges: BillCharge[]

  balanceSources: BalanceSource[]
}

export interface BillingIssue {
  id: string

  type:
    | 'missing_meter'
    | 'missing_reading'
    | 'missing_rate'
    | 'generation_error'

  unitId?: string
  unitName?: string

  serviceId?: string
  serviceName?: string

  title: string
  description?: string

  action:
    | 'reading'
    | 'meter'
    | 'service'
    | 'none'
}

export interface BillingDashboardData {
  leaseCount: number

  futureMoveIns: number
  movingOut: number

  draftCount: number
  approvedCount: number
  invoiceCount: number

  services: BillingServiceSummary[]

  drafts: BillDraftRow[]

  configurationIssues: BillingIssue[]
}

export interface MissingReadingResult {
  lease_id?: string
  tenant_id?: string

  unit_id?: string
  unit_name?: string

  service_id?: string
  service_name?: string

  meter_id?: string
  meter_serial?: string

  missing?: string

  expected_on_or_before?: string
}

export interface GenerationErrorResult {
  lease_id?: string
  tenant_id?: string

  unit_id?: string
  unit_name?: string

  error?: string
}

export interface GenerateDraftsResult {
  leases_checked: number
  drafts_generated: number

  missing_meter_readings: number

  moving_out: number
  future_move_ins: number

  fatal_errors: number

  missing_readings:
    MissingReadingResult[]

  errors:
    GenerationErrorResult[]
}

export interface WorkspaceIdentity {
  organizationName: string
  role: string
  firstName: string
}